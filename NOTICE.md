# Notice

## Upstream

The Moss Keeper — the film, the poster and the page design — is by ChetasLua:

- <https://github.com/ChetasLua/moss-keeper> (commit `75148b8`, 2026-11-02)
- Live: <https://chetaslua.github.io/moss-keeper/>

That repository carries **no license file** (checked `2026-11-03`, `gh api .license` is `null`), so upstream is
all rights reserved by default. Its README does say, in public: *"Feel free to copy it, remix it, and learn
from it."* This repository treats that sentence as permission to redistribute the film and to publish a
modified page built from it. If the author would rather it not be here — or would like a specific license
used instead — open an issue and it comes down or changes.

Nothing here is a claim of authorship over the film. The player code, the builder and the template in this
repository are new work and carry 0BSD (see `LICENSE`).

## What was extracted

Both payloads in the upstream single-file page are plain, unwrapped base64 and nothing else. Recorded here so
anyone can check:

| blob | base64 chars | bytes | sha256 |
| --- | --- | --- | --- |
| film | 47,947,092 | 35,960,319 | `69adae1d4514a3c7ea2c743c71858fbff09b83c91ebdbacb6325c228a3965c0c` |
| poster | 303,156 | 227,366 | `fdf6db85910d2e5efd478883c68e304b9591fd3d7fcd179e6b7669f1745a1570` |

The upstream `index.html` is sha256 `73fac5940a046b0cd47e7b9f7cd1a2e87240ca03881389ab27ecb7dedfdfe9da`
(48,259,444 bytes), of which 9,214 bytes are the page itself.

```console
$ python3 build.py --verify path/to/upstream/index.html
  film   base64   47947092 chars ->   35960319 B  sha256 69adae1d...
         re-encodes to the identical string: yes
  poster base64     303156 chars ->     227366 B  sha256 fdf6db85...
         re-encodes to the identical string: yes
         bytes outside the payload: 9214
         payload re-embeds to the identical file: yes
  PASS - nothing but base64 was hidden
```

The film is an 80.6 s 1920x1040 H.264/AAC clip, 24 fps, `moov` ahead of `mdat`, decodes end to end with no
errors, mastered to −14.5 LUFS integrated.

## What changed in the page

Deliberate differences from upstream, all in the player source:

- The film and poster are separate files in the default build, so the video streams and seeks over range
  requests instead of riding inside the HTML. (On GitHub Pages both still get `cache-control: max-age=600`.)
- A volume slider and mute button, with keyboard support and the level remembered between visits; both hide
  themselves where a script cannot set volume (iOS).
- A clock (`0:41 / 1:20`), an `aria-valuetext` on the seek bar, a buffering spinner when the stream stalls,
  and a reload offer when the film fails to load.
- The cursor is restored when the controls come back. Upstream hid it after 2.2 s of stillness and never put
  it back, so the pointer stayed invisible for the rest of the film.
- `try/catch` around the base64 decode, with a message instead of a permanent "Unrolling the film…".
- `<noscript>` fallback.
- Space no longer hijacks activation of a focused button.
- Arrow-key seeks are guarded against a NaN duration before metadata arrives, and the volume slider owns its
  own arrow keys instead of seeking with them.
- `pointercancel` ends a drag on either slider.
- `role="group"` on the frame, so its label is actually announced.
- The "turn sound on" rewind is a named constant (`RESTART_SOUND_WITHIN`), documented in the README, rather
  than a bare `14`.
- A credit link to the upstream repository in the control bar.
