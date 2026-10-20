/**
 * `src/config.ts` — the cap resolver, and the flag declaration it reads.
 *
 * The resolver is the only place a bad flag value can be absorbed, so the table
 * below is deliberately exhaustive about what "not an integer" looks like:
 * every entry is a value `Number.parseInt` would happily truncate into a
 * plausible cap, which is exactly the failure the whole-string test exists for.
 */

import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import {
	DEFAULT_MAX_CHAINED_SKILLS,
	MAX_CHAINED_SKILLS_FLAG,
	resolveMaxChainedSkills,
} from "../src/config.js";
import { createMockPi } from "./helpers/mock-pi.js";

/** A `pi` double that answers `getFlag` and nothing else. */
function withFlag(value: string | boolean | undefined): ExtensionAPI {
	return { getFlag: () => value } as unknown as ExtensionAPI;
}

describe("resolveMaxChainedSkills", () => {
	it("defaults when the flag was never set", () => {
		expect(resolveMaxChainedSkills(withFlag(undefined))).toBe(DEFAULT_MAX_CHAINED_SKILLS);
	});

	it("accepts a positive integer", () => {
		expect(resolveMaxChainedSkills(withFlag("1"))).toBe(1);
		expect(resolveMaxChainedSkills(withFlag("10"))).toBe(10);
	});

	it.each(["0", "-1", "1.5", "6skills", " 7 ", "", "abc", "0x10", "1e3", "+6"])(
		"falls back to the default for %j",
		(value) => {
			expect(resolveMaxChainedSkills(withFlag(value))).toBe(DEFAULT_MAX_CHAINED_SKILLS);
		},
	);

	it("falls back when the host answers with a boolean", () => {
		// `registerFlag` has no numeric type, so the only legal answers are a string
		// or `undefined`; a boolean means the declaration and the read disagree.
		expect(resolveMaxChainedSkills(withFlag(true))).toBe(DEFAULT_MAX_CHAINED_SKILLS);
	});
});

describe("the flag declaration", () => {
	it("registers a string flag defaulting to the code default", () => {
		const mock = createMockPi();
		registerMultiSkills(mock.pi);

		const flag = mock.flagRegistrations.find((entry) => entry.name === MAX_CHAINED_SKILLS_FLAG);
		expect(flag).toBeDefined();
		expect(flag?.type).toBe("string");
		expect(flag?.default).toBe(String(DEFAULT_MAX_CHAINED_SKILLS));
	});

	it("resolves the declared default", () => {
		const mock = createMockPi();
		registerMultiSkills(mock.pi);
		expect(resolveMaxChainedSkills(mock.pi)).toBe(DEFAULT_MAX_CHAINED_SKILLS);
	});

	it("reads a value the user passed", () => {
		const mock = createMockPi({ flags: { [MAX_CHAINED_SKILLS_FLAG]: "10" } });
		registerMultiSkills(mock.pi);
		expect(resolveMaxChainedSkills(mock.pi)).toBe(10);
	});
});
