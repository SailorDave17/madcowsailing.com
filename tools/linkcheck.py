#!/usr/bin/env python3
"""Resolve every internal href in a site against the files on disk.

Why this exists rather than a status-code crawler: Cloudflare Pages serves
index.html for any missing path when the output directory has no 404.html, so
both dead links this check was written for answered 200 with the home page on
production for eleven days. Anything that reads status codes - a spider, an
uptime monitor, curl -w %{http_code} - agrees the site is healthy. See cairn's
a-status-code-cannot-prove-a-page-exists-2026-09-01: a 200 is a fact about the
host's routing policy, and the question is about the contents of a build.

So this reads the tree, which is the object the question is actually about, and
never makes a request at all.

Scope, stated so a later reader does not over-trust a pass:
  - internal hrefs only. External (scheme://, //, mailto:, tel:) are skipped -
    they are not this repo's to guarantee.
  - a fragment on a same-page link (#main) is checked against the ids in that
    file; a fragment on a cross-page link (work/#buoyant) is checked against
    the ids in the target file. A link to an id that does not exist lands at
    the top of the page silently, which is the same class of failure.
  - href and src. srcset and CSS url() are still not read; a srcset candidate
    that 404s drops one width and the browser picks another, where a missing
    src or href drops the whole thing. src was added by story #12, where a
    mistyped <script src> would have passed every gate green and degraded to
    exactly the intended no-JavaScript baseline - a silent failure that looks
    like a supported mode. A src is checked as a plain file: no fragment, and
    no index.html rewrite, because a directory is never a valid src.
  - an extensionless href that is not a directory resolves as <path>.html,
    because that is what Pages serves: /about answers 200 from about.html, and
    /about.html 308s to /about (measured on production for story #113). A
    directory still resolves to its index.html with or without the trailing
    slash, although Pages 308s /work to /work/. This checks that a link lands,
    not that it lands without a redirect, so a .html href still passes here.
  - a query string is dropped before the file is looked up, since the host
    serves the same file whatever the query says.
  - a reference into shared/css/ or shared/js/ must also carry
    ?v=<the file's current version>, as tools/assetver.py writes it. Those
    files are served immutable for a year, so a replaced file reaches a
    returning visitor only under a new URL; a page left pointing at the old
    one is a failure here, not on production (story #95).

Usage:  python tools/linkcheck.py hq [sailing ...]
Exit 0 when every internal href resolves, 1 otherwise.
"""
import os
import re
import sys
from urllib.parse import unquote, urldefrag

import assetver

HREF = re.compile(r'\shref\s*=\s*"([^"]*)"', re.I)
SRC = re.compile(r'\ssrc\s*=\s*"([^"]*)"', re.I)
ID = re.compile(r'\sid\s*=\s*"([^"]*)"', re.I)
EXTERNAL = re.compile(r'^(?:[a-z][a-z0-9+.-]*:|//)', re.I)


def read(path):
    with open(path, encoding='utf-8') as fh:
        return fh.read()


def ids_in(path, cache):
    """Ids declared in path, or None when path is not a file.

    Only called once a fragment needs checking, so a link to a PDF or an image
    is never parsed as text - the resume and the screenshots are both linked,
    and reading them as utf-8 raises.
    """
    if path not in cache:
        cache[path] = set(ID.findall(read(path))) if os.path.isfile(path) else None
    return cache[path]


