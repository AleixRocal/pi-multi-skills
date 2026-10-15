#!/usr/bin/env node
/**
 * Diagram generator — `docs/images/*.svg` (light + dark) and the PNG renders.
 *
 * Why a generator and not hand-drawn SVG: every diagram here carries text that
 * has to change when the code changes (module names, host `file:line` cites,
 * guard counts). Generating them keeps the pictures honest, and lets the script
 * refuse to emit a diagram whose text would overflow its box.
 *
 * Usage:
 *   node scripts/diagrams.mjs            # SVG + PNG (PNG needs a Chromium)
 *   node scripts/diagrams.mjs --svg-only # SVG only
 *
 * Chromium is found through `CHROME_BIN` or the usual Playwright cache paths;
 * with none available the SVG step still runs and the PNG step is reported as
 * skipped, so the script is safe in any environment.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "images");

const SANS =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Rough advance width per character, as a fraction of font size. */
const ADVANCE = { sans: 0.55, mono: 0.6 };

const PALETTES = {
	light: {
		bg: "#ffffff",
		ink: "#1f2328",
		muted: "#59636e",
		panel: "#f6f8fa",
		panelAlt: "#ffffff",
		border: "#d0d7de",
		blue: "#0969da",
		green: "#1a7f37",
		amber: "#9a6700",
		purple: "#8250df",
		red: "#cf222e",
		code: "#0a3069",
	},
	dark: {
		bg: "#0d1117",
		ink: "#e6edf3",
		muted: "#9198a1",
		panel: "#161b22",
		panelAlt: "#0d1117",
		border: "#30363d",
		blue: "#4493f8",
		green: "#3fb950",
		amber: "#d29922",
		purple: "#a371f7",
		red: "#f85149",
		code: "#79c0ff",
	},
};

const escapeXml = (s) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

class Board {
	constructor({ width, height, palette, label }) {
		this.width = width;
		this.height = height;
		this.p = PALETTES[palette];
		this.parts = [];
		this.label = label;
	}

	/**
	 * One run of text. `max` is the width the run is allowed to occupy: the
	 * generator throws instead of shipping a diagram whose text runs out of
	 * its box, which is the failure mode a screenshot review misses.
	 */
	rich(x, y, text, { size = 14, fill, mono = false, weight = "normal", anchor = "start", max } = {}) {
		const colour = fill ?? this.p.ink;
		const segments = text.split("`");
		let width = 0;
		const tspans = segments.map((segment, index) => {
			if (segment === "") return "";
			const isCode = index % 2 === 1;
			const family = isCode || mono ? MONO : SANS;
			const scale = isCode || mono ? ADVANCE.mono : ADVANCE.sans;
			const boldScale = weight === "bold" ? 1.04 : 1;
			width += segment.length * size * scale * boldScale;
			return (
				`<tspan font-family="${family}"` +
				(isCode ? ` font-size="${size - 1}"` : "") +
				(isCode ? ` fill="${this.p.code}"` : "") +
				`>${escapeXml(segment)}</tspan>`
			);
		});
		if (max !== undefined && width > max) {
			throw new Error(
				`text overflow in "${this.label}": ${Math.round(width)}px > ${max}px — ${text}`,
			);
		}
		this.parts.push(
			`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" ` +
				`fill="${colour}" text-anchor="${anchor}" ` +
				`font-family="${mono ? MONO : SANS}">${tspans.join("")}</text>`,
		);
		return width;
	}

	rect(x, y, w, h, { fill, stroke, radius = 10, dash, width = 1 } = {}) {
		this.parts.push(
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ` +
				`fill="${fill ?? "none"}"` +
				(stroke ? ` stroke="${stroke}" stroke-width="${width}"` : "") +
				(dash ? ` stroke-dasharray="${dash}"` : "") +
				` />`,
		);
	}

	line(x1, y1, x2, y2, { stroke, dash, width = 1.5 } = {}) {
		this.parts.push(
			`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
				`stroke="${stroke ?? this.p.border}" stroke-width="${width}"` +
				(dash ? ` stroke-dasharray="${dash}"` : "") +
				` />`,
		);
	}

