/**
 * The wrapper against the host's real provider.
 *
 * `tests/autocomplete.test.ts` drives `wrapWithChainAutocomplete` with a stub, so
 * it pins this extension's own decisions. This file pins the seam instead: the
 * host's `CombinedAutocompleteProvider` is the real one, and what is asserted is
 * that delegation still produces pi's shapes and that the chain case answers where
 * the host answers `null`.
 *
 * It imports `@earendil-works/pi-tui` at runtime, which this package depends on
 * only through `@earendil-works/pi-coding-agent`. That is deliberate: the whole
 * point is to fail loudly if the host's provider contract moves.
 */

import { afterEach, describe, expect, it } from "vitest";
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";
import { wrapWithChainAutocomplete } from "../src/autocomplete.js";
import { invalidateSkillIndex } from "../src/registry.js";
import { createMockPi, skillCommand } from "./helpers/mock-pi.js";

afterEach(() => {
	invalidateSkillIndex();
});

/** Two skills plus a non-skill command, as the editor would see them. */
function fixture() {
	const commands = [
		{ name: "model", description: "pick a model" },
		{ name: "skill:design", description: "shape code" },
		{ name: "skill:plan", description: "sequence work" },
	];
	const base = new CombinedAutocompleteProvider(commands, "/tmp", null);
	const wrapped = wrapWithChainAutocomplete(
		base as unknown as Parameters<typeof wrapWithChainAutocomplete>[0],
		createMockPi({
			commands: [
				skillCommand("design", "/skills/design/SKILL.md"),
				skillCommand("plan", "/skills/plan/SKILL.md"),
			],
		}).pi,
	);

	return { base, wrapped };
}

/** Ask the provider for suggestions with the cursor at the end of `line`. */
async function at(
	provider: ReturnType<typeof wrapWithChainAutocomplete>,
	line: string,
	cursorCol = line.length,
) {
	return provider.getSuggestions([line], 0, cursorCol, { signal: new AbortController().signal });
}

describe("host provider integration", () => {
	it("leaves pi's command menu on the first token untouched", async () => {
		const { wrapped } = fixture();

		const result = await at(wrapped, "/ski");

		// pi's own shape: every command is a candidate, `value` carries `skill:`.
		expect(result?.prefix).toBe("/ski");
		expect(result?.items.map((item) => item.value)).toContain("skill:design");
	});

	it("answers with skills where the host answers nothing, mid-chain", async () => {
		const { base, wrapped } = fixture();
		const line = "/skill:plan /skill:pl";

		expect(await at(base, line)).toBeNull();
		expect(await at(wrapped, line)).toEqual({
			items: [{ value: "/skill:plan", label: "/skill:plan" }],
			prefix: "/skill:pl",
		});
	});

	it("also answers for a half-typed second marker", async () => {
		const { base, wrapped } = fixture();
		const line = "/skill:plan /s";

		expect(await at(base, line)).toBeNull();
		expect(await at(wrapped, line)).toEqual({
			items: [
				{ value: "/skill:design", label: "/skill:design" },
				{ value: "/skill:plan", label: "/skill:plan" },
			],
			prefix: "/s",
		});
	});

	it("also answers for a bare name fragment", async () => {
		const { wrapped } = fixture();

		expect(await at(wrapped, "/skill:plan /pl")).toEqual({
			items: [{ value: "/skill:plan", label: "/skill:plan" }],
			prefix: "/pl",
		});
	});

	it("does not steal path completion for a `/word` in prose", async () => {
		const { wrapped } = fixture();

		// `/tmp` exists, so the host's path completion answers; the chain rule
		// requires a committed token before a leading fragment.
		const result = await at(wrapped, "look at /tmp");

		expect(result).not.toBeNull();
		expect(result?.items.some((item) => item.value.startsWith("/skill:"))).toBe(false);
	});

	it("does not steal a path-shaped argument inside a chain", async () => {
		const { wrapped } = fixture();
		const line = "/skill:plan /tmp";

		// The host answers `null` here (a `/`-prefixed message never reaches its
		// path branch), so this only asserts that the skill menu stays out of it.
		expect((await at(wrapped, line))?.items ?? null).toBeNull();
	});

	it("keeps Tab as a path search outside a chain token", async () => {
		const { wrapped } = fixture();

		expect(wrapped.shouldTriggerFileCompletion?.(["look at /tmp"], 0, 12)).toBe(true);
		expect(wrapped.shouldTriggerFileCompletion?.(["/skill:plan /skill:pl"], 0, 21)).toBe(true);
		expect(wrapped.shouldTriggerFileCompletion?.(["/skill:plan /skill:"], 0, 20)).toBe(true);
		expect(wrapped.shouldTriggerFileCompletion?.(["/skill:plan /p"], 0, 16)).toBe(true);
	});

	it("inserts a skill name through the host's editor contract", () => {
		const { wrapped } = fixture();
		const line = "/skill:plan /s";

		const applied = wrapped.applyCompletion([line], 0, line.length, {
			value: "/skill:plan",
			label: "/skill:plan",
		}, "/s");

		expect(applied.lines).toEqual(["/skill:plan /skill:plan "]);
		expect(applied.cursorCol).toBe("/skill:plan /skill:plan ".length);
	});
});
