import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CHAINED_SKILLS } from "../src/config.js";
import { parseSkillChain } from "../src/parser.js";
import type { SkillToken, TokenStart } from "../src/types.js";

/**
 * Parse with the shipped default cap.
 *
 * `max` is a required argument (`src/parser.ts`), so a spec that is not about
 * the cap would otherwise repeat the same number at every call site. The specs
 * that ARE about it call `parseSkillChain` directly with an explicit ceiling.
 */
function parse(text: string, max = DEFAULT_MAX_CHAINED_SKILLS) {
	return parseSkillChain(text, max);
}

/** A chain with no overflow, which is what most of these messages are. */
function chain(preamble: string, tokens: SkillToken[], overflow: TokenStart[] = []) {
	return { preamble, tokens, overflow };
}

describe("parseSkillChain — tokenisation", () => {
	it("returns an empty chain when the message names no skill", () => {
		expect(parse("hello world")).toEqual(chain("", []));
		expect(parse("")).toEqual(chain("", []));
		expect(parse("   \n  ")).toEqual(chain("", []));
	});

	it("tokenises a single token at offset 0 and binds the trailing text as args", () => {
		expect(parse("/skill:design refactor auth")).toEqual(
			chain("", [{ name: "design", start: 0, end: 13, args: "refactor auth" }]),
		);
	});

	it("binds empty args when a token has no trailing text", () => {
		expect(parse("/skill:design")).toEqual(
			chain("", [{ name: "design", start: 0, end: 13, args: "" }]),
		);
	});

	it("keeps the preamble that precedes the first token", () => {
		expect(parse("please /skill:design now")).toEqual(
			chain("please", [{ name: "design", start: 7, end: 20, args: "now" }]),
		);
	});

	it("broadcasts the trailing run to every token of a contiguous chain (Claude Code parity)", () => {
		expect(parse("/skill:research /skill:design refactor auth")).toEqual(
			chain("", [
				{ name: "research", start: 0, end: 15, args: "" },
				{ name: "design", start: 16, end: 29, args: "refactor auth" },
			]),
		);
	});

	it("binds per-token arguments when text separates the tokens", () => {
		expect(parse("/skill:a x /skill:b y")).toEqual(
			chain("", [
				{ name: "a", start: 0, end: 8, args: "x" },
				{ name: "b", start: 11, end: 19, args: "y" },
			]),
		);
	});

	it("expands a marker that sits inside prose, which is the accepted cost", () => {
		expect(parse("compare /skill:design and /skill:plan output")).toEqual(
			chain("compare", [
				{ name: "design", start: 8, end: 21, args: "and" },
				{ name: "plan", start: 26, end: 37, args: "output" },
			]),
		);
	});

	it("ends a name at the first whitespace — tab and newline included", () => {
		const expected = [{ name: "a", start: 0, end: 8, args: "b" }];
		expect(parse("/skill:a\tb").tokens).toEqual(expected);
		expect(parse("/skill:a\nb").tokens).toEqual(expected);
	});

	it("trims only the edges of args, keeping interior newlines", () => {
		expect(parse("/skill:design\n\nline one\nline two\n").tokens).toEqual([
			{ name: "design", start: 0, end: 13, args: "line one\nline two" },
		]);
	});

	it("skips a marker that carries no name", () => {
		expect(parse("/skill: /skill:a x")).toEqual(
			chain("/skill:", [{ name: "a", start: 8, end: 16, args: "x" }]),
		);
	});

	it("reads adjacent markers as one name when no whitespace separates them", () => {
		expect(parse("/skill:a/skill:b").tokens).toEqual([
			{ name: "a/skill:b", start: 0, end: 16, args: "" },
		]);
	});
});

describe("parseSkillChain — the cap", () => {
	it("admits at most `max` tokens and binds the rest as literal argument text", () => {
		const text = "/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f /skill:g tail";
		const parsed = parse(text);

		expect(parsed.tokens).toHaveLength(DEFAULT_MAX_CHAINED_SKILLS);
		expect(parsed.tokens.map((token) => token.name)).toEqual(["a", "b", "c", "d", "e", "f"]);
		expect(parsed.tokens[DEFAULT_MAX_CHAINED_SKILLS - 1].args).toBe("/skill:g tail");
	});

	it("reports the markers it did not admit, in message order", () => {
		const text = "/skill:a /skill:b /skill:c /skill:d tail";
		const parsed = parse(text, 2);

		expect(parsed.tokens.map((token) => token.name)).toEqual(["a", "b"]);
		expect(parsed.overflow.map((token) => token.name)).toEqual(["c", "d"]);
		expect(parsed.tokens[1].args).toBe("/skill:c /skill:d tail");

		// The offsets stay usable: the caller names the marker it reports.
		for (const token of parsed.overflow) {
			expect(text.slice(token.start, token.end)).toBe(`/skill:${token.name}`);
		}
	});

	it("honours a ceiling above the number of markers", () => {
		expect(parse("/skill:a /skill:b", 99)).toEqual(chain("", [
			{ name: "a", start: 0, end: 8, args: "" },
			{ name: "b", start: 9, end: 17, args: "" },
		]));
	});

	it("admits nothing at a ceiling of zero and reports every marker", () => {
		const parsed = parse("/skill:a /skill:b", 0);

		expect(parsed.tokens).toEqual([]);
		expect(parsed.overflow.map((token) => token.name)).toEqual(["a", "b"]);
	});

	it("does not report a nameless marker past the cap", () => {
		// A bare `/skill:` can never resolve, so it is not a skill that failed to
		// run — reporting it would give the notice a name it cannot act on.
		const parsed = parse("/skill:a /skill: /skill:b", 1);

		expect(parsed.tokens.map((token) => token.name)).toEqual(["a"]);
		expect(parsed.overflow.map((token) => token.name)).toEqual(["b"]);
	});
});

describe("parseSkillChain — never triggers on a bare slash", () => {
	it.each(["src/app.ts", "/etc/hosts", "https://example.com/x", "a / b", "/"])(
		"leaves %s alone",
		(text) => {
			expect(parse(text).tokens).toEqual([]);
		},
	);
});

describe("parseSkillChain — offsets", () => {
	it("round-trips every token to `/skill:` + name", () => {
		const text = "please /skill:research refactor /skill:design auth\n/skill:plan";
		for (const token of parse(text).tokens) {
			expect(text.slice(token.start, token.end)).toBe(`/skill:${token.name}`);
		}
	});

	it("emits tokens in message order with non-overlapping ranges", () => {
		const tokens = parse("/skill:a x /skill:b y /skill:c").tokens;
		expect(tokens.map((token) => token.name)).toEqual(["a", "b", "c"]);
		for (let i = 1; i < tokens.length; i++) {
			expect(tokens[i].start).toBeGreaterThan(tokens[i - 1].end);
		}
	});
});