	/** Orthogonal connector with an arrow head at the end. */
	arrow(points, { colour, dash } = {}) {
		const stroke = colour ?? this.p.muted;
		const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
		this.parts.push(
			`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6"` +
				(dash ? ` stroke-dasharray="${dash}"` : "") +
				` marker-end="url(#head-${stroke.replace("#", "")})" />`,
		);
	}

	/** A card: panel, accent bar, bold title, bullet lines. */
	card(x, y, w, h, { title, accent, lines, titleSize = 15 }) {
		this.rect(x, y, w, h, { fill: this.p.panel, stroke: this.p.border });
		this.rect(x, y, 5, h, { fill: accent, radius: 2.5 });
		this.rich(x + 22, y + 32, title, { size: titleSize, weight: "bold", max: w - 44 });
		lines.forEach((line, index) => {
			this.rich(x + 22, y + 66 + index * 27, line, { size: 13.5, max: w - 44 });
		});
	}

	toString() {
		const markers = {};
		for (const colour of [
			this.p.muted,
			this.p.blue,
			this.p.green,
			this.p.amber,
			this.p.purple,
			this.p.ink,
		]) {
			markers[colour] = `<marker id="head-${colour.replace("#", "")}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${colour}" /></marker>`;
		}
		return [
			`<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" ` +
				`viewBox="0 0 ${this.width} ${this.height}" role="img" aria-label="${escapeXml(this.label)}">`,
			`<defs>${Object.values(markers).join("")}</defs>`,
			`<rect width="${this.width}" height="${this.height}" fill="${this.p.bg}" />`,
			...this.parts,
			"</svg>",
			"",
		].join("\n");
	}
}

/** Page header shared by every diagram. */
function header(board, title, subtitle) {
	board.rich(48, 58, title, { size: 26, weight: "bold", max: board.width - 96 });
	if (subtitle) {
		board.rich(48, 86, subtitle, { size: 14.5, fill: board.p.muted, max: board.width - 96 });
	}
}

/**
 * Axis-aligned flow box with a centred title and an optional second line.
 * Returns its own geometry so arrows can hang off it.
 */
function node(board, { x, y, w, h, title, sub, accent, fill }) {
	board.rect(x, y, w, h, {
		fill: fill ?? board.p.panelAlt,
		stroke: accent ?? board.p.border,
		radius: 9,
		width: accent ? 1.8 : 1,
	});
	const cx = x + w / 2;
	board.rich(cx, sub ? y + h / 2 - 4 : y + h / 2 + 5, title, {
		size: 14,
		weight: "bold",
		anchor: "middle",
		max: w - 16,
	});
	if (sub) {
		board.rich(cx, y + h / 2 + 18, sub, {
			size: 12,
			fill: board.p.muted,
			anchor: "middle",
			max: w - 16,
		});
	}
	return { cx, top: y, bottom: y + h, left: x, right: x + w };
}

/** Arrow between two boxes stacked vertically, labelled to the side. */
function down(board, from, to, { colour, label, labelSide = "right" } = {}) {
	const x = from.cx;
	board.arrow(
		[
			[x, from.bottom + 4],
			[x, to.top - 4],
		],
		{ colour },
	);
	if (label) {
		board.rich(labelSide === "right" ? x + 10 : x - 10, (from.bottom + to.top) / 2 + 4, label, {
			size: 12,
			fill: board.p.muted,
			anchor: labelSide === "right" ? "start" : "end",
			max: labelSide === "right" ? board.width - x - 24 : x - 60,
		});
	}
}

// ---------------------------------------------------------------------------
// 1. Architecture — the host pipeline and the four surfaces this package adds.
// ---------------------------------------------------------------------------

