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
  var SPEAKER = '<path class="solid" d="M4 9.5h3.4L12 5.6v12.8L7.4 14.5H4z"/>';
  var ICON_VOLUME_HIGH = '<svg class="stroke" viewBox="0 0 24 24">' + SPEAKER +
    '<path d="M16.2 9.2a4.3 4.3 0 0 1 0 5.6"/><path d="M18.6 6.8a7.6 7.6 0 0 1 0 10.4"/></svg>';
  var ICON_VOLUME_LOW = '<svg class="stroke" viewBox="0 0 24 24">' + SPEAKER +
    '<path d="M16.2 9.2a4.3 4.3 0 0 1 0 5.6"/></svg>';
  var ICON_VOLUME_OFF = '<svg class="stroke" viewBox="0 0 24 24">' + SPEAKER +
    '<path d="M16 9.7l4.2 4.6M20.2 9.7L16 14.3"/></svg>';

  var HIDE_CONTROLS_AFTER = 2200;   // ms of stillness before the bar fades
  var SHOW_VEIL_AFTER = 2500;       // ms of failure before we offer a button
  var RESTART_SOUND_WITHIN = 14;    // s; "turn sound on" replays from the top
  var GRAIN_STEP_MS = 84;           // ~12 fps of noise
  var VOLUME_STEP = 0.05;           // one arrow press on the volume slider
  var VOLUME_KEY = 'moss.volume';
  var MUTED_KEY = 'moss.muted';

  function byId(id) { return document.getElementById(id); }

  var video = byId('v');
  var frame = byId('frame');
  var veil = byId('veil');
  var poster = byId('poster');
  var sound = byId('sound');
  var playPause = byId('pp');
  var mute = byId('mute');
  var volume = byId('vol');
  var volumeRail = byId('volRail');
  var volumeFill = byId('volFill');
  var track = byId('track');
  var rail = byId('rail');
  var fill = byId('fill');
  var clock = byId('time');
  var buff = byId('buff');
  var titleEl = byId('ttl');
  var playButton = byId('go');
  var loadMsg = byId('load');

  var hideTimer = 0;
  var ended = false;
  var begun = false;
  var failed = false;
  var lastAudible = 0.8;

  /* ---------- remembered settings ---------- */

  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function recall(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  /* ---------- time ---------- */

  function formatClock(seconds) {
    if (!isFinite(seconds) || seconds < 0) { seconds = 0; }
    var whole = Math.floor(seconds);
    var minutes = Math.floor(whole / 60);
    var rest = whole % 60;
    return minutes + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function updateClock() {
    var now = formatClock(video.currentTime);
    var total = formatClock(video.duration);
    clock.textContent = now + ' / ' + total;
    track.setAttribute('aria-valuetext', now + ' of ' + total);
  }

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

  function setBuffering(on) {
    buff.classList.toggle('on', !!on);
  }

  function wake() {
    frame.classList.add('show');
    frame.style.cursor = '';          // the idle timer hid it; put it back
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (!video.paused && !dragging && !draggingVolume) {
        frame.classList.remove('show');
        frame.style.cursor = 'none';
      }
    }, HIDE_CONTROLS_AFTER);
  }

  function idleOut() {
    if (!video.paused) {
      clearTimeout(hideTimer);
      frame.classList.remove('show');
      frame.style.cursor = 'none';
    }
  }

  /* ---------- sound ---------- */

  function syncMuteIcon() {
    var silent = video.muted || video.volume === 0;
    mute.innerHTML = silent ? ICON_VOLUME_OFF : (video.volume < 0.5 ? ICON_VOLUME_LOW : ICON_VOLUME_HIGH);
    mute.setAttribute('aria-pressed', silent ? 'true' : 'false');
    mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
  }

  function applyVolume(level, remember) {
    var value = Math.max(0, Math.min(1, level));
    if (!isFinite(value)) { value = 1; }     // corrupt stored value
    video.volume = value;
    if (value > 0) { lastAudible = value; }
    volumeFill.style.width = (value * 100) + '%';
    volume.setAttribute('aria-valuenow', Math.round(value * 100));
    volume.setAttribute('aria-valuetext', Math.round(value * 100) + '%');
    if (remember) { store(VOLUME_KEY, String(value)); }
    syncMuteIcon();
  }

  /* Same as applyVolume, but a deliberate move — nudging up means "I want to hear it". */
  function setVolumeFromUser(level) {
    applyVolume(level, true);
    if (video.volume > 0 && video.muted) { setMuted(false); }
  }

  function setMuted(value) {
    video.muted = value;
    store(MUTED_KEY, value ? '1' : '0');
    syncMuteIcon();
    syncSoundButton();
  }

  function toggleMute() {
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) { applyVolume(lastAudible, true); }
      setMuted(false);
    } else {
      setMuted(true);
    }
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
    setMuted(false);
    veil.hidden = true;
    video.play();
  }

  function seekTo(clientX) {
    var box = rail.getBoundingClientRect();
    if (!box.width) { return; }
    var ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    video.currentTime = ratio * (video.duration || 0);
  }

  function nudge(seconds) {
    if (!isFinite(video.duration)) { return; }
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
    wake();
  }

  function toggleFullscreen() {
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
    /* iOS ignores scripts setting video.volume: the hardware buttons own it. */
    var volumeSettable = true;
    try {
      var before = video.volume;
      video.volume = 0.5;
      volumeSettable = Math.abs(video.volume - 0.5) < 0.01;
      video.volume = before;
    } catch (e) {
      volumeSettable = false;
    }

    var savedVolume = recall(VOLUME_KEY);
    applyVolume(savedVolume === null ? 1 : parseFloat(savedVolume), false);
    if (!volumeSettable) {
      volume.hidden = true;
      mute.hidden = true;
    }
    var startMuted = recall(MUTED_KEY) === '1' || !volumeSettable;
    setMuted(startMuted);

    var reel = byId('reel');
    if (reel) {
      try {
        video.src = unpackReel(reel);
      } catch (err) {
        loadMsg.textContent = 'Could not unpack the film — open single-file.html on a desktop browser, or use the streaming build.';
        return;
      }
    }

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      showVeil('The Moss Keeper', 'Watch with sound');
      return;
    }

    start(startMuted)
      .catch(function () { return start(true); })
      .catch(function () { if (!begun) { showVeil('The Moss Keeper', 'Watch with sound'); } });

    setTimeout(function () { if (!begun) { showVeil('The Moss Keeper', 'Watch with sound'); } }, SHOW_VEIL_AFTER);
  }

  /* ---------- wiring ---------- */

  playButton.addEventListener('click', function (event) {
    event.stopPropagation();
    if (failed) { window.location.reload(); return; }
    if (ended) { replay(); return; }
    setMuted(false);
    var attempt = video.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { setMuted(true); video.play(); });
    }
  });

  sound.addEventListener('click', function (event) {
    event.stopPropagation();
    setMuted(false);
    /* the score opens quietly; replay from the top rather than join it mid-bar */
    if (video.currentTime < RESTART_SOUND_WITHIN) { video.currentTime = 0; }
    sound.classList.remove('on');
    video.play();
  });

  frame.addEventListener('click', function (event) {
    if (event.target.closest('button,#track,#vol')) { return; }
    togglePlay();
  });
  frame.addEventListener('mousemove', wake);
  frame.addEventListener('touchstart', wake, { passive: true });
  frame.addEventListener('mouseleave', idleOut);

  playPause.addEventListener('click', function (event) {
    event.stopPropagation();
    togglePlay();
  });

  mute.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleMute();
  });

  byId('fs').addEventListener('click', function (event) {
    event.stopPropagation();
    toggleFullscreen();
  });

  /* ---------- volume slider ---------- */

  function volumeFromX(clientX) {
    var box = volumeRail.getBoundingClientRect();
    if (!box.width) { return; }
    setVolumeFromUser((clientX - box.left) / box.width);
  }

  var draggingVolume = false;
  volume.addEventListener('pointerdown', function (event) {
    event.stopPropagation();
    draggingVolume = true;
    volume.setPointerCapture(event.pointerId);
    volumeFromX(event.clientX);
  });
  volume.addEventListener('pointermove', function (event) {
    if (draggingVolume) { volumeFromX(event.clientX); }
  });
  volume.addEventListener('pointerup', function () { draggingVolume = false; });
  volume.addEventListener('pointercancel', function () { draggingVolume = false; });

  volume.addEventListener('keydown', function (event) {
    var step = event.shiftKey ? VOLUME_STEP * 2 : VOLUME_STEP;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      setVolumeFromUser(video.volume + step);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setVolumeFromUser(video.volume - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setVolumeFromUser(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setVolumeFromUser(1);
    }
  });

  /* ---------- seek bar ---------- */

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

  /* ---------- media events ---------- */

  video.addEventListener('loadedmetadata', function () {
    loadMsg.style.display = 'none';
    updateClock();
  });
  video.addEventListener('durationchange', updateClock);
  video.addEventListener('play', function () { setPlayIcon(true); ended = false; });
  video.addEventListener('playing', function () {
    setBuffering(false);
    hidePoster();
    syncSoundButton();
  });
  video.addEventListener('canplay', function () { setBuffering(false); });
  video.addEventListener('seeked', function () { setBuffering(false); });
  video.addEventListener('waiting', function () { setBuffering(true); });
  video.addEventListener('stalled', function () { setBuffering(true); });
  video.addEventListener('volumechange', function () { syncMuteIcon(); syncSoundButton(); });
  video.addEventListener('pause', function () {
    setPlayIcon(false);
    frame.classList.add('show');
    setBuffering(false);
    syncSoundButton();
  });
  video.addEventListener('timeupdate', function () {
    var percent = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    fill.style.width = percent + '%';
    track.setAttribute('aria-valuenow', Math.round(percent));
    updateClock();
  });
  video.addEventListener('ended', function () {
    ended = true;
    showVeil('The Moss Keeper', 'Watch again');
    frame.classList.add('show');
  });
  video.addEventListener('error', function () {
    failed = true;
    loadMsg.style.display = 'none';
    setBuffering(false);
    showVeil('The film could not be loaded', 'Reload');
  });

  window.addEventListener('keydown', function (event) {
    var target = event.target;
    var key = (event.key || '').toLowerCase();
    var inVolume = volume.contains && target && volume.contains(target);
    var onButton = target && target.closest && target.closest('button');

    if (event.code === 'Space' || key === ' ' || key === 'spacebar' || key === 'k') {
      if (onButton || inVolume) { return; }
      event.preventDefault();
      togglePlay();
      return;
    }
    if (inVolume) { return; }          // the slider handles its own arrows
    if (event.key === 'ArrowRight') {
      nudge(5);
    } else if (event.key === 'ArrowLeft') {
      nudge(-5);
    } else if (key === 'm') {
      toggleMute();
    } else if (key === 'f') {
      toggleFullscreen();
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

  setTimeout(boot, 30);   // let the opening frame paint before the decode
}());
