# The Moss Keeper — unpacked

A rebuild of ChetasLua's [The Moss Keeper](https://github.com/ChetasLua/moss-keeper), an 80-second
hand-drawn-style anime scene delivered as a single 46 MB HTML page, plus the builder that puts it back
together.

- **Watch (streaming build):** <https://nemo-010.github.io/moss-keeper-unpacked/>
- **The single-file build, rebuilt from source:** <https://nemo-010.github.io/moss-keeper-unpacked/single-file.html>
- **Original, untouched:** <https://chetaslua.github.io/moss-keeper/>

## What was in there

Nothing was obfuscated. The page is 9,214 bytes of readable HTML, CSS and JavaScript; the other
48,250,230 bytes are two base64 blobs — a 35,960,319-byte MP4 and a 227,366-byte poster JPEG — with no
wrapping, no compression and no second layer.

```console
$ python3 build.py --verify path/to/upstream/index.html
  film   base64   47947092 chars ->   35960319 B  sha256 69adae1d4514a3c7ea2c743c71858fbff09b83c91ebdbacb6325c228a3965c0c
         re-encodes to the identical string: yes
  poster base64     303156 chars ->     227366 B  sha256 fdf6db85910d2e5efd478883c68e304b9591fd3d7fcd179e6b7669f1745a1570
         re-encodes to the identical string: yes
         bytes outside the payload: 9214
         payload re-embeds to the identical file: yes
  PASS - nothing but base64 was hidden
```

`--verify` decodes both blobs, re-encodes them and checks that the result is byte-identical to the original
file, so the claim is checkable rather than asserted. See [NOTICE.md](NOTICE.md) for hashes and attribution.

## Two builds, one template

`build.py` renders `src/page.html` with `src/player.js` and writes both:

| build | what it is | size |
| --- | --- | --- |
| `index.html` | the film as a real `film.mp4` next to the page | 15 KB page, 36 MB video |
| `single-file.html` | the film base64'd back into the page | 48.3 MB, 1.34× the film |

The single-file build is the upstream trick, kept because it is the interesting part: one file, no server,
works from `file://`, nothing else to fetch. It is not the build to publish a film with.

## Builder

```console
# both outputs into ./site from the extracted media
$ python3 build.py

# your own film and poster
$ python3 build.py --film short.mp4 --poster still.jpg --out dist

# just one of them
$ python3 build.py --only single-file
```

Standard library only, no network, no build toolchain. `media/film.mp4` and `media/poster.jpg` are the
extracted originals; `checksums.txt` pins them.

## Test

The player is exercised in a real DOM (jsdom) — element wiring, play/pause icon, seek bar, `timeupdate`,
`ended` → replay, the reel decode in the single-file build, and the keyboard rules:

```console
$ cd test && npm install
$ node smoke.mjs ../site/index.html
$ node smoke.mjs ../site/single-file.html
```

This caught one real bug during the rebuild: a literal `</script>` inside a *comment* in `player.js` closes
the script element, which silently truncated the player at 418 bytes. `build.py` now refuses to build if the
player contains one.

## Changes from upstream

The player is the original logic with names instead of single letters, plus a handful of fixes: streaming
video instead of an inlined blob, `try/catch` on decode, `<noscript>`, Space no longer stolen from focused
buttons, NaN guards on arrow seeks, `pointercancel` on the seek bar, and a documented constant for
"turn sound on" replaying from the top. The full list is in [NOTICE.md](NOTICE.md).

## Credit and license

The film, the poster and the page design are ChetasLua's work; upstream carries no license file, and its
README invites copying and remixing, which this repository relies on. The builder, player and template here
are new work under 0BSD. If the author wants this taken down or re-licensed, open an issue and it will be.
