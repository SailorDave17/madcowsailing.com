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
  - href only. src, srcset and CSS url() are not read. Adding them is a good
    idea and is not this story.

Usage:  python tools/linkcheck.py hq [sailing ...]
Exit 0 when every internal href resolves, 1 otherwise.
"""
import os
import re
import sys
from urllib.parse import unquote, urldefrag

HREF = re.compile(r'\shref\s*=\s*"([^"]*)"', re.I)
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
    for dirpath, dirnames, filenames in os.walk(site):
        # assets/shared/ is written by the Pages build step from shared/ and is
        # not in the tree here, so walking it would report phantom misses.
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

                if not os.path.isfile(resolved):
                    failures.append((page, href, 'no such file: %s' % resolved))
                elif frag and frag not in ids_in(resolved, idcache):
                    failures.append((page, href, 'no id "%s" in %s' % (frag, resolved)))
    return failures


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
    print('linkcheck: %d internal href(s) unresolved in %s'
          % (len(failures), ', '.join(sites)), file=sys.stderr)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
