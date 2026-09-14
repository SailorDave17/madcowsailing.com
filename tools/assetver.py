#!/usr/bin/env python3
"""Stamp every shared CSS and JS reference with a version taken from the file.

Why this exists: both _headers files serve /assets/* as
`public, max-age=31536000, immutable`, and `immutable` tells a browser that
already has a file never to ask for it again. Story #95 measured what that
costs when a file is replaced under its own name: #72 replaced
shared/js/gallery.js, and Cloudflare's edge in front of madcowsailing.com kept
serving the old 11,948-byte script through the deploy, for days, while the page
it served had clips only the new 15,647-byte script can play. A purge fixes the
edge and reaches no browser. Only a new URL reaches both.

So every href or src into assets/shared/css/ or assets/shared/js/ carries
?v=<the first 10 hex digits of the file's sha256>. Change a byte of the file
and the URL changes with it; leave the file alone and the URL stays put, so
nothing is fetched twice.

Why a query and not a hashed filename: the file keeps its name in shared/, so
the Pages build stays the one `cp` line CLAUDE.md allows, and an edit to
base.css reads as a diff rather than as a rename. The edge and the browser both
key their caches on the whole URL, query included - #95 measured the edge
serving the new bytes for a cache-busting query while the plain URL served the
old.

Not versioned, deliberately: fonts and images. Each font is named twice - a
<link rel="preload"> in every page and a url() inside tokens.css - and a
preload is used only when its URL matches the url() exactly, so versioning the
preload alone would fetch every font twice. Rename a font or an image rather
than overwrite it; the _headers comment says the same.

This script writes and tools/linkcheck.py checks. The gate refuses a page whose
?v= does not match its file, so an edit to shared/ without a re-run fails the
push instead of reaching a visitor. tools/photos.py stamps every page it
renders, so regenerating a trip log cannot bring a stale version back.

Usage:  python tools/assetver.py
Rewrites every .html under hq/, sailing/ and tools/templates/ in place and
prints each file it changed. Exit 0.
"""
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERSION_LEN = 10
VERSIONED_DIRS = ('css', 'js')

# Every href and src attribute value. The value is matched whole and parsed by
# TARGET below, rather than one pattern doing both: a reference carrying some
# other query (?foo=1) would then fail to match at all and be skipped, which is
# the silent case this whole mechanism exists to remove.
ATTR = re.compile(r'(\s(?:href|src)\s*=\s*")([^"]*)(")', re.I)
TARGET = re.compile(r'^(?P<prefix>/|(?:\.\.?/)*)assets/shared/'
                    r'(?P<rel>(?:%s)/[^?#]+)(?P<query>\?[^#]*)?(?P<frag>#.*)?$'
                    % '|'.join(VERSIONED_DIRS))


def version(path):
    """The first VERSION_LEN hex digits of the sha256 of path's bytes.

    The bytes on disk are the bytes Pages serves: .gitattributes keeps every
    text file LF on every checkout, so this machine and CI hash the same thing.
    """
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:VERSION_LEN]


def is_versioned(path):
    """True for a path under shared/css/ or shared/js/, as linkcheck resolves it."""
    return path.replace(os.sep, '/').startswith(tuple('shared/%s/' % d for d in VERSIONED_DIRS))


def stamp(text):
    """text with every shared CSS and JS reference carrying its file's version.

    A reference to a file that does not exist is left exactly as it is:
    linkcheck reports it as missing, and inventing a version for it would make
    it look cared for.
    """
    def one(m):
        t = TARGET.match(m.group(2))
        if not t:
            return m.group(0)
        path = os.path.join(ROOT, 'shared', *t.group('rel').split('/'))
        if not os.path.isfile(path):
            return m.group(0)
        value = '%sassets/shared/%s?v=%s%s' % (
            t.group('prefix'), t.group('rel'), version(path), t.group('frag') or '')
        return m.group(1) + value + m.group(3)
    return ATTR.sub(one, text)


def pages():
    for top in ('hq', 'sailing', os.path.join('tools', 'templates')):
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, top)):
            # assets/shared/ is the Pages build's gitignored copy of shared/,
            # present only on a machine that has run the build. Never stamp it.
            dirnames[:] = [d for d in dirnames
                           if not (d == 'shared' and os.path.basename(dirpath) == 'assets')]
            for name in sorted(filenames):
                if name.endswith('.html'):
                    yield os.path.join(dirpath, name)


def main():
    changed = 0
    for path in pages():
        # newline='' both ways, so the file's own line endings pass through.
        with open(path, encoding='utf-8', newline='') as fh:
            text = fh.read()
        new = stamp(text)
        if new != text:
            with open(path, 'w', encoding='utf-8', newline='') as fh:
                fh.write(new)
            print(os.path.relpath(path, ROOT).replace(os.sep, '/'))
            changed += 1
    print('assetver: %d file(s) restamped' % changed, file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
