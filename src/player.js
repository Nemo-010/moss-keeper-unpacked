/*
 * The Moss Keeper — player.
 *
 * Unpacked from the single-file original at github.com/ChetasLua/moss-keeper,
 * where this was one minified IIFE at the bottom of a 48 MB page. Same
 * behaviour, names instead of single letters, and it drives either a real
 * video file or the base64 payload:
 *
 *   index.html         the film as a real file             streams and caches
 *   single-file.html   the film base64'd into a script tag  nothing else to fetch
 *
 * The player checks for the reel element itself, so both builds share this file.
 * (Keep any literal script tag out of this file: the browser ends the element at
 * the first closing one, wherever it appears.)
 */
(function () {
  'use strict';

  var ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';
  var ICON_PLAY = 'M8 5l11 7-11 7z';

  var HIDE_CONTROLS_AFTER = 2200;   // ms of stillness before the bar fades
  var SHOW_VEIL_AFTER = 2500;       // ms of failure before we offer a button
  var RESTART_SOUND_WITHIN = 14;    // s; "turn sound on" replays from the top
  var GRAIN_STEP_MS = 84;           // ~12 fps of noise

  function byId(id) { return document.getElementById(id); }

  var video = byId('v');
  var frame = byId('frame');
  var veil = byId('veil');
  var poster = byId('poster');
  var sound = byId('sound');
  var playPause = byId('pp');
  var track = byId('track');
  var rail = byId('rail');
  var fill = byId('fill');
  var titleEl = byId('ttl');
  var playButton = byId('go');
  var loadMsg = byId('load');

  var hideTimer = 0;
  var ended = false;
  var begun = false;

  /* ---------- chrome ---------- */

  function setPlayIcon(isPlaying) {
    playPause.innerHTML = '<svg viewBox="0 0 24 24"><path d="' +
      (isPlaying ? ICON_PAUSE : ICON_PLAY) + '"/></svg>';
    playPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function hidePoster() {
    poster.style.opacity = 0;
    setTimeout(function () { poster.style.display = 'none'; }, 900);
    veil.hidden = true;
    begun = true;
  }

  function showVeil(label, buttonLabel) {
    titleEl.textContent = label;
    playButton.textContent = buttonLabel;
    veil.hidden = false;
  }

  /* Only offered once playback started muted, so the film is running but silent. */
  function syncSoundButton() {
    sound.classList.toggle('on', video.muted && !video.paused);
  }

  function wake() {
    frame.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!video.paused) {
        frame.classList.remove('show');
        frame.style.cursor = 'none';
      }
    }, HIDE_CONTROLS_AFTER);
  }

  /* ---------- transport ---------- */

  function start(muted) {
    video.muted = muted;
    return Promise.resolve(video.play());
  }

  function togglePlay() {
    if (ended) { replay(); return; }
    if (video.paused) { video.play(); } else { video.pause(); }
  }

  function replay() {
    ended = false;
    video.currentTime = 0;
    video.muted = false;
    veil.hidden = true;
    video.play();
  }

  function seekTo(clientX) {
    var box = rail.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    video.currentTime = ratio * (video.duration || 0);
  }

  function nudge(seconds) {
    if (!isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    wake();
  }

  /* ---------- the payload, if this is the single-file build ---------- */

  function unpackReel(el) {
    var base64 = el.textContent.trim();
    el.textContent = '';                  // drop the 64 MB string before decoding
    var binary = atob(base64);
    base64 = null;
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
    return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  }

  /* ---------- boot ---------- */

  function boot() {
    var reel = byId('reel');
    if (reel) {
      try {
        video.src = unpackReel(reel);
      } catch (err) {
        loadMsg.textContent = 'Could not unpack the film — open single-file.html on a desktop browser, or use the streaming build.';
        return;
      }
    }
    loadMsg.style.display = 'none';

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      showVeil('The Moss Keeper', 'Watch with sound');
      return;
    }

    start(false)
      .catch(function () { return start(true); })
      .catch(function () { if (!begun) { showVeil('The Moss Keeper', 'Watch with sound'); } });

    setTimeout(function () { if (!begun) { showVeil('The Moss Keeper', 'Watch with sound'); } }, SHOW_VEIL_AFTER);
  }

  /* ---------- wiring ---------- */

  playButton.addEventListener('click', function (event) {
    event.stopPropagation();
    if (ended) { replay(); return; }
    video.muted = false;
    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { video.muted = true; video.play(); });
    }
  });

  sound.addEventListener('click', function (event) {
    event.stopPropagation();
    video.muted = false;
    /* the score opens quietly; replay from the top rather than join it mid-bar */
    if (video.currentTime < RESTART_SOUND_WITHIN) { video.currentTime = 0; }
    sound.classList.remove('on');
    video.play();
  });

  frame.addEventListener('click', function (event) {
    if (event.target.closest('button,#track')) { return; }
    togglePlay();
  });
  frame.addEventListener('mousemove', wake);
  frame.addEventListener('touchstart', wake, { passive: true });

  playPause.addEventListener('click', function (event) {
    event.stopPropagation();
    togglePlay();
  });

  byId('fs').addEventListener('click', function (event) {
    event.stopPropagation();
    var doc = document;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    } else if (frame.requestFullscreen) {
      frame.requestFullscreen();
    } else if (frame.webkitRequestFullscreen) {
      frame.webkitRequestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();   // iPhone: the video element, not the frame
    }
  });

  var dragging = false;
  track.addEventListener('pointerdown', function (event) {
    event.stopPropagation();
    dragging = true;
    track.setPointerCapture(event.pointerId);
    seekTo(event.clientX);
  });
  track.addEventListener('pointermove', function (event) { if (dragging) { seekTo(event.clientX); } });
  track.addEventListener('pointerup', function () { dragging = false; });
  track.addEventListener('pointercancel', function () { dragging = false; });

  video.addEventListener('play', function () { setPlayIcon(true); ended = false; });
  video.addEventListener('playing', function () { hidePoster(); syncSoundButton(); });
  video.addEventListener('volumechange', syncSoundButton);
  video.addEventListener('pause', function () {
    setPlayIcon(false);
    frame.classList.add('show');
    syncSoundButton();
  });
  video.addEventListener('timeupdate', function () {
    var percent = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    fill.style.width = percent + '%';
    track.setAttribute('aria-valuenow', Math.round(percent));
  });
  video.addEventListener('ended', function () {
    ended = true;
    showVeil('The Moss Keeper', 'Watch again');
    frame.classList.add('show');
  });

  window.addEventListener('keydown', function (event) {
    /* leave Space alone when a control has focus, so buttons still activate */
    var onControl = event.target && event.target.closest && event.target.closest('button,[role="slider"]');
    if (event.code === 'Space' || (event.key || '').toLowerCase() === 'k') {
      if (onControl) { return; }
      event.preventDefault();
      togglePlay();
    } else if (event.key === 'ArrowRight') {
      nudge(5);
    } else if (event.key === 'ArrowLeft') {
      nudge(-5);
    } else if ((event.key || '').toLowerCase() === 'm') {
      video.muted = !video.muted;
      sound.classList.remove('on');
    } else if ((event.key || '').toLowerCase() === 'f') {
      byId('fs').click();
    }
  });

  /* ---------- grain, drawn here so neither build ships a film-grain asset ---------- */

  var grain = byId('grain');
  var ctx = grain.getContext('2d');
  var grainWidth = grain.width;
  var grainHeight = grain.height;
  var frames = [];

  for (var f = 0; f < 6; f++) {
    var image = ctx.createImageData(grainWidth, grainHeight);
    for (var p = 0; p < image.data.length; p += 4) {
      var shade = 128 + (Math.random() - 0.5) * 190;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = shade;
      image.data[p + 3] = 255;
    }
    frames.push(image);
  }

  grain.style.width = '100%';
  grain.style.height = '100%';

  var grainIndex = 0;
  var lastGrain = 0;
  (function tick(now) {
    requestAnimationFrame(tick);
    if (now - lastGrain < GRAIN_STEP_MS || video.paused) { return; }
    lastGrain = now;
    grainIndex = (grainIndex + 1 + Math.floor(Math.random() * 4)) % frames.length;
    ctx.putImageData(frames[grainIndex], 0, 0);
  }(0));

  setTimeout(boot, 30);   // let "Unrolling the film…" paint before the decode
}());
