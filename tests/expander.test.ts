import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendArgs, buildSkillBlock, expandSkillTokens } from "../src/expander.js";
import type { SkillEntry, SkillIndex } from "../src/types.js";

/**
 * Verbatim copy of Pi's `parseSkillBlock` regex
 * (dist/core/agent-session.js:54). The emitted text is load-bearing against it:
 * drift — including a trailing newline — silently demotes a skill message to
 * raw text in the transcript.
 */
const PARSE_SKILL_BLOCK =
	/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

let root: string;

/** Write a real SKILL.md in a temp dir and return its `SkillEntry`. */
function makeSkill(name: string, body = `${name.toUpperCase()} BODY`): SkillEntry {
	const baseDir = join(root, name);
	mkdirSync(baseDir, { recursive: true });
	const filePath = join(baseDir, "SKILL.md");
	writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`, "utf-8");
	return { name, filePath, baseDir };
}

/** Name → entry index, the same shape `src/registry.ts` produces. */
function indexOf(...entries: readonly SkillEntry[]): SkillIndex {
	return new Map(entries.map((entry) => [entry.name, entry] as const));
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-multi-skills-expander-"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("buildSkillBlock — byte parity with native Pi", () => {
	it("emits the native template literal field for field (agent-session.js:1709)", () => {
		const entry: SkillEntry = {
			name: "design",
			filePath: "/x/skills/design/SKILL.md",
			baseDir: "/x/skills/design",
		};

		expect(buildSkillBlock(entry, "BODY")).toBe(
			'<skill name="design" location="/x/skills/design/SKILL.md">\nReferences are relative to /x/skills/design.\n\nBODY\n</skill>',
		);
	});

	it("never emits a trailing newline (parseSkillBlock anchors on $)", () => {
		const block = buildSkillBlock({ name: "a", filePath: "/a/SKILL.md", baseDir: "/a" }, "B");
		expect(block.endsWith("</skill>")).toBe(true);
		expect(block.endsWith("\n")).toBe(false);
	});
});

describe("appendArgs — native trailing-argument rule", () => {
	it("returns the block untouched when there are no arguments", () => {
		const block = buildSkillBlock({ name: "a", filePath: "/a/SKILL.md", baseDir: "/a" }, "B");
		expect(appendArgs(block, "")).toBe(block);
	});

	it("appends the arguments after exactly one blank line (agent-session.js:1710)", () => {
		expect(appendArgs("BLOCK", "refactor auth")).toBe("BLOCK\n\nrefactor auth");
	});
});

describe("expandSkillTokens — a single skill (N=1 byte-identity)", () => {
	it("reproduces native Pi's expansion for `/skill:design refactor auth`", () => {
		const design = makeSkill("design", "Refactor carefully.");
		const text = "/skill:design refactor auth";
		const expected = appendArgs(buildSkillBlock(design, "Refactor carefully."), "refactor auth");

		expect(expandSkillTokens(text, indexOf(design))).toBe(expected);
		expect(expected.endsWith("</skill>\n\nrefactor auth")).toBe(true);
	});

	it("emits no argument suffix when the token has none", () => {
		const design = makeSkill("design");
		expect(expandSkillTokens("/skill:design", indexOf(design))).toBe(buildSkillBlock(design, "DESIGN BODY"));
	});

	it("strips frontmatter and trims the body", () => {
		const design = makeSkill("design", "\n\n   padded body   \n\n");
		expect(expandSkillTokens("/skill:design", indexOf(design))).toContain("\n\npadded body\n</skill>");
	});

	it("re-reads the SKILL.md on every call, so a mid-session edit is picked up", () => {
		const design = makeSkill("design", "FIRST BODY");
		const index = indexOf(design);

		expect(expandSkillTokens("/skill:design", index)).toContain("FIRST BODY");

		writeFileSync(design.filePath, "---\nname: design\ndescription: d\n---\n\nSECOND BODY\n", "utf-8");
		expect(expandSkillTokens("/skill:design", index)).toContain("SECOND BODY");
	});
});

describe("expandSkillTokens — chains", () => {
	it("joins N blocks with exactly one blank line, args after the last block", () => {
		const research = makeSkill("research", "RESEARCH BODY");
		const design = makeSkill("design", "DESIGN BODY");

		const result = expandSkillTokens("/skill:research /skill:design refactor auth", indexOf(research, design));

		expect(result).toBe(
			`${buildSkillBlock(research, "RESEARCH BODY")}\n\n${appendArgs(buildSkillBlock(design, "DESIGN BODY"), "refactor auth")}`,
		);
	});

	it("binds per-token arguments when text separates the tokens", () => {
		const a = makeSkill("a", "A BODY");
		const b = makeSkill("b", "B BODY");

		expect(expandSkillTokens("/skill:a x /skill:b y", indexOf(a, b))).toBe(
			`${appendArgs(buildSkillBlock(a, "A BODY"), "x")}\n\n${appendArgs(buildSkillBlock(b, "B BODY"), "y")}`,
		);
	});

	it("keeps the preamble verbatim in front of the emitted blocks", () => {
		const design = makeSkill("design");

		expect(expandSkillTokens("please /skill:design now", indexOf(design))).toBe(
			`please\n\n${appendArgs(buildSkillBlock(design, "DESIGN BODY"), "now")}`,
		);
	});

	it("expands a residual token after an already-emitted block (rescue-path shape)", () => {
		const research = makeSkill("research", "RESEARCH BODY");
		const design = makeSkill("design", "DESIGN BODY");
		const wrapped = buildSkillBlock(research, "RESEARCH BODY");

		expect(expandSkillTokens(`${wrapped}\n\n/skill:design now`, indexOf(research, design))).toBe(
			`${wrapped}\n\n${appendArgs(buildSkillBlock(design, "DESIGN BODY"), "now")}`,
		);
	});
});

describe("expandSkillTokens — an unresolvable token is left verbatim", () => {
	it("leaves an unknown token verbatim and still expands its siblings", () => {
		const design = makeSkill("design");

		expect(expandSkillTokens("/skill:nope x /skill:design y", indexOf(design))).toBe(
			`/skill:nope x\n\n${appendArgs(buildSkillBlock(design, "DESIGN BODY"), "y")}`,
		);
	});

	it("leaves a token verbatim when its file cannot be read", () => {
		const broken: SkillEntry = {
			name: "broken",
			filePath: join(root, "missing", "SKILL.md"),
			baseDir: join(root, "missing"),
		};
		const design = makeSkill("design");

		expect(expandSkillTokens("/skill:broken x /skill:design y", indexOf(broken, design))).toBe(
			`/skill:broken x\n\n${appendArgs(buildSkillBlock(design, "DESIGN BODY"), "y")}`,
		);
	});

	it("returns null when the message carries no token at all", () => {
		const index = indexOf(makeSkill("design"));

		expect(expandSkillTokens("hello world", index)).toBeNull();
		expect(expandSkillTokens("", index)).toBeNull();
	});

	it("returns null for bare-slash input that must never trigger", () => {
		const index = indexOf(makeSkill("design"));

		for (const text of ["src/app.ts", "/etc/hosts", "https://example.com/x", "a / b", "/"]) {
			expect(expandSkillTokens(text, index)).toBeNull();
		}
	});

	it("returns null when none of the chain's tokens resolve", () => {
		expect(expandSkillTokens("/skill:nope x /skill:also-nope y", indexOf())).toBeNull();
	});
});

describe("expandSkillTokens — the cap at 6, where the 7th marker stays literal", () => {
	it("emits at most 6 blocks and binds the 7th marker as literal arguments", () => {
		const index = indexOf(...["a", "b", "c", "d", "e", "f"].map((name) => makeSkill(name)));

		const result =
			expandSkillTokens("/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f /skill:g tail", index) ?? "";

		expect(result.match(/<skill name=/g)).toHaveLength(6);
		expect(result.endsWith("</skill>\n\n/skill:g tail")).toBe(true);
	});
});

describe("expandSkillTokens — contract with Pi's parseSkillBlock regex", () => {
	it("satisfies the regex, with the trailing run as the user message", () => {
		const design = makeSkill("design");
		const result = expandSkillTokens("/skill:design refactor auth", indexOf(design)) ?? "";

		const match = result.match(PARSE_SKILL_BLOCK);
		expect(match).not.toBeNull();
		expect(match?.[1]).toBe("design");
		expect(match?.[4]).toBe("refactor auth");
	});

	it("stays parseable for a 2-skill chain — block 2 lands in the user-message group", () => {
		// Only text after the FIRST `</skill>` reaches a UserMessageComponent
		// (interactive-mode.js:3187-3211), which is the surface Slice 6 rewrites.
		const a = makeSkill("a", "A BODY");
		const b = makeSkill("b", "B BODY");
		const result = expandSkillTokens("/skill:a x /skill:b y", indexOf(a, b)) ?? "";

		const match = result.match(PARSE_SKILL_BLOCK);
		expect(match?.[1]).toBe("a");
		expect(match?.[4]).toBe(`x\n\n${appendArgs(buildSkillBlock(b, "B BODY"), "y")}`);
	});
});
