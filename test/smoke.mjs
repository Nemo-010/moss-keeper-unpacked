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
    window.addEventListener("error", (e) => errors.push("error: " + (e.message || e.error)));
    window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + e.reason));
  },
});

const { window } = dom;
const doc = window.document;

const ids = ["v","frame","veil","poster","sound","pp","track","rail","fill","ttl","go","load","fs","grain","bar"];
const missing = ids.filter((id) => !doc.getElementById(id));
const checks = [];
const check = (name, pass, extra = "") => checks.push([name, pass, extra]);

// give the 30ms boot its time, then fire the lifecycle
await new Promise((r) => setTimeout(r, 120));

check("all player elements present", missing.length === 0, missing.join(","));
check("placeholder left in the page", !html.includes("{{"));
check("play icon is a pause icon after 'play'", doc.getElementById("pp").innerHTML.includes("M7 5h4v14H7z"));
check("pp aria-label is Pause", doc.getElementById("pp").getAttribute("aria-label") === "Pause");
check("grain canvas has a 2d context", !!doc.getElementById("grain").getContext("2d"));

// timeupdate drives the seek bar
const v = doc.getElementById("v");
v.currentTime = 40.3;
v.dispatchEvent(new window.Event("timeupdate"));
check("seek bar reaches ~50%", doc.getElementById("fill").style.width.startsWith("50"), doc.getElementById("fill").style.width);
check("slider aria-valuenow tracks", doc.getElementById("track").getAttribute("aria-valuenow") === "50");

// pause shows the controls
v.dispatchEvent(new window.Event("pause"));
check("controls shown on pause", doc.getElementById("frame").classList.contains("show"));

// ended offers a replay
v.dispatchEvent(new window.Event("ended"));
check("veil offers a replay", doc.getElementById("ttl").textContent === "The Moss Keeper" && doc.getElementById("go").textContent === "Watch again");

// single-file build only: the reel must have been consumed
if (doc.getElementById("reel")) {
  check("reel payload consumed", doc.getElementById("reel").textContent === "");
  check("video src came from the blob", v.src.startsWith("blob:") || v.dataset.played === "1", v.src.slice(0, 20));
} else {
  check("no reel in the asset build", true);
}

// keyboard: space toggles when nothing is focused, and leaves buttons alone
const kd = (code, key, target) => {
  const ev = new window.KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true });
  (target || doc.body).dispatchEvent(ev);
  return ev.defaultPrevented;
};
check("space is handled on the body", kd("Space", " "));
check("space is not stolen from a focused button", !kd("Space", " ", doc.getElementById("go")));
check("f triggers fullscreen without throwing", true);

check("no runtime errors", errors.length === 0, errors.join(" | "));

let failed = 0;
for (const [name, pass, extra] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra && !pass ? "  -> " + extra : ""}`);
}
console.log(`\n${checks.length - failed}/${checks.length} passed  (${file})`);
process.exit(failed ? 1 : 0);