function architecture(palette) {
	const board = new Board({
		width: 1400,
		height: 900,
		palette,
		label: "Where pi-multi-skills hooks into pi",
	});
	header(
		board,
		"Where pi-multi-skills hooks into pi",
		"One user message, four host hooks, one transcript. Host call sites are cited in the code comments.",
	);

	// Band 1 — the message path inside the host.
	board.rect(40, 112, 1320, 172, { fill: board.p.panel, stroke: board.p.border, dash: "6 6" });
	board.rich(64, 142, "The message path inside the host", { size: 14, weight: "bold" });

	const stages = [
		{ title: "input event", sub: "user text" },
		{ title: "input handlers", sub: "← this package", accent: board.p.blue },
		{ title: "native /skill: expansion", sub: "sees no /skill: prefix" },
		{ title: "session message", sub: "N blocks, verbatim" },
		{ title: "model", sub: "gets every skill" },
	];
	const boxW = 238;
	const gap = 20;
	let cx = 64;
	stages.forEach((stage, index) => {
		node(board, { x: cx, y: 162, w: boxW, h: 62, ...stage });
		if (index < stages.length - 1) {
			const x1 = cx + boxW;
			board.arrow(
				[
					[x1 + 2, 193],
					[x1 + gap - 2, 193],
				],
				{ colour: board.p.muted },
			);
		}
		cx += boxW + gap;
	});
	board.rich(
		64,
		248,
		"Our handler returns text that no longer starts with `/skill:`, so the expansion step has nothing",
		{ size: 12.5, fill: board.p.muted, max: 1272 },
	);
	board.rich(
		64,
		270,
		"to expand — every emitted block reaches the session message untouched (`agent-session.js:1698`).",
		{ size: 12.5, fill: board.p.muted, max: 1272 },
	);

	// Band 2 — the surfaces.
	board.rich(48, 312, "Extension surfaces", { size: 18, weight: "bold" });
	const cardW = 640;
	const cardH = 232;
	const cards = [
		{
			title: "input hook — src/input-handler.ts",
			accent: board.p.blue,
			lines: [
				"• Guard 1: `source === \"extension\"` breaks the loop over our own output.",
				"• Guard 2: nothing resolves → `continue`, pi's own expansion runs.",
				"• Clean path — the whole message through `expandSkillTokens`.",
				"• Rescue path — `@juicesharp/rpiv-args` ran first, so only the text after",
				"  the last `</skill>` is scanned.",
				"• Returns `{ action: \"transform\" }` or `{ action: \"continue\" }`.",
			],
		},
		{
			title: "chain pipeline — parser → registry → expander",
			accent: board.p.purple,
			lines: [
				"• parser: a `/skill:` token anywhere, positional binding, cap 6.",
				"• registry: name → `SKILL.md` from `pi.getCommands()`, cached per session.",
				"• expander: byte-exact `<skill …>` block, `body = stripFrontmatter().trim()`.",
				"• An unknown name leaves that span verbatim; the rest still expands.",
			],
		},
		{
			title: "autocomplete wrapper — src/autocomplete.ts",
			accent: board.p.green,
			lines: [
				"• On `session_start`, wraps `ctx.ui.addAutocompleteProvider`.",
				"• Adds the `/skill:` menu past the first token; a bare `/pl` works too.",
				"• Every other position is delegated to pi's provider unchanged.",
				"• The six-skill cap applies to the menu as well.",
			],
		},
		{
			title: "display + discovery",
			accent: board.p.amber,
			lines: [
				"• renderer: markdown transformer → the chain renders as it was typed.",
				"• chain-display: the U+200B marker that keeps a chain off the skill card.",
				"• skills tool: read-only `{ name, description, location }` listing.",
				"• A single `/skill:name` message stays pi's own collapsible card.",
			],
		},
	];
	cards.forEach((card, index) => {
		const x = 40 + (index % 2) * (cardW + 40);
		const y = 336 + Math.floor(index / 2) * (cardH + 32);
		board.card(x, y, cardW, cardH, card);
	});

	board.rich(
		48,
		856,
		"172 specs in 11 files · `npm run verify` = typecheck + tests + tarball check · regenerate with `npm run diagrams`",
		{ size: 13, fill: board.p.muted, max: 1304 },
	);
	return board;
}

// ---------------------------------------------------------------------------
// 2. Message flow — what the model receives, natively and with the extension.
// ---------------------------------------------------------------------------

