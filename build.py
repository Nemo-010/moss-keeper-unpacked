#!/usr/bin/env python3
"""Build The Moss Keeper page from separate assets.

One template, one player, two outputs:

  index.html        the film as a real file — streams, seeks, caches
  single-file.html  the film base64'd into the page — one file, nothing to fetch

Usage:
  ./build.py                                  # both, into ./site
  ./build.py --film x.mp4 --poster y.jpg --out dist
  ./build.py --only single-file
  ./build.py --verify upstream/index.html     # prove the payload is just base64

No dependencies beyond the standard library.
"""

import argparse
import base64
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"

REEL_TAG = re.compile(
    r'(<script type="text/plain" id="reel">)([A-Za-z0-9+/=]+)(</script>)')
POSTER_URI = re.compile(r'(src="data:image/jpeg;base64,)([A-Za-z0-9+/=]+)(")')

NOSCRIPT_ASSET = (
    'The player needs JavaScript. '
    '<a href="film.mp4" style="color:var(--accent)">Open the film directly</a>.')
NOSCRIPT_SINGLE = (
    'This build needs JavaScript to unpack the film. '
    '<a href="index.html" style="color:var(--accent)">Use the streaming page</a>.')


def encode(path):
    return base64.b64encode(path.read_bytes()).decode("ascii")


def render(template, player, poster_src, video_attrs, reel, head_extra, noscript):
    source = player.read_text(encoding="utf-8")
    if "</script" in source.lower():
        sys.exit("player.js contains a closing script tag; the browser would cut it there")
    fields = {
        "POSTER_SRC": poster_src,
        "VIDEO_ATTRS": video_attrs,
        "REEL": reel,
        "HEAD_EXTRA": head_extra,
        "NOSCRIPT": noscript,
        "PLAYER": source.rstrip("\n"),
    }
    out = template
    for key, value in fields.items():
        placeholder = "{{%s}}" % key
        if placeholder not in out:
            sys.exit("template is missing %s" % placeholder)
        out = out.replace(placeholder, value)
    return out


def build(out_dir, film, poster, only):
    template = (SRC / "page.html").read_text(encoding="utf-8")
    player = SRC / "player.js"

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "player.js").write_bytes(player.read_bytes())
    (out_dir / "film.mp4").write_bytes(film.read_bytes())
    (out_dir / "poster.jpg").write_bytes(poster.read_bytes())

    film_bytes = film.stat().st_size

    if only in ("all", "index"):
        page = render(
            template, player,
            poster_src="poster.jpg",
            video_attrs=' src="film.mp4"',
            reel="",
            head_extra='<link rel="preload" as="video" href="film.mp4" type="video/mp4">',
            noscript=NOSCRIPT_ASSET,
        )
        (out_dir / "index.html").write_text(page, encoding="utf-8")
        print("  %-18s %10d B  (video is a separate, range-requestable file)"
              % ("index.html", len(page.encode())))

    if only in ("all", "single-file"):
        reel = '<script type="text/plain" id="reel">%s</script>' % encode(film)
        page = render(
            template, player,
            poster_src="data:image/jpeg;base64," + encode(poster),
            video_attrs="",
            reel=reel,
            head_extra="",
            noscript=NOSCRIPT_SINGLE,
        )
        (out_dir / "single-file.html").write_text(page, encoding="utf-8")
        size = len(page.encode())
        print("  %-18s %10d B  (%.2fx the %d B film, base64)"
              % ("single-file.html", size, size / film_bytes, film_bytes))

    print("  out: %s" % out_dir)


def verify(path):
    """Prove the original page hid nothing: the payload is base64 and nothing else."""
    html = path.read_text(encoding="utf-8")
    print("verifying %s (%d bytes)" % (path.name, len(html.encode())))

    reel = REEL_TAG.search(html)
    if not reel:
        sys.exit("no reel payload found")
    poster = POSTER_URI.search(html)
    if not poster:
        sys.exit("no poster payload found")

    ok = True
    blobs = {}
    for name, match, group in (("film", reel, 2), ("poster", poster, 2)):
        encoded = match.group(group)
        raw = base64.b64decode(encoded)
        round_trip = base64.b64encode(raw).decode("ascii") == encoded
        blobs[name] = (encoded, raw)
        print("  %-6s base64 %10d chars -> %10d B  sha256 %s"
              % (name, len(encoded), len(raw), hashlib.sha256(raw).hexdigest()))
        print("         re-encodes to the identical string: %s" % ("yes" if round_trip else "NO"))
        ok = ok and round_trip

    skeleton = html
    for name, pattern in (("film", REEL_TAG), ("poster", POSTER_URI)):
        encoded, _ = blobs[name]
        skeleton = skeleton.replace(encoded, "@@%s@@" % name.upper(), 1)

    rebuilt = skeleton
    for name in ("film", "poster"):
        rebuilt = rebuilt.replace("@@%s@@" % name.upper(), blobs[name][0])

    same_file = rebuilt == html
    print("  %-6s bytes outside the payload: %d" % ("", len(skeleton.encode())))
    print("  %-6s payload re-embeds to the identical file: %s"
          % ("", "yes" if same_file else "NO"))
    ok = ok and same_file

    print("  %s" % ("PASS - nothing but base64 was hidden" if ok else "FAIL"))
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--film", type=pathlib.Path, default=ROOT / "media" / "film.mp4")
    parser.add_argument("--poster", type=pathlib.Path, default=ROOT / "media" / "poster.jpg")
    parser.add_argument("--out", type=pathlib.Path, default=ROOT / "site")
    parser.add_argument("--only", choices=("all", "index", "single-file"), default="all")
    parser.add_argument("--verify", type=pathlib.Path, metavar="UPSTREAM_HTML",
                        help="check that a single-file build is only base64, then exit")
    args = parser.parse_args()

    if args.verify:
        return verify(args.verify)

    for path in (args.film, args.poster):
        if not path.is_file():
            sys.exit("missing %s" % path)

    build(args.out, args.film, args.poster, args.only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
