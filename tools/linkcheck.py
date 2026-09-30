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
  - the .html files under each site given, and for the photo site the
    templates its Functions render from, photos/templates/ (#157; TEMPLATES
    below). A page a Function builds from strings alone, as the admin pages
    are, is not read: test/admin-page.test.js holds their stamps instead.
  - on a site with a _routes.json (the photo site), a path it sends to the
    Functions is resolved against the route files in the site's functions/
    rather than against a served file, since #157 made / one. Whether that
    route then answers 200 for the path is decided at request time, and is
    the tests' to hold, not this file's.
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
    slash.
  - since #130 an href Pages answers with a redirect is a failure, not a pass:
    a path ending .html, a directory without its trailing slash, and a path
    naming an index. All three land after one 308, so the link works and every
    visitor pays a hop - which is why this went unnoticed until #113 measured
    it. src is unaffected: a src is fetched at the URL written, and no rewrite
    applies to it.
  - a query string is dropped before the file is looked up, since the host
    serves the same file whatever the query says.
  - a reference into shared/css/ or shared/js/ must also carry
    ?v=<the file's current version>, as tools/assetver.py writes it. Those
    files are served immutable for a year, so a replaced file reaches a
    returning visitor only under a new URL; a page left pointing at the old
    one is a failure here, not on production (story #95).
  - so must a reference into a site's own css/ or js/ (hq/css/, sailing/css/,
    photos/public/css/, photos/public/js/). The zones hold those for 4 hours
    in a returning visitor's browser whatever the site says (story #176).