function messageFlow(palette) {
	const board = new Board({
		width: 1400,
		height: 700,
		palette,
		label: "One typed message, native pi versus pi-multi-skills",
	});
	header(
		board,
		"One typed message, before and after",
		"Positional binding: each `/skill:` token owns the text that follows it.",
	);

	const typed = "/skill:research refactor auth /skill:design write tests";
	const columns = [
		{
			x: 40,
			accent: board.p.red,
			title: "Native pi — one skill per message",
			blockLines: [
				'<skill name="research" location="…/research/SKILL.md">',
				"  <body of the research skill>",
				"</skill>",
			],
			argsLines: ["refactor auth /skill:design write tests"],
			afterLines: [],
			outcome: "one skill resolved",
			note: [
				"Everything after the FIRST space is swallowed as that skill's argument",
				"text, so `design` is never resolved — no error, no signal.",
				"(`agent-session.js:1697-1721`)",
			],
		},
		{
			x: 720,
			accent: board.p.green,
			title: "With pi-multi-skills — N skills per message",
			blockLines: [
				'<skill name="research" location="…/research/SKILL.md">',
				"  <body of the research skill>",
				"</skill>",
			],
			argsLines: ["refactor auth"],
			afterLines: [
				"Then the same block for `design`, with the argument",
				"`write tests` — every token resolved, in order.",
			],
			outcome: "two skills resolved",
			note: [
				"Each token binds the text up to the next token — `research` gets",
				"`refactor auth`, `design` gets `write tests`.",
			],
		},
	];

	for (const column of columns) {
		const w = 640;
		board.rect(column.x, 118, w, 460, {
			fill: board.p.panel,
			stroke: board.p.border,
		});
		board.rect(column.x, 118, 5, 460, { fill: column.accent, radius: 2.5 });
		board.rich(column.x + 24, 152, column.title, {
			size: 15,
			weight: "bold",
			max: w - 48,
		});

		// What you typed.
		board.rich(column.x + 24, 186, "you type", {
			size: 12,
			fill: board.p.muted,
			max: w - 48,
		});
		board.rect(column.x + 24, 196, w - 48, 40, {
			fill: board.p.panelAlt,
			stroke: board.p.border,
			radius: 8,
		});
		board.rich(column.x + 36, 222, typed, { size: 13, mono: true, max: w - 72 });

		// What the model receives.
		board.rich(column.x + 24, 268, "the model receives", {
			size: 12,
			fill: board.p.muted,
			max: w - 48,
		});
		board.rect(column.x + 24, 278, w - 48, 132, {
			fill: board.p.panelAlt,
			stroke: board.p.border,
			radius: 8,
		});
		column.blockLines.forEach((line, index) => {
			board.rich(column.x + 36, 304 + index * 21, line, {
				size: 12.5,
				mono: true,
				max: w - 72,
			});
		});
		board.rich(column.x + 36, 380, "then the argument text:", {
			size: 12,
			fill: board.p.muted,
			max: w - 72,
		});
		column.argsLines.forEach((line, index) => {
			board.rich(column.x + 36, 400 + index * 19, line, {
				size: 12.5,
				mono: true,
				max: w - 72,
			});
		});

		// The right column needs one more sentence than the box can hold: what
		// happens to the second token. Rendered above the verdict, never over it.
		column.afterLines.forEach((line, index) => {
			board.rich(column.x + 24, 434 + index * 19, line, {
				size: 12.5,
				fill: board.p.muted,
				max: w - 48,
			});
		});

		board.rich(column.x + 24, 486, column.outcome, {
			size: 13.5,
			weight: "bold",
			fill: column.accent,
			max: w - 48,
		});
		column.note.forEach((line, index) => {
			board.rich(column.x + 24, 514 + index * 20, line, {
				size: 12.5,
				fill: board.p.muted,
				max: w - 48,
			});
		});
	}

	board.rect(40, 600, 1320, 68, { fill: board.p.panel, stroke: board.p.border, dash: "6 6" });
	board.rich(
		64,
		630,
		"A contiguous run still broadcasts: `/skill:a /skill:b shared args` appends the argument text once, after the last block — exactly as native pi does.",
		{ size: 13, max: 1272 },
	);
	board.rich(
		64,
		654,
		"A single `/skill:a args` message is byte-identical to native pi, which is what keeps `@juicesharp/rpiv-args` interchangeable in either handler order.",
		{ size: 13, fill: board.p.muted, max: 1272 },
	);
	return board;
}

