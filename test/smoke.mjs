import { JSDOM } from "jsdom";
import fs from "node:fs";

const file = process.argv[2];
const html = fs.readFileSync(file, "utf8");
const errors = [];

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://example.test/",
  beforeParse(window) {
    // jsdom has no media stack: record calls instead of throwing
    window.HTMLMediaElement.prototype.play = function () { this.dataset.played = "1"; return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () { this.dataset.paused = "1"; };
    window.HTMLMediaElement.prototype.load = function () {};
    Object.defineProperty(window.HTMLMediaElement.prototype, "duration", { get() { return 80.6; }, configurable: true });
    Object.defineProperty(window.HTMLMediaElement.prototype, "paused", { get() { return false; }, configurable: true });
    window.URL.createObjectURL = () => "blob:stub";
    window.HTMLCanvasElement.prototype.getContext = function () {
      const data = () => new Uint8ClampedArray(256 * 139 * 4);
      return { createImageData: () => ({ data: data() }), putImageData() {} };
    };
    // pointer plumbing jsdom lacks
    window.Element.prototype.setPointerCapture = function () {};
    window.Element.prototype.releasePointerCapture = function () {};
    window.addEventListener("error", (e) => errors.push("error: " + (e.message || e.error)));
    window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + e.reason));
  },
});

const { window } = dom;
const doc = window.document;
const $ = (id) => doc.getElementById(id);

const checks = [];
const check = (name, pass, extra = "") => checks.push([name, pass, extra]);

await new Promise((r) => setTimeout(r, 140));   // let the 30 ms boot run

const v = $("v");

/* ---------- structure ---------- */
const ids = ["v","frame","veil","poster","sound","pp","mute","vol","volRail","volFill",
             "track","rail","fill","time","buff","ttl","go","load","fs","grain","bar"];
const missing = ids.filter((id) => !$(id));
check("all player elements present", missing.length === 0, missing.join(","));
check("no placeholder left in the page", !html.includes("{{"));
check("grain canvas has a 2d context", !!$("grain").getContext("2d"));

/* ---------- volume slider (the new bit) ---------- */
check("volume slider is a labelled slider",
  $("vol").getAttribute("role") === "slider" && $("vol").getAttribute("aria-label") === "Volume" &&
  $("vol").getAttribute("aria-valuemin") === "0" && $("vol").getAttribute("aria-valuemax") === "100");
check("volume starts at 100%", $("vol").getAttribute("aria-valuenow") === "100" && v.volume === 1,
  `${$("vol").getAttribute("aria-valuenow")} / ${v.volume}`);
check("volume slider visible when volume is settable", !$("vol").hidden);

// keyboard: the slider owns its arrows
const volKey = (key, shift = false) => {
  const ev = new window.KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true });
  $("vol").dispatchEvent(ev);
  return ev.defaultPrevented;
};
check("ArrowDown lowers the volume", volKey("ArrowDown") && Math.abs(v.volume - 0.95) < 1e-6, String(v.volume));
check("ArrowUp raises it back", volKey("ArrowUp") && Math.abs(v.volume - 1) < 1e-6, String(v.volume));
check("Home drops to 0", volKey("Home") && v.volume === 0, String(v.volume));
check("End returns to 1", volKey("End") && v.volume === 1, String(v.volume));
check("arrow key on the slider is consumed, not treated as a seek", volKey("ArrowLeft"));

// geometry: a drag sets the level from the track position
$("volRail").getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 2, right: 100, bottom: 2 });
$("vol").dispatchEvent(new window.MouseEvent("pointerdown", { clientX: 25, bubbles: true }));
check("clicking a quarter along sets ~25%", Math.abs(v.volume - 0.25) < 0.02, String(v.volume));
check("volume fill follows the level", $("volFill").style.width === "25%", $("volFill").style.width);
check("aria-valuenow follows the level", $("vol").getAttribute("aria-valuenow") === "25",
  $("vol").getAttribute("aria-valuenow"));

/* ---------- mute ---------- */
check("mute button starts unpressed", $("mute").getAttribute("aria-pressed") === "false");
$("mute").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("mute button mutes", v.muted === true);
check("mute button is pressed when muted", $("mute").getAttribute("aria-pressed") === "true");
check("mute icon changes to the crossed speaker", $("mute").innerHTML.includes("M16 9.7"));
$("mute").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
check("mute button unmutes and keeps the level", v.muted === false && Math.abs(v.volume - 0.25) < 0.02,
  `${v.muted} / ${v.volume}`);

/* ---------- persistence ---------- */
check("volume is remembered", window.localStorage.getItem("moss.volume") !== null,
  String(window.localStorage.getItem("moss.volume")));
check("mute state is remembered", window.localStorage.getItem("moss.muted") !== null,
  String(window.localStorage.getItem("moss.muted")));

/* ---------- time readout + seek bar ---------- */
v.currentTime = 40.3;
v.dispatchEvent(new window.Event("timeupdate"));
check("clock reads 0:40 / 1:20", $("time").textContent === "0:40 / 1:20", $("time").textContent);
check("seek bar reaches ~50%", String($("fill").style.width).startsWith("50"), $("fill").style.width);
check("slider aria-valuenow tracks", $("track").getAttribute("aria-valuenow") === "50");
check("slider aria-valuetext is spoken", $("track").getAttribute("aria-valuetext") === "0:40 of 1:20",
  $("track").getAttribute("aria-valuetext"));

/* ---------- buffering + errors ---------- */
v.dispatchEvent(new window.Event("waiting"));
check("spinner shows while waiting", $("buff").classList.contains("on"));
v.dispatchEvent(new window.Event("playing"));
check("spinner hides when playing", !$("buff").classList.contains("on"));

/* ---------- lifecycle ---------- */
v.dispatchEvent(new window.Event("pause"));
check("controls shown on pause", $("frame").classList.contains("show"));
v.dispatchEvent(new window.Event("ended"));
check("veil offers a replay", $("ttl").textContent === "The Moss Keeper" && $("go").textContent === "Watch again");

/* ---------- cursor comes back (upstream bug) ---------- */
$("frame").style.cursor = "none";
$("frame").dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true }));
check("mousemove restores the cursor", $("frame").style.cursor === "", JSON.stringify($("frame").style.cursor));

/* ---------- keyboard ---------- */
const bodyKey = (code, key, target) => {
  const ev = new window.KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true });
  (target || doc.body).dispatchEvent(ev);
  return ev.defaultPrevented;
};
check("space is handled on the body", bodyKey("Space", " "));
check("space is not stolen from a focused button", !bodyKey("Space", " ", $("go")));

/* ---------- build-specific ---------- */
if ($("reel")) {
  check("reel payload consumed", $("reel").textContent === "");
  check("video src came from the blob", String(v.src).startsWith("blob:"), String(v.src).slice(0, 20));
} else {
  check("no reel in the asset build", true);
}

/* ---------- error state ---------- */
v.dispatchEvent(new window.Event("error"));
check("error shows a reload offer", !$("veil").hidden && $("go").textContent === "Reload",
  $("go").textContent);

check("no runtime errors", errors.length === 0, errors.join(" | "));

let failed = 0;
for (const [name, pass, extra] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra && !pass ? "  -> " + extra : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed  (${file})`);
process.exit(failed ? 1 : 0);