Usage:  python tools/linkcheck.py hq [sailing ...]
Exit 0 when every internal href resolves, 1 otherwise.
"""
import os
import re
import json
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


PARAM = re.compile(r'^\[[^\[\]]+\]$')
CATCHALL = re.compile(r'^\[\[[^\[\]]+\]\]\.js$')


def function_paths(site):
    """Whether a URL path on site is answered by a Function, as a callable, or
    None for a site with no _routes.json (a static site).

    The photo site answers / and every album page from a Function since #157,
    so the 404 page's link home names no file at all. A path _routes.json
    sends to the Functions is resolved against the route files under the
    site's functions/ instead, which sits beside its served root
    (photos/functions/ for photos/public). Matching follows _routes.json's
    rules: a trailing /* matches that prefix at any depth, anything else
    matches exactly.
    """
    routes_file = os.path.join(site, '_routes.json')
    if not os.path.isfile(routes_file):
        return None
    with open(routes_file, encoding='utf-8') as fh:
        routes = json.load(fh)

    def matches(pattern, path):
        return path.startswith(pattern[:-1]) if pattern.endswith('/*') else path == pattern

    def invoked(path):
        return (any(matches(p, path) for p in routes.get('include', []))
                and not any(matches(p, path) for p in routes.get('exclude', [])))
    return invoked


def function_route(functions, path):
    """The route file under functions that answers path, or None.

    Pages' file routing: index.js answers its directory, name.js the name, a
    [param] file or directory any one segment, and a [[catchall]].js file any
    number of them. A name matching exactly is tried before a param.
    """
    def match(directory, segments):
        if not os.path.isdir(directory):
            return None
        names = sorted(os.listdir(directory))
        if not segments:
            index = os.path.join(directory, 'index.js')
            return index if os.path.isfile(index) else None
        head, rest = segments[0], segments[1:]
        params = [n for n in names if PARAM.match(n[:-3] if n.endswith('.js') else n)]
        for name in [head] + [n for n in params if not n.endswith('.js')]:
            found = match(os.path.join(directory, name), rest)
            if found:
                return found
        if not rest:
            for name in [head + '.js'] + [n for n in params if n.endswith('.js')]:
                if os.path.isfile(os.path.join(directory, name)):
                    return os.path.join(directory, name)
        for name in names:
            if CATCHALL.match(name):
                return os.path.join(directory, name)
        return None
    return match(functions, [s for s in path.split('/') if s])


def redirecting(target, resolved, trailing):
    """Why Pages answers this internal href with a 308, or None.

    Pages strips .html and adds a directory's trailing slash, so all three
    forms below land after one redirect: the link works, and every visitor
    pays a hop. That is why it survived until #113 measured it on production
    (/about.html -> 308 /about, /work -> 308 /work/, /work/index -> 308
    /work/). Resolution above deliberately still accepts them - this refuses
    them afterwards, so the reason names the form to write instead.
    """
    if not target:                                   # same-page: "#main"
        return None
    if target.endswith('.html'):
        clean = target[:-len('.html')]
        if os.path.basename(clean) == 'index':
            clean = clean[:-len('index')]
        return 'redirects: Pages 308s %s to %s - link to %s' % (
            target, clean or './', clean or './')
    if not trailing and os.path.isdir(resolved):
        return 'redirects: %s is a directory; Pages 308s it to %s/ - add the slash' % (
            target, target)
    if os.path.basename(target) == 'index':
        clean = target[:-len('index')]
        return 'redirects: Pages 308s %s to %s - name the directory' % (
            target, clean or './')
    return None


# A site whose server renders pages from a directory of templates, which are
# read here as that site's pages (#157). photos/templates/page.html is the
# photo site's public pages' shell: its Functions fill a title and a main, and
# every URL it holds is the page's own, so a stale ?v= or a missing file
# there is the same failure as on a static page. A template's URLs are
# root-relative, so a relative one is resolved against the site's root.
# tools/templates/ is deliberately not here: its hrefs hold placeholders
# ({{canonical}}), and every page rendered from it sits under sailing/, which
# this reads.
TEMPLATES = {'photos/public': 'photos/templates'}


def pages_of(site):
    """Each (page, the directory a relative URL on it resolves against)."""
    for dirpath, dirnames, filenames in os.walk(site):
        # assets/shared/ is written by the Pages build step from shared/ and is
        # gitignored, so on a clean checkout it does not exist at all - it is
        # only on a machine that has run the build. Do not walk it, and see
        # resolve_shared() for links that point INTO it.
        dirnames[:] = [d for d in dirnames if os.path.join(dirpath, d).replace(os.sep, '/')
                       != os.path.join(site, 'assets', 'shared').replace(os.sep, '/')]
        for name in sorted(filenames):
            if name.endswith('.html'):
                page = os.path.join(dirpath, name).replace(os.sep, '/')
                yield page, os.path.dirname(page)
    templates = TEMPLATES.get(site.replace(os.sep, '/').rstrip('/'))
    if templates:
        for name in sorted(os.listdir(templates)):
            if name.endswith('.html'):
                yield os.path.join(templates, name).replace(os.sep, '/'), site


def check(site):
    """Return a list of (page, href, reason) for every internal href that fails."""
    failures = []
    idcache = {}
    shared_prefix = '%s/assets/shared/' % site
    invoked = function_paths(site)
    functions = os.path.join(os.path.dirname(os.path.normpath(site)), 'functions')

    def function_failure(resolved, trailing):
        """For a path a Function answers: why no route file does ('' when one
        does). None when no Function answers the path, so it is a file."""
        rel = os.path.relpath(resolved, site).replace(os.sep, '/')
        if invoked is None or rel.startswith('..'):
            return None
        path = '/' if rel == '.' else '/%s%s' % (rel, '/' if trailing else '')
        if not invoked(path):
            return None
        return '' if function_route(functions, path) else 'no Function answers %s' % path

    for page, base in pages_of(site):
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
                resolved = os.path.join(base, target).replace(os.sep, '/')

            # normpath before the directory test, and re-append the trailing
            # slash it strips: without that, a relative "work/" is tested as
            # a file named work and misses the index.html rewrite, while the
            # root-relative "/work/" gets it. The two spellings must agree.
            trailing = resolved.endswith('/')
            resolved = os.path.normpath(resolved).replace(os.sep, '/')

            # #130: a form Pages redirects is a failure, checked here so
            # the rewrites below - which are what make it land - cannot
            # hide it. One reason per href, so stop at this one.
            redirect = redirecting(target, resolved, trailing)
            if redirect:
                failures.append((page, href, redirect))
                continue

            # #157: a path a Function answers is checked against the route
            # files, not the served files. Its fragment is not checked: the
            # page is built per request.
            answered = function_failure(resolved, trailing)
            if answered is not None:
                if answered:
                    failures.append((page, href, answered))
                continue

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
                resolved = os.path.join(base, target).replace(os.sep, '/')
            resolved = os.path.normpath(resolved).replace(os.sep, '/')

            answered = function_failure(resolved, False)
            if answered is not None:
                if answered:
                    failures.append((page, src, answered))
                continue

            if resolved.startswith(shared_prefix):
                resolved = 'shared/' + resolved[len(shared_prefix):]

            if not os.path.isfile(resolved):
                failures.append((page, src, 'no such file: %s' % resolved))
            elif stale(resolved, query):
                failures.append((page, src, stale(resolved, query)))
    return failures


def stale(resolved, query):
    """Why a reference to resolved carries the wrong version, or None.

    Only CSS and JS are versioned: files under shared/css/ and shared/js/, and
    since #176 each site's own css/ and js/. assetver.is_versioned() decides
    which, and tools/assetver.py says why fonts and images are not. A missing
    ?v= is as stale as a wrong one: it is the URL a browser may already hold,
    for a year under /assets/ and for 4 hours for a site's own file.
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
