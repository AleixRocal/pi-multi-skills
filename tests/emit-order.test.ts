import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { stripFrontmatter, type ExtensionAPI, type InputEventResult } from "@earendil-works/pi-coding-agent";
import { appendArgs, buildSkillBlock } from "../src/expander.js";
import { handleInput } from "../src/input-handler.js";
import { invalidateSkillIndex } from "../src/registry.js";
import type { SkillEntry, SkillIndex } from "../src/types.js";
import { createMockPi, emitInput, skillCommand, type InputHandler } from "./helpers/mock-pi.js";

/**
 * Handler-order independence against `@juicesharp/rpiv-args`.
 *
 * Pi runs `input` handlers in extension load order and gives nobody an ordering
 * key (`docs/extensions.md:98`; `dist/core/package-manager.js:62-70` plus a
 * stable sort). `rpiv-args` sits at index 14 of the `packages` array in
 * `/home/user/.pi/agent/settings.json` and `pi install` appends new packages
 * *after* it, so "rpiv-args first" is the default here — both orders are
 * exercised, and `tests/helpers/mock-pi.ts` reproduces the runner chain
 * (`runner.js:1201-1236`) they run through.
 */

/** Verbatim copy of Pi's `parseSkillBlock` regex (dist/core/agent-session.js:54). */
const PARSE_SKILL_BLOCK =
	/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

let root: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-multi-skills-order-"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

// `getSkillIndex` caches process-wide, so every test starts from a cold cache.
afterEach(() => {
	invalidateSkillIndex();
});

/** Write a real SKILL.md under the temp root and return its canonical path. */
function writeSkillFile(name: string, body = `${name.toUpperCase()} BODY`): string {
	const baseDir = join(root, name);
	mkdirSync(baseDir, { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`, "utf-8");
	return filePath;
}

interface Fixture {
	readonly pi: ExtensionAPI;
	/** The name → entry index the stub resolves against. */
	readonly index: SkillIndex;
	entry(name: string): SkillEntry;
}

/** A mock `pi` plus the index, both over the same on-disk fixtures. */
function fixture(...names: readonly string[]): Fixture {
	const index = new Map<string, SkillEntry>();
	for (const name of names) {
		const filePath = writeSkillFile(name);
		index.set(name, { name, filePath, baseDir: join(root, name) });
	}

	return {
		pi: createMockPi({
			commands: [...index.values()].map((entry) => skillCommand(entry.name, entry.filePath)),
		}).pi,
		index,
		entry(name) {
			const found = index.get(name);
			if (found === undefined) throw new Error(`no fixture skill named ${name}`);
			return found;
		},
	};
}

/**
 * Stand-in for `@juicesharp/rpiv-args` (`args.ts:400-448`): one leading
 * `/skill:<name>` token, split at the FIRST space with everything after it bound
 * as that skill's argument text (`args.ts:414-416`) — the behaviour that
 * swallows a second skill. It emits through this package's byte-exact helpers,
 * so the interop under test is the real byte contract and not a paraphrase of
 * it.
 */
function rpivArgsStub(index: SkillIndex): InputHandler {
	return (event) => {
		const text = event.text;
		if (text.startsWith("<skill ")) return { action: "continue" };
		if (!text.startsWith("/skill:")) return { action: "continue" };

		const spaceIndex = text.indexOf(" ");
		const name = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
		const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

		const entry = index.get(name);
		if (entry === undefined) return { action: "continue" };

		let content: string;
		try {
			content = readFileSync(entry.filePath, "utf-8");
		} catch {
			return { action: "continue" };
		}

		return {
			action: "transform",
			text: appendArgs(buildSkillBlock(entry, stripFrontmatter(content).trim()), args),
		};
	};
}

/** Narrow a result to its transformed text, failing loudly otherwise. */
function textOf(result: InputEventResult): string {
	if (result.action !== "transform") throw new Error(`expected a transform, got ${result.action}`);
	return result.text;
}

/** This extension's handler, bound to the fixture's `pi`. */
function ours(pi: ExtensionAPI): InputHandler {
	return (event, ctx) => handleInput(event, ctx, pi);
}

describe("input-handler order independence vs @juicesharp/rpiv-args", () => {
	it("produces byte-identical output in both handler orders", async () => {
		const f = fixture("a", "b");
		const stub = rpivArgsStub(f.index);

		const oursFirst = await emitInput([ours(f.pi), stub], "/skill:a x /skill:b y");
		const stubFirst = await emitInput([stub, ours(f.pi)], "/skill:a x /skill:b y");

		expect(textOf(stubFirst)).toBe(textOf(oursFirst));
	});

	it("expands the whole chain when this extension runs first", async () => {
		const f = fixture("a", "b");

		const text = textOf(await emitInput([ours(f.pi), rpivArgsStub(f.index)], "/skill:a x /skill:b y"));

		expect(text).toBe(
			`${appendArgs(buildSkillBlock(f.entry("a"), "A BODY"), "x")}\n\n${appendArgs(buildSkillBlock(f.entry("b"), "B BODY"), "y")}`,
		);
	});

	it("rescues the residual token when rpiv-args runs first", async () => {
		const f = fixture("a", "b");

		const text = textOf(await emitInput([rpivArgsStub(f.index), ours(f.pi)], "/skill:a x /skill:b y"));

		expect(text.match(/<skill name=/g)).toHaveLength(2);
	});

	it("keeps the N=1 case byte-identical to native Pi in both orders", async () => {
		const f = fixture("a");
		const expected = appendArgs(buildSkillBlock(f.entry("a"), "A BODY"), "x");

		expect(textOf(await emitInput([ours(f.pi), rpivArgsStub(f.index)], "/skill:a x"))).toBe(expected);
		expect(textOf(await emitInput([rpivArgsStub(f.index), ours(f.pi)], "/skill:a x"))).toBe(expected);
	});

	it("stays parseable by Pi's parseSkillBlock regex in both orders", async () => {
		const f = fixture("a", "b");
		const stub = rpivArgsStub(f.index);

		for (const handlers of [[ours(f.pi), stub], [stub, ours(f.pi)]]) {
			const match = textOf(await emitInput(handlers, "/skill:a x /skill:b y")).match(PARSE_SKILL_BLOCK);
			expect(match?.[1]).toBe("a");
		}
	});

	it("is idempotent when registered twice — no loop over its own output", async () => {
		const f = fixture("a", "b");

		const text = textOf(await emitInput([ours(f.pi), ours(f.pi)], "/skill:a /skill:b"));

		expect(text.match(/<skill name=/g)).toHaveLength(2);
	});

	it("continues past a throwing handler, as the host does (runner.js:1223-1230)", async () => {
		const f = fixture("a", "b");
		const throwing: InputHandler = () => {
			throw new Error("boom");
		};

		const text = textOf(await emitInput([throwing, ours(f.pi)], "/skill:a /skill:b"));

		expect(text.match(/<skill name=/g)).toHaveLength(2);
	});

	it("stops the chain on a `handled` result (runner.js:1216-1217)", async () => {
		const f = fixture("a");
		const handled: InputHandler = () => ({ action: "handled" });

		expect(await emitInput([handled, ours(f.pi)], "/skill:a x")).toEqual({ action: "handled" });
	});
});
