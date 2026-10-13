import { describe, expect, it } from "vitest";
import { MAX_CHAINED_SKILLS, parseSkillChain } from "../src/parser.js";

describe("parseSkillChain — tokenisation", () => {
	it("pins the cap at 6 (Decision 2)", () => {
		expect(MAX_CHAINED_SKILLS).toBe(6);
	});

	it("returns an empty chain when the message names no skill", () => {
		expect(parseSkillChain("hello world")).toEqual({ preamble: "", tokens: [] });
		expect(parseSkillChain("")).toEqual({ preamble: "", tokens: [] });
		expect(parseSkillChain("   \n  ")).toEqual({ preamble: "", tokens: [] });
	});

	it("tokenises a single token at offset 0 and binds the trailing text as args", () => {
		expect(parseSkillChain("/skill:design refactor auth")).toEqual({
			preamble: "",
			tokens: [{ name: "design", start: 0, end: 13, args: "refactor auth" }],
		});
	});

	it("binds empty args when a token has no trailing text", () => {
		expect(parseSkillChain("/skill:design")).toEqual({
			preamble: "",
			tokens: [{ name: "design", start: 0, end: 13, args: "" }],
		});
	});

	it("keeps the preamble that precedes the first token", () => {
		expect(parseSkillChain("please /skill:design now")).toEqual({
			preamble: "please",
			tokens: [{ name: "design", start: 7, end: 20, args: "now" }],
		});
	});

	it("broadcasts the trailing run to every token of a contiguous chain (Claude Code parity)", () => {
		expect(parseSkillChain("/skill:research /skill:design refactor auth")).toEqual({
			preamble: "",
			tokens: [
				{ name: "research", start: 0, end: 15, args: "" },
				{ name: "design", start: 16, end: 29, args: "refactor auth" },
			],
		});
	});

	it("binds per-token arguments when text separates the tokens (Decision 1's superset)", () => {
		expect(parseSkillChain("/skill:a x /skill:b y")).toEqual({
			preamble: "",
			tokens: [
				{ name: "a", start: 0, end: 8, args: "x" },
				{ name: "b", start: 11, end: 19, args: "y" },
			],
		});
	});

	it("expands a marker that sits inside prose (accepted cost of Decision 1)", () => {
		expect(parseSkillChain("compare /skill:design and /skill:plan output")).toEqual({
			preamble: "compare",
			tokens: [
				{ name: "design", start: 8, end: 21, args: "and" },
				{ name: "plan", start: 26, end: 37, args: "output" },
			],
		});
	});

	it("ends a name at the first whitespace — tab and newline included", () => {
		const expected = [{ name: "a", start: 0, end: 8, args: "b" }];
		expect(parseSkillChain("/skill:a\tb").tokens).toEqual(expected);
		expect(parseSkillChain("/skill:a\nb").tokens).toEqual(expected);
	});

	it("trims only the edges of args, keeping interior newlines", () => {
		expect(parseSkillChain("/skill:design\n\nline one\nline two\n").tokens).toEqual([
			{ name: "design", start: 0, end: 13, args: "line one\nline two" },
		]);
	});

	it("skips a marker that carries no name", () => {
		expect(parseSkillChain("/skill: /skill:a x")).toEqual({
			preamble: "/skill:",
			tokens: [{ name: "a", start: 8, end: 16, args: "x" }],
		});
	});

	it("reads adjacent markers as one name when no whitespace separates them", () => {
		expect(parseSkillChain("/skill:a/skill:b").tokens).toEqual([
			{ name: "a/skill:b", start: 0, end: 16, args: "" },
		]);
	});
});

describe("parseSkillChain — cap", () => {
	it("tokenises at most MAX_CHAINED_SKILLS and binds the overflow as literal args", () => {
		const chain = parseSkillChain("/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f /skill:g tail");
		expect(chain.tokens).toHaveLength(MAX_CHAINED_SKILLS);
		expect(chain.tokens.map((token) => token.name)).toEqual(["a", "b", "c", "d", "e", "f"]);
		expect(chain.tokens[MAX_CHAINED_SKILLS - 1].args).toBe("/skill:g tail");
	});

	it("tokenises exactly MAX_CHAINED_SKILLS when the chain fits the cap", () => {
		const chain = parseSkillChain("/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f");
		expect(chain.tokens).toHaveLength(MAX_CHAINED_SKILLS);
		expect(chain.tokens[MAX_CHAINED_SKILLS - 1].args).toBe("");
	});
});

describe("parseSkillChain — never triggers on a bare slash", () => {
	it.each(["src/app.ts", "/etc/hosts", "https://example.com/x", "a / b", "/"])(
		"leaves %s alone",
		(text) => {
			expect(parseSkillChain(text).tokens).toEqual([]);
		},
	);
});

describe("parseSkillChain — offsets", () => {
	it("round-trips every token to `/skill:` + name", () => {
		const text = "please /skill:research refactor /skill:design auth\n/skill:plan";
		for (const token of parseSkillChain(text).tokens) {
			expect(text.slice(token.start, token.end)).toBe(`/skill:${token.name}`);
		}
	});

	it("emits tokens in message order with non-overlapping ranges", () => {
		const tokens = parseSkillChain("/skill:a x /skill:b y /skill:c").tokens;
		expect(tokens.map((token) => token.name)).toEqual(["a", "b", "c"]);
		for (let i = 1; i < tokens.length; i++) {
			expect(tokens[i].start).toBeGreaterThan(tokens[i - 1].end);
		}
	});
});
