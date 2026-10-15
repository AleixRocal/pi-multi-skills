#!/usr/bin/env node
/**
 * Demo animation — `docs/images/demo.mp4`, the asset `pi.video` points at.
 *
 * What this is, and what it is not: an animation rendered from the behaviour the
 * suite asserts, not a screen recording of a live pi session. Every step it
 * shows (the menu opening on a chain token, positional binding, a single
 * `/skill:name` keeping pi's card) has a spec in `tests/`, which is why the
 * frames can be generated deterministically at all — the page is a pure function
 * of time, so a re-run produces the same video byte for byte.
 *
 * How it works: one HTML page is loaded in headless Chromium, and each frame is
 * produced by evaluating `renderAt(t)` over the DevTools protocol and taking a
 * screenshot. Driving the clock rather than waiting for it is what keeps the
 * output stable; `Date.now` never enters the page.
 *
 * Usage:
 *   node scripts/demo-video.mjs                 # frames + mp4 + poster
 *   node scripts/demo-video.mjs --frames-only   # leave the PNGs in /tmp for review
 *   node scripts/demo-video.mjs --fps 24 --seconds 14
 *
 * Chromium comes from `CHROME_BIN` or the Playwright cache; ffmpeg from
 * `FFMPEG_BIN` or `PATH` (a static build works: it needs libx264 and png). With
 * neither present the step is reported and skipped, like `diagrams.mjs`.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "images");
const FRAME_DIR = "/tmp/pi-multi-skills-demo-frames";
// The page lives outside FRAME_DIR on purpose: captureFrames wipes that
// directory, and it used to wipe the page along with the frames — Chromium then
// loaded a missing file, rendered its error page 240 times, and every frame came
// out identical with no error anywhere.
const PAGE_PATH = "/tmp/pi-multi-skills-demo.html";

const WIDTH = 1280;
const HEIGHT = 720;
const DEBUG_PORT = 9333;

function arg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : Number(process.argv[index + 1]);
}

const FPS = arg("fps", 20);
const SECONDS = arg("seconds", 12);
const GIF_FPS = arg("gif-fps", 12);
const GIF_WIDTH = arg("gif-width", 1000);

/**
 * The animation, as one HTML document. `renderAt(ms)` is the whole contract:
 * every visual difference between two frames comes from that call, so the driver
 * can render any frame in any order.
 */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: #0d1117;
    color: #e6edf3;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    -webkit-font-smoothing: antialiased;
  }
  .window { position: absolute; inset: 18px; border: 1px solid #30363d; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
  .titlebar { height: 40px; background: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .title { margin-left: 8px; font-size: 13px; color: #9198a1; }
  .body { flex: 1; padding: 22px 24px; position: relative; }
  .line { font-size: 23px; line-height: 1.5; white-space: pre; }
  .prompt { color: #3fb950; }
  .tok { color: #79c0ff; }
  .arg { color: #e6edf3; }
  .cursor { background: #e6edf3; color: #0d1117; }
  .menu { position: absolute; left: 44px; width: 300px; border: 1px solid #4493f8; border-radius: 8px; background: #161b22; overflow: hidden; }
  .item { font-size: 18px; padding: 7px 14px; color: #9198a1; }
  .item.active { background: #1f6feb33; color: #e6edf3; border-left: 3px solid #4493f8; }
  .panel { border: 1px solid #30363d; border-radius: 10px; background: #161b22; padding: 14px 16px; }
  .panel.open { border-color: #4493f8; }
  .label { font-size: 13px; color: #9198a1; letter-spacing: .04em; }
  .block { font-size: 15px; line-height: 1.7; white-space: pre; color: #e6edf3; }
  .block .tag { color: #a371f7; }
  .block .args { color: #79c0ff; }
  .caption { font-size: 15px; color: #9198a1; }
  .footer { position: absolute; left: 24px; right: 24px; bottom: 16px; display: flex; justify-content: space-between; font-size: 13px; color: #6e7681; }
  .mount { color: #3fb950; }
  .col { width: 640px; vertical-align: top; }
</style>
</head>
<body>
<div class="window">
  <div class="titlebar">
    <div class="dot" style="background:#f85149"></div>
    <div class="dot" style="background:#d29922"></div>
    <div class="dot" style="background:#3fb950"></div>
    <div class="title">pi — pi-multi-skills</div>
  </div>
  <div class="body">
    <div id="promptLine" class="line"></div>
    <div id="menu" class="menu" style="display:none">
      <div class="item" data-row="0">/skill:design</div>
      <div class="item" data-row="1">/skill:plan</div>
      <div class="item" data-row="2">/skill:skills</div>
    </div>
    <div id="handoff" style="margin-top:26px"></div>
  </div>
  <div class="footer">
    <span id="footLeft"></span>
    <span>pi-multi-skills · every step asserted by the test suite</span>
  </div>
</div>
<script>
  const SEG1 = "/skill:research refactor auth /ski";
  const SEG2 = " write tests";
  const COMPLETION = "ll:design";
  const T = {
    type1Start: 700, cps: 15,
    accept: 4700, type2Start: 5000,
    enter: 6300, clearEnter: 6900,
    panel: 6600, block1: 6900, args1: 7300, block2: 7900, args2: 8300,
    caption: 9000, final: 10200, end: 12000,
  };

  const msPerChar = 1000 / T.cps;
  const length = (s) => s.length;

  function typedPrefix(t) {
    const seg1End = T.type1Start + length(SEG1) * msPerChar;
    if (t < T.accept) {
      const n = Math.max(0, Math.floor((t - T.type1Start) / msPerChar));
      return SEG1.slice(0, Math.min(n, length(SEG1)));
    }
    if (t < T.type2Start) return SEG1 + COMPLETION;
    const n = Math.max(0, Math.floor((t - T.type2Start) / msPerChar));
    return SEG1 + COMPLETION + SEG2.slice(0, Math.min(n, length(SEG2)));
  }

  // The menu is the wrapper's: it answers once a token is committed and the
  // fragment is name-shaped, so it appears on "/s" and not before.
  function menuVisible(t) {
    const text = typedPrefix(t);
    const tokenStart = text.lastIndexOf("/s");
    return t >= T.type1Start && tokenStart > 0 && t < T.accept;
  }

  function tokenise(text) {
    return text.split(/(\\/skill:[a-z-]*)/g);
  }

  function promptHtml(text, t) {
    const parts = tokenise(text).map((part) => {
      if (!part) return "";
      return part.startsWith("/skill:")
        ? '<span class="tok">' + part + "</span>"
        : '<span class="arg">' + part + "</span>";
    }).join("");
    const cursorOn = Math.floor(t / 500) % 2 === 0;
    return '<span class="prompt">› </span>' + parts +
      (cursorOn && t < T.enter ? '<span class="cursor"> </span>' : "");
  }

  function blockHtml(name, args, shown, argsShown) {
    if (!shown) return "";
    const tag = '<span class="tag">' + name + "</span>";
    const body = '<span class="arg">&lt;body of the ' + name + " skill&gt;</span>";
    const argsPart = argsShown
      ? '\\n  <span class="args">' + args + "</span>"
      : "";
    return '<div class="block">&lt;skill name="' + tag + '"&gt;\\n  ' + body +
      "\\n&lt;/skill&gt;" + argsPart + "</div>";
  }

  function renderAt(t) {
    document.getElementById("promptLine").innerHTML = promptHtml(typedPrefix(t), t);

    const menu = document.getElementById("menu");
    const visible = menuVisible(t);
    menu.style.display = visible ? "block" : "none";
    if (visible) {
      const top = document.getElementById("promptLine").getBoundingClientRect().bottom;
      menu.style.top = (top - 6) + "px";
      const active = t > 4100 ? 1 : 0;
      for (const item of menu.children) {
        item.classList.toggle("active", Number(item.dataset.row) === active);
      }
    }

    const handoff = document.getElementById("handoff");
    if (t < T.panel) { handoff.innerHTML = ""; }
    else {
      const first = blockHtml("research", "refactor auth", t >= T.block1, t >= T.args1);
      const second = blockHtml("design", "write tests", t >= T.block2, t >= T.args2);
      const caption = t >= T.caption
        ? '<div class="caption">one message → two blocks · each token owns the text that follows it</div>'
        : "";
      const final = t >= T.final
        ? '<div class="caption" style="margin-top:18px">a single <span class="tok">/skill:name</span> message is untouched: it keeps pi&rsquo;s own collapsible card</div>'
        : "";
      handoff.innerHTML =
        '<div class="label">the model receives</div>' +
        '<div class="panel open" style="margin-top:8px">' + first + second + "</div>" +
        caption + final;
    }

    document.getElementById("footLeft").innerHTML = t >= T.enter && t < T.clearEnter
      ? "⏎ sent"
      : (t >= T.final ? '<span class="mount">pi install npm:@aleixrocal/pi-multi-skills</span>' : "");
  }

  window.renderAt = renderAt;
  renderAt(0);
</script>
</body>
</html>
`;

const CHROMIUM_CANDIDATES = [
	process.env.CHROME_BIN,
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/google-chrome",
	"/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
	"/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
].filter(Boolean);

const findChromium = () => CHROMIUM_CANDIDATES.find((path) => existsSync(path)) ?? null;

/** Minimal DevTools-protocol client: one page, one method at a time. */
class Devtools {
	constructor(socket, url) {
		this.socket = socket;
		this.url = url;
		this.next = 1;
		this.pending = new Map();
		socket.addEventListener("message", (event) => {
			let message;
			try {
				message = JSON.parse(event.data);
			} catch {
				// A frame the protocol does not describe (a per-target event we do
				// not subscribe to); nothing in the driver depends on it.
				return;
			}
			const resolver = this.pending.get(message.id);
			if (!resolver) return;
			this.pending.delete(message.id);
			resolver(message.result ?? message.error);
		});
	}

	static async attach(port, pageUrl) {
		const socketUrl = await waitForTarget(port, pageUrl);
		const socket = new WebSocket(socketUrl);
		await new Promise((open, fail) => {
			socket.addEventListener("open", open);
			socket.addEventListener("error", fail);
		});
		return new Devtools(socket, pageUrl);
	}

	send(method, params = {}) {
		const id = this.next++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve) => this.pending.set(id, resolve));
	}

	close() {
		this.socket.close();
	}
}

/** Chromium needs a moment before its HTTP endpoints answer. */
async function waitForTarget(port, pageUrl) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = await response.json();
			const page = targets.find((t) => t.type === "page" && t.url.startsWith("file://")) ??
				targets.find((t) => t.type === "page");
			if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
		} catch {
			// not listening yet
		}
		await sleep(200);
	}
	throw new Error(`chromium never offered a page target for ${pageUrl}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read width and height out of a PNG's IHDR chunk. libx264 refuses odd
 * dimensions, and a viewport that does not match the page silently crops the
 * bottom of every frame, so this is checked per frame rather than trusted.
 */
function assertFrameSize(png, index) {
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	if (width !== WIDTH || height !== HEIGHT) {
		throw new Error(
			`frame ${index} is ${width}x${height}, expected ${WIDTH}x${HEIGHT} — ` +
				"the viewport override did not apply",
		);
	}
}

function findFfmpeg() {
	if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
	for (const candidate of ["/tmp/fftool/ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
		if (existsSync(candidate)) return candidate;
	}
	try {
		return execFileSync("command", ["-v", "ffmpeg"], { shell: true, encoding: "utf8" }).trim();
	} catch {
		return null;
	}
}

async function captureFrames(chromium, pagePath) {
	const frameCount = Math.round(FPS * SECONDS);
	rmSync(FRAME_DIR, { recursive: true, force: true });
	mkdirSync(FRAME_DIR, { recursive: true });

	const child = spawn(
		chromium,
		[
			"--headless=new",
			"--disable-gpu",
			"--no-sandbox",
			"--hide-scrollbars",
			`--window-size=${WIDTH},${HEIGHT}`,
			`--remote-debugging-port=${DEBUG_PORT}`,
			`--user-data-dir=${FRAME_DIR}/profile`,
			`file://${pagePath}`,
		],
		{ stdio: "ignore" },
	);

	let client;
	try {
		client = await Devtools.attach(DEBUG_PORT, pagePath);
		await client.send("Runtime.enable");
		// Assert the page is the animation before capturing 240 frames of nothing.
		const probe = await client.send("Runtime.evaluate", {
			expression: "typeof window.renderAt",
			returnByValue: true,
		});
		if (probe?.result?.value !== "function") {
			throw new Error(
				`the page at ${pagePath} did not load its animation ` +
					`(typeof window.renderAt === ${JSON.stringify(probe?.result?.value)})`,
			);
		}
		// The headless window is shorter than --window-size once the browser's own
		// chrome is taken into account (1280x577 for a 720-tall window), which
		// libx264 rejects: "height not divisible by 2". Pin the viewport instead
		// of trusting the window.
		await client.send("Emulation.setDeviceMetricsOverride", {
			width: WIDTH,
			height: HEIGHT,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await client.send("Page.bringToFront");
		await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
		for (let index = 0; index < frameCount; index += 1) {
			const ms = Math.round((index / FPS) * 1000);
			// `setState` then wait for two animation frames: a headless page that is
			// not focused is throttled, so a screenshot taken straight after the
			// state change would capture the previous paint — which produced 240
			// identical frames before this was added.
			const painted = await client.send("Runtime.evaluate", {
				expression: `renderAt(${ms}); new Promise((done) =>
					requestAnimationFrame(() => requestAnimationFrame(() => done("painted"))))`,
				awaitPromise: true,
				returnByValue: true,
			});
			if (painted?.result?.value !== "painted") {
				throw new Error(
					`frame ${index}: renderAt did not paint — ` +
						JSON.stringify(painted?.exceptionDetails?.text ?? painted),
				);
			}
			const shot = await client.send("Page.captureScreenshot", {
				format: "png",
				optimizeForSpeed: true,
			});
			const png = Buffer.from(shot.data, "base64");
			assertFrameSize(png, index);
			const file = join(FRAME_DIR, `frame-${String(index).padStart(4, "0")}.png`);
			writeFileSync(file, png);
		}
	} finally {
		client?.close();
		child.kill("SIGKILL");
	}
	return frameCount;
}

function encode(ffmpeg, frames) {
	const mp4 = join(OUT_DIR, "demo.mp4");
	execFileSync(
		ffmpeg,
		[
			"-y",
			"-loglevel", "error",
			"-framerate", String(FPS),
			"-i", join(FRAME_DIR, "frame-%04d.png"),
			"-c:v", "libx264",
			"-pix_fmt", "yuv420p",
			"-crf", "20",
			"-preset", "slow",
			"-movflags", "+faststart",
			mp4,
		],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	console.log(`wrote docs/images/demo.mp4 (${frames} frames, ${FPS}fps, ${WIDTH}x${HEIGHT})`);

	// A GIF as well, and not for nostalgia: GitHub renders an animated GIF inline in
	// a README, while a raw-hosted MP4 is downloaded rather than played, and
	// `raw.githubusercontent.com` serves it as application/octet-stream. Scaled and
	// palettised so it stays in the hundreds of kB instead of tens of MB.
	execFileSync(
		ffmpeg,
		[
			"-y",
			"-loglevel", "error",
			"-framerate", String(FPS),
			"-i", join(FRAME_DIR, "frame-%04d.png"),
			"-vf",
			`fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,` +
				"split[a][b];[a]palettegen=max_colors=96[p];" +
				"[b][p]paletteuse=dither=bayer:bayer_scale=5",
			"-loop", "0",
			join(OUT_DIR, "demo.gif"),
		],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	console.log(`wrote docs/images/demo.gif (${GIF_WIDTH}px, ${GIF_FPS}fps)`);
}

async function main() {
	const framesOnly = process.argv.includes("--frames-only");
	const chromium = findChromium();
	if (!chromium) {
		console.log("no Chromium found (set CHROME_BIN) — nothing to do");
		return;
	}

	const pagePath = PAGE_PATH;
	writeFileSync(pagePath, PAGE);

	const frames = await captureFrames(chromium, pagePath);
	console.log(`rendered ${frames} frames into ${FRAME_DIR}`);

	if (framesOnly) {
		console.log("--frames-only: skipping the encode (ffmpeg is optional)");
		return;
	}

	const ffmpeg = findFfmpeg();
	if (!ffmpeg) {
		console.log("no ffmpeg found (set FFMPEG_BIN) — frames left in " + FRAME_DIR);
		return;
	}
	mkdirSync(OUT_DIR, { recursive: true });
	encode(ffmpeg, frames);
}

await main();
