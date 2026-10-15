import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import { CHAIN_DISPLAY_MARKER } from "../src/chain-display.js";
import { appendArgs, buildSkillBlock } from "../src/expander.js";
import { handleInput } from "../src/input-handler.js";
import { invalidateSkillIndex } from "../src/registry.js";
import type { SkillEntry } from "../src/types.js";
import {
	createMockCtx,
	createMockPi,
	emitInput,
	skillCommand,
	type InputHandler,
} from "./helpers/mock-pi.js";

/**
 * Verbatim copy of Pi's `parseSkillBlock` regex (dist/core/agent-session.js:54).
 * Asserting against it is how these tests check whether a transformed message
 * reaches the host as a single skill invocation or as plain text.
 */
const PARSE_SKILL_BLOCK =
	/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-multi-skills-handler-"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

// `getSkillIndex` caches process-wide, so every test starts from a cold cache.
afterEach(() => {
	invalidateSkillIndex();
});

/** Write a real SKILL.md under the temp root and return its canonical path. */
function writeSkillFile(name: string, body?: string): string {
	const baseDir = join(root, name);
	mkdirSync(baseDir, { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(
		filePath,
		`---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body ?? `${name.toUpperCase()} BODY`}\n`,
		"utf-8",
	);
	return filePath;
}

interface SkillSpec {
	readonly name: string;
	/** SKILL.md body; defaults to `<NAME> BODY`. */
	readonly body?: string;
	/** Point at a path instead of writing one — builds the unreadable-SKILL.md case. */
	readonly filePath?: string;
}

interface Harness {
	readonly pi: ExtensionAPI;
	/** The `SkillEntry` the registry must derive for a fixture skill. */
	entry(name: string): SkillEntry;
}

/** A mock `pi` whose commands are real skills on disk. */
function harness(...specs: readonly SkillSpec[]): Harness {
	const entries = new Map<string, SkillEntry>();
	const commands = specs.map((spec) => {
		const filePath = spec.filePath ?? writeSkillFile(spec.name, spec.body);
		entries.set(spec.name, { name: spec.name, filePath, baseDir: dirname(filePath) });
		return skillCommand(spec.name, filePath);
	});

	return {
		pi: createMockPi({ commands }).pi,
		entry(name) {
			const found = entries.get(name);
			if (found === undefined) throw new Error(`no fixture skill named ${name}`);
			return found;
		},
	};
}

/** Call the handler the way the host does, minus the rest of the chain. */
function emit(
	pi: ExtensionAPI,
	text: string,
	source: InputEvent["source"] = "interactive",
): InputEventResult {
	return handleInput({ type: "input", text, source }, createMockCtx(), pi);
}

/** Narrow a result to its transformed text, failing loudly otherwise. */
function textOf(result: InputEventResult): string {
	if (result.action !== "transform") throw new Error(`expected a transform, got ${result.action}`);
	return result.text;
}

describe("handleInput — guard 1: extension-injected input", () => {
	it("returns continue and rewrites nothing", () => {
		const { pi } = harness({ name: "design" });

		expect(emit(pi, "/skill:design x", "extension")).toEqual({ action: "continue" });
	});

	it("steps aside for a chain too", () => {
		const { pi } = harness({ name: "a" }, { name: "b" });

		expect(emit(pi, "/skill:a /skill:b x", "extension")).toEqual({ action: "continue" });
	});
});

describe("handleInput — a bare slash never triggers", () => {
	it.each(["src/app.ts", "/etc/hosts", "https://example.com/x", "a / b", "/", "hello world", ""])(
		"leaves %j alone",
		(text) => {
			const { pi } = harness({ name: "design" });

			expect(emit(pi, text)).toEqual({ action: "continue" });
		},
	);
});

describe("handleInput — N=1 is byte-identical to native Pi", () => {
	it("reproduces agent-session.js:1709-1710 for `/skill:design refactor auth`", () => {
		const { pi, entry } = harness({ name: "design", body: "Refactor carefully." });

		expect(emit(pi, "/skill:design refactor auth")).toEqual({
			action: "transform",
			text: appendArgs(buildSkillBlock(entry("design"), "Refactor carefully."), "refactor auth"),
		});
	});

	it("emits no argument suffix when the token owns no text", () => {
		const { pi, entry } = harness({ name: "design", body: "Refactor carefully." });

		expect(emit(pi, "/skill:design")).toEqual({
			action: "transform",
			text: buildSkillBlock(entry("design"), "Refactor carefully."),
		});
	});
});

describe("handleInput — chains", () => {
	it("emits N sibling blocks joined by exactly one blank line", () => {
		const { pi, entry } = harness(
			{ name: "research", body: "RESEARCH BODY" },
			{ name: "design", body: "DESIGN BODY" },
		);

		expect(textOf(emit(pi, "/skill:research /skill:design refactor auth"))).toBe(
			`${CHAIN_DISPLAY_MARKER}${buildSkillBlock(entry("research"), "RESEARCH BODY")}\n\n${appendArgs(buildSkillBlock(entry("design"), "DESIGN BODY"), "refactor auth")}`,
		);
	});

	it("binds per-skill arguments when text separates the tokens", () => {
		const { pi, entry } = harness(
			{ name: "research", body: "RESEARCH BODY" },
			{ name: "b", body: "B BODY" },
		);

		expect(textOf(emit(pi, "/skill:research refactor auth /skill:b write tests"))).toBe(
			`${CHAIN_DISPLAY_MARKER}${appendArgs(buildSkillBlock(entry("research"), "RESEARCH BODY"), "refactor auth")}\n\n${appendArgs(buildSkillBlock(entry("b"), "B BODY"), "write tests")}`,
		);
	});

	it("keeps the prose preamble in front of the blocks", () => {
		const { pi, entry } = harness({ name: "design", body: "DESIGN BODY" });

		expect(textOf(emit(pi, "please /skill:design now"))).toBe(
			`please\n\n${appendArgs(buildSkillBlock(entry("design"), "DESIGN BODY"), "now")}`,
		);
	});

	it("caps the chain at 6 blocks and keeps the 7th marker as literal text", () => {
		const { pi } = harness(...["a", "b", "c", "d", "e", "f"].map((name) => ({ name })));

		const text = textOf(emit(pi, "/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f /skill:g tail"));

		expect(text.match(/<skill name=/g)).toHaveLength(6);
		expect(text.endsWith("</skill>\n\n/skill:g tail")).toBe(true);
	});

	it("is not parsed as a card, so the transcript renders the typed chain", () => {
		const { pi } = harness({ name: "a", body: "A BODY" }, { name: "b", body: "B BODY" });

		const text = textOf(emit(pi, "/skill:a x /skill:b y"));

		// One character of marker defeats the `^…$` anchor: the host hands the
		// whole message to a `UserMessageComponent`, which is where this
		// extension's markdown transformer runs (`interactive-mode.js:3193-3207`).
		expect(text.startsWith(CHAIN_DISPLAY_MARKER)).toBe(true);
		expect(text.match(PARSE_SKILL_BLOCK)).toBeNull();
	});

	it("keeps the single-skill case parseable, so pi's card still renders", () => {
		const { pi } = harness({ name: "a", body: "A BODY" });

		const match = textOf(emit(pi, "/skill:a x")).match(PARSE_SKILL_BLOCK);

		expect(match?.[1]).toBe("a");
		expect(match?.[4]).toBe("x");
	});
});

describe("handleInput — guard 3: unresolvable tokens stay verbatim", () => {
	it("leaves an unknown token in place while its siblings expand", () => {
		const { pi, entry } = harness({ name: "design" });

		expect(textOf(emit(pi, "/skill:nope x /skill:design y"))).toBe(
			`/skill:nope x\n\n${appendArgs(buildSkillBlock(entry("design"), "DESIGN BODY"), "y")}`,
		);
	});

	it("leaves a token with an unreadable SKILL.md in place while its siblings expand", () => {
		const { pi, entry } = harness(
			{ name: "broken", filePath: join(root, "missing", "SKILL.md") },
			{ name: "design" },
		);

		expect(textOf(emit(pi, "/skill:broken x /skill:design y"))).toBe(
			`/skill:broken x\n\n${appendArgs(buildSkillBlock(entry("design"), "DESIGN BODY"), "y")}`,
		);
	});

	it("returns continue when no token resolves", () => {
		const { pi } = harness({ name: "design" });

		expect(emit(pi, "/skill:nope x /skill:also-nope y")).toEqual({ action: "continue" });
	});
});

describe("handleInput — rescue path, order independence", () => {
	it("expands the residual token after an already-emitted block", () => {
		const { pi, entry } = harness({ name: "a", body: "A BODY" }, { name: "b", body: "B BODY" });
		const wrapped = buildSkillBlock(entry("a"), "A BODY");

		expect(textOf(emit(pi, `${wrapped}\n\n/skill:b y`))).toBe(
			`${CHAIN_DISPLAY_MARKER}${wrapped}\n\n${appendArgs(buildSkillBlock(entry("b"), "B BODY"), "y")}`,
		);
	});

	it("carries the residual text's prose through as the following token's preamble", () => {
		// Exactly what rpiv-args leaves behind for `/skill:a x /skill:b y`: it
		// binds `x /skill:b y` as skill `a`'s argument text.
		const { pi, entry } = harness({ name: "a", body: "A BODY" }, { name: "b", body: "B BODY" });
		const wrapped = buildSkillBlock(entry("a"), "A BODY");

		expect(textOf(emit(pi, `${wrapped}\n\nx /skill:b y`))).toBe(
			`${CHAIN_DISPLAY_MARKER}${wrapped}\n\nx\n\n${appendArgs(buildSkillBlock(entry("b"), "B BODY"), "y")}`,
		);
	});

	it("changes nothing when the wrapped text carries no residual token", () => {
		const { pi, entry } = harness({ name: "a", body: "A BODY" });

		expect(emit(pi, buildSkillBlock(entry("a"), "A BODY"))).toEqual({ action: "continue" });
	});

	it("never re-expands a `/skill:` marker inside an emitted block's body", () => {
		// Skills that document chaining carry literal markers in their prose —
		// this project's own design skill names `/skill:research` and
		// `/skill:plan`. A body mention must never become an invocation.
		const { pi, entry } = harness(
			{ name: "docs", body: "Chain /skill:design then /skill:plan." },
			{ name: "design" },
			{ name: "plan" },
		);
		const wrapped = buildSkillBlock(entry("docs"), "Chain /skill:design then /skill:plan.");

		expect(emit(pi, wrapped)).toEqual({ action: "continue" });
	});

	it("steps aside for an unterminated block instead of guessing a boundary", () => {
		const { pi } = harness({ name: "b" });

		expect(
			emit(
				pi,
				'<skill name="a" location="/a/SKILL.md">\nReferences are relative to /a.\n\n/skill:b y',
			),
		).toEqual({ action: "continue" });
	});
});

describe("handleInput — attached images survive the transform", () => {
	it("leaves `images` untouched in the transform result", async () => {
		const { pi } = harness({ name: "design" });
		const images = [{ type: "image", data: "QUJD", mimeType: "image/png" }] as unknown as InputEvent["images"];
		const handlers: InputHandler[] = [(event, ctx) => handleInput(event, ctx, pi)];

		const result = await emitInput(handlers, "/skill:design x", { images });

		expect(result.action).toBe("transform");
		if (result.action !== "transform") return;
		expect(result.images).toBe(images);
	});
});

describe("extensions/index.ts — registration surface", () => {
	it("registers exactly one `input` handler", () => {
		const mock = createMockPi({ commands: [] });

		registerMultiSkills(mock.pi);

		expect(mock.inputHandlers).toHaveLength(1);
	});

	it("wires the registered handler end to end through the mock chain", async () => {
		const mock = createMockPi({
			commands: [skillCommand("a", writeSkillFile("a")), skillCommand("b", writeSkillFile("b"))],
		});
		registerMultiSkills(mock.pi);

		const result = await emitInput(mock.inputHandlers, "/skill:a /skill:b refactor");

		expect(textOf(result).match(/<skill name=/g)).toHaveLength(2);
	});
});