def check(site):
    """Return a list of (page, href, reason) for every internal href that fails."""
    failures = []
    idcache = {}
    shared_prefix = '%s/assets/shared/' % site
    for dirpath, dirnames, filenames in os.walk(site):
        # assets/shared/ is written by the Pages build step from shared/ and is
        # gitignored, so on a clean checkout it does not exist at all - it is
        # only on a machine that has run the build. Do not walk it, and see
        # resolve_shared() for links that point INTO it.
        dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d).replace(os.sep, '/')
                       != os.path.join(site, 'assets', 'shared').replace(os.sep, '/')]
        for name in sorted(filenames):
            if not name.endswith('.html'):
                continue
            page = os.path.join(dirpath, name).replace(os.sep, '/')
            for raw in HREF.findall(read(page)):
                href = raw.strip()
                if not href or EXTERNAL.match(href):
                    continue
                target, frag = urldefrag(href)
                target, _, query = target.partition('?')
                target, frag = unquote(target), unquote(frag)

                if not target:                       # same-page: "#main"
                    resolved = page
                elif target.startswith('/'):         # root-relative, site is the root
                    resolved = os.path.join(site, target.lstrip('/')).replace(os.sep, '/')
                else:                                # relative to this page's directory
                    resolved = os.path.join(os.path.dirname(page), target).replace(os.sep, '/')

                # normpath before the directory test, and re-append the trailing
                # slash it strips: without that, a relative "work/" is tested as
                # a file named work and misses the index.html rewrite, while the
                # root-relative "/work/" gets it. The two spellings must agree.
                trailing = resolved.endswith('/')
                resolved = os.path.normpath(resolved).replace(os.sep, '/')

                if trailing or os.path.isdir(resolved):
                    resolved = os.path.join(resolved, 'index.html').replace(os.sep, '/')
                elif not os.path.splitext(resolved)[1]:
                    # Pages serves about.html at /about and 308s /about.html
                    # there, so an extensionless href that is not a directory
                    # names <path>.html. Measured on production for #113.
                    resolved += '.html'

                # A link into assets/shared/ is checked against shared/, which
                # is the tracked source the Pages build copies from. Skipping
                # these instead would pass vacuously on CI and hide a genuinely
                # missing asset; rewriting them checks the real file. Found by
                # CI, which is the only place the difference shows: the copy
                # exists on a machine that has run the build and nowhere else.
                if resolved.startswith(shared_prefix):
                    resolved = 'shared/' + resolved[len(shared_prefix):]

                if not os.path.isfile(resolved):
                    failures.append((page, href, 'no such file: %s' % resolved))
                elif frag and frag not in ids_in(resolved, idcache):
                    failures.append((page, href, 'no id "%s" in %s' % (frag, resolved)))
                elif stale(resolved, query):
                    failures.append((page, href, stale(resolved, query)))

            # src, checked after every href on the page. Deliberately a second
            # loop rather than a branch inside the first: a src resolves more
            # simply than an href - it is always a file, so there is no
            # directory test, no index.html rewrite and no fragment - and
            # threading those three exceptions through the href path would make
            # the harder case carry conditions that only the easier one needs.
            #
            # A data: URI is external by the same rule as https:, which the
            # EXTERNAL pattern already covers (it matches any scheme). That
            # matters here and not for href: every gallery figure carries an
            # inline base64 LQIP.
            for raw in SRC.findall(read(page)):
                src = raw.strip()
                if not src or EXTERNAL.match(src):
                    continue
                target, _, query = urldefrag(src)[0].partition('?')
                target = unquote(target)
                if not target:
                    continue

                if target.startswith('/'):
                    resolved = os.path.join(site, target.lstrip('/')).replace(os.sep, '/')
                else:
                    resolved = os.path.join(os.path.dirname(page), target).replace(os.sep, '/')
                resolved = os.path.normpath(resolved).replace(os.sep, '/')

                if resolved.startswith(shared_prefix):
                    resolved = 'shared/' + resolved[len(shared_prefix):]

                if not os.path.isfile(resolved):
                    failures.append((page, src, 'no such file: %s' % resolved))
                elif stale(resolved, query):
                    failures.append((page, src, stale(resolved, query)))
    return failures


def stale(resolved, query):
    """Why a reference to resolved carries the wrong version, or None.

    Only files under shared/css/ and shared/js/ are versioned (tools/assetver.py
    says why fonts and images are not). A missing ?v= is as stale as a wrong
    one: it is the URL the browser may already hold for a year.
    """
    if not assetver.is_versioned(resolved):
        return None
    want = 'v=' + assetver.version(resolved)
    if query == want:
        return None
    return 'stale URL: %s is ?%s, this says %s - run tools/assetver.py' % (
        resolved, want, '?' + query if query else 'no version')


def main(argv):
    sites = argv[1:] or ['hq', 'sailing']
    failures = []
    for site in sites:
        if not os.path.isdir(site):
            print('linkcheck: no such site directory: %s' % site, file=sys.stderr)
            return 2
        failures += check(site)

    for page, href, reason in failures:
        print('%s: %s -> %s' % (page, href, reason), file=sys.stderr)
    print('linkcheck: %d internal href/src(s) unresolved in %s'
          % (len(failures), ', '.join(sites)), file=sys.stderr)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