// ---------------------------------------------------------------------------
// 3. Handler flow — the guards and the two transform paths.
// ---------------------------------------------------------------------------

function handlerFlow(palette) {
	const board = new Board({
		width: 1200,
		height: 960,
		palette,
		label: "The input handler: guards, clean path, rescue path",
	});
	header(
		board,
		"The input hook, decision by decision",
		"Every path that cannot serve the message returns `continue`, leaving pi's own behaviour exactly as it was.",
	);

	const start = node(board, {
		x: 390,
		y: 118,
		w: 420,
		h: 58,
		title: "input event",
		sub: "`text` + `source`",
	});

	const guard1 = node(board, {
		x: 340,
		y: 208,
		w: 520,
		h: 58,
		title: 'source === "extension"?',
		accent: board.p.amber,
	});
	const loopBreak = node(board, {
		x: 900,
		y: 208,
		w: 260,
		h: 58,
		title: "continue",
		sub: "loop break",
		accent: board.p.red,
		fill: board.p.panel,
	});
	down(board, start, guard1);
	board.arrow(
		[
			[guard1.right + 4, 237],
			[loopBreak.left - 4, 237],
		],
		{ colour: board.p.red },
	);
	board.rich(guard1.right + 14, 228, "yes", { size: 12, fill: board.p.red, max: 60 });

	const guard2 = node(board, {
		x: 320,
		y: 306,
		w: 560,
		h: 58,
		title: 'text already carries "<skill "?',
		accent: board.p.amber,
	});
	down(board, guard1, guard2, { label: "no", labelSide: "left" });

	// Two branches.
	const clean = node(board, {
		x: 90,
		y: 424,
		w: 420,
		h: 58,
		title: "clean path",
		sub: "expandSkillTokens(whole text)",
		accent: board.p.blue,
		fill: board.p.panel,
	});
	const rescue = node(board, {
		x: 690,
		y: 424,
		w: 420,
		h: 58,
		title: "rescue path",
		sub: "expand text after the last </skill>",
		accent: board.p.blue,
		fill: board.p.panel,
	});
	board.arrow(
		[
			[guard2.cx - 60, guard2.bottom + 4],
			[guard2.cx - 60, 396],
			[clean.cx, 396],
			[clean.cx, clean.top - 4],
		],
		{ colour: board.p.blue },
	);
	board.rich(guard2.cx - 56, 390, "no", { size: 12, fill: board.p.blue, max: 40 });
	board.arrow(
		[
			[guard2.cx + 60, guard2.bottom + 4],
			[guard2.cx + 60, 396],
			[rescue.cx, 396],
			[rescue.cx, rescue.top - 4],
		],
		{ colour: board.p.blue },
	);
	board.rich(guard2.cx + 78, 390, "yes — rpiv-args ran first", {
		size: 12,
		fill: board.p.blue,
		max: 200,
	});

	// merge into the resolved check
	const resolved = node(board, {
		x: 350,
		y: 548,
		w: 500,
		h: 58,
		title: "did anything resolve?",
		accent: board.p.amber,
	});
	board.arrow(
		[
			[clean.cx, clean.bottom + 4],
			[clean.cx, 520],
			[resolved.cx, 520],
			[resolved.cx, resolved.top - 4],
		],
		{ colour: board.p.muted },
	);
	board.arrow(
		[
			[rescue.cx, rescue.bottom + 4],
			[rescue.cx, 520],
			[resolved.cx, 520],
			[resolved.cx, resolved.top - 4],
		],
		{ colour: board.p.muted },
	);
	board.rich(clean.cx + 8, 514, "per token", { size: 12, fill: board.p.muted, max: 80 });

	const native = node(board, {
		x: 60,
		y: 548,
		w: 250,
		h: 58,
		title: "continue",
		sub: "pi expands natively",
		accent: board.p.red,
		fill: board.p.panel,
	});
	board.arrow(
		[
			[resolved.left - 4, 577],
			[native.right + 4, 577],
		],
		{ colour: board.p.red },
	);
	board.rich(resolved.left - 26, 568, "nothing", {
		size: 12,
		fill: board.p.red,
		anchor: "end",
		max: 60,
	});

	const marker = node(board, {
		x: 350,
		y: 668,
		w: 500,
		h: 58,
		title: "markChainForDisplay(text)",
		sub: "one leading U+200B",
		accent: board.p.purple,
	});
	down(board, resolved, marker, { label: "something", labelSide: "right" });

	const output = node(board, {
		x: 330,
		y: 788,
		w: 540,
		h: 62,
		title: "transform → session message",
		sub: "N blocks for the model, chain syntax in the transcript",
		accent: board.p.green,
	});
	down(board, marker, output);

	board.rect(40, 886, 1120, 74, { fill: board.p.panel, stroke: board.p.border, dash: "6 6" });
	board.rich(
		64,
		914,
		"Per token: an unknown name or an unreadable `SKILL.md` stays verbatim; past six markers,",
		{ size: 13, max: 1072 },
	);
	board.rich(64, 940, "later ones stay literal text and are bound as arguments, so nothing typed is ever deleted.", {
		size: 13,
		fill: board.p.muted,
		max: 1072,
	});
	return board;
}

// ---------------------------------------------------------------------------
// 4. Autocomplete — the position pi's own provider cannot see.
// ---------------------------------------------------------------------------

function autocomplete(palette) {
	const board = new Board({
		width: 1340,
		height: 840,
		palette,
		label: "The /skill: menu past the first token",
	});
	header(
		board,
		"The menu at every chain position",
		"pi's provider is line-start only, so a second token showed no menu at all. The wrapper supplies that case and delegates everything else.",
	);

	const panels = [
		{
			x: 40,
			accent: board.p.red,
			title: "pi's own provider",
			verdict: "no menu",
			sub: "the command branch needs a `/`-prefixed text with no space",
			cite: "(@earendil-works/pi-tui/dist/autocomplete.js:232-235)",
			menu: [],
		},
		{
			x: 700,
			accent: board.p.green,
			title: "with the wrapper",
			verdict: "menu, listing every skill",
			sub: "a chain token is detected at the cursor",
			cite: "(src/autocomplete.ts → chainTokenAt)",
			menu: ["/skill:design", "/skill:plan", "/skill:skills"],
		},
	];

	const typed = "/skill:research refactor auth /ski";
	for (const panel of panels) {
		const w = 600;
		board.rect(panel.x, 118, w, 300, { fill: board.p.panel, stroke: board.p.border });
		board.rect(panel.x, 118, 5, 300, { fill: panel.accent, radius: 2.5 });
		board.rich(panel.x + 24, 152, panel.title, {
			size: 15,
			weight: "bold",
			max: w - 48,
		});

		board.rich(panel.x + 24, 186, "you type", {
			size: 12,
			fill: board.p.muted,
			max: w - 48,
		});
		board.rect(panel.x + 24, 196, w - 48, 40, {
			fill: board.p.panelAlt,
			stroke: board.p.border,
			radius: 8,
		});
		board.rich(panel.x + 36, 222, typed, { size: 13, mono: true, max: w - 72 });

		if (panel.menu.length > 0) {
			const menuW = 230;
			const menuX = panel.x + w - menuW - 28;
			const menuY = 246;
			board.rect(menuX, menuY, menuW, 22 + panel.menu.length * 24, {
				fill: board.p.panelAlt,
				stroke: panel.accent,
				radius: 8,
			});
			panel.menu.forEach((entry, index) => {
				board.rich(menuX + 14, menuY + 30 + index * 24, entry, {
					size: 12.5,
					mono: true,
					max: menuW - 24,
				});
			});
		}

		board.rich(panel.x + 24, 336, panel.verdict, {
			size: 13.5,
			weight: "bold",
			fill: panel.accent,
			max: w - 48,
		});
		board.rich(panel.x + 24, 362, panel.sub, {
			size: 12.5,
			fill: board.p.muted,
			max: w - 48,
		});
		board.rich(panel.x + 24, 388, panel.cite, {
			size: 12,
			fill: board.p.muted,
			max: w - 48,
		});
	}

	board.rich(48, 470, "Where the wrapper answers, and where it stands aside", {
		size: 18,
		weight: "bold",
	});

	const rows = [
		{
			accent: board.p.green,
			verdict: "answers",
			text: "a token is already committed before the fragment",
		},
		{
			accent: board.p.green,
			verdict: "answers",
			text: "the fragment is name-shaped: `/skill:pl`, `/skill:`, `/skill`, `/s`, `/pl`",
		},
		{
			accent: board.p.muted,
			verdict: "delegates",
			text: "`check /srv`, `src/app.ts`, `@file.ts`, the first token, any non-chain command",
		},
		{
			accent: board.p.red,
			verdict: "caps",
			text: "a seventh marker offers no names — it would not expand",
		},
	];
	rows.forEach((row, index) => {
		const y = 490 + index * 62;
		board.rect(40, y, 1260, 50, { fill: board.p.panel, stroke: board.p.border });
		board.rect(40, y, 5, 50, { fill: row.accent, radius: 2.5 });
		board.rich(64, y + 31, row.verdict, {
			size: 13,
			weight: "bold",
			fill: row.accent,
			max: 110,
		});
		board.rich(190, y + 31, row.text, { size: 13.5, max: 1090 });
	});

	board.rect(40, 748, 1260, 56, { fill: board.p.panel, stroke: board.p.border, dash: "6 6" });
	board.rich(
		64,
		782,
		"`/` alone starts nothing mid-message: the editor auto-triggers on `/` only at line start, so the request lands on the next character — and is served for that reason.",
		{ size: 13, max: 1212 },
	);
	return board;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const DIAGRAMS = [
	{ name: "architecture", build: architecture },
	{ name: "message-flow", build: messageFlow },
	{ name: "handler-flow", build: handlerFlow },
	{ name: "autocomplete", build: autocomplete },
];

const CHROMIUM_CANDIDATES = [
	process.env.CHROME_BIN,
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/google-chrome",
	"/home/user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
	"/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
].filter(Boolean);

function findChromium() {
	return CHROMIUM_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

function renderPng(chromium, svgPath, pngPath, { width, height }) {
	execFileSync(
		chromium,
		[
			"--headless=new",
			"--disable-gpu",
			"--no-sandbox",
			"--hide-scrollbars",
			"--force-device-scale-factor=2",
			`--window-size=${width},${height}`,
			`--screenshot=${pngPath}`,
			`file://${svgPath}`,
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
}

function main() {
	const svgOnly = process.argv.includes("--svg-only");
	const chromium = svgOnly ? null : findChromium();
	mkdirSync(OUT_DIR, { recursive: true });

	for (const { name, build } of DIAGRAMS) {
		const geometry = {};
		for (const palette of ["light", "dark"]) {
			const board = build(palette);
			geometry.width = board.width;
			geometry.height = board.height;
			const svgPath = join(OUT_DIR, `${name}.${palette}.svg`);
			writeFileSync(svgPath, board.toString());
			console.log(`wrote ${svgPath.replace(`${ROOT}/`, "")} ${board.width}x${board.height}`);
		}
		if (chromium) {
			const pngPath = join(OUT_DIR, `${name}.png`);
			renderPng(chromium, join(OUT_DIR, `${name}.light.svg`), pngPath, geometry);
			console.log(`wrote docs/images/${name}.png`);
		}
	}

	if (!chromium && !svgOnly) {
		console.log("no Chromium found (set CHROME_BIN) — skipped the PNG step");
	}
}

main();
