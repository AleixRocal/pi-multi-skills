import { afterEach, describe, expect, it } from "vitest";
import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import {
	chainTokenAt,
	registerChainAutocomplete,
	wrapWithChainAutocomplete,
} from "../src/autocomplete.js";
import { invalidateSkillIndex } from "../src/registry.js";
import { createMockCtx, createMockPi, skillCommand } from "./helpers/mock-pi.js";

// `getSkillIndex` caches process-wide, so every test starts from a cold cache.
afterEach(() => {
	invalidateSkillIndex();
});

/**
 * The host provider, reachable only through the factory type
 * (`@earendil-works/pi-coding-agent` re-exports the factory, not the provider).
 */
type Provider = Parameters<AutocompleteProviderFactory>[0];

/** The slice of the provider result these tests assert on. */
interface Suggestions {
	readonly items: readonly { readonly value: string; readonly label: string }[];
	readonly prefix: string;
}

/** What the host stub answers with, so delegation is distinguishable. */
const HOST_SUGGESTIONS: Suggestions = { items: [{ value: "model", label: "model" }], prefix: "/mo" };

/** A host provider double that records every delegation. */
function hostStub(suggestions: Suggestions | null = HOST_SUGGESTIONS): {
	readonly provider: Provider;
	readonly calls: readonly string[];
} {
	const calls: string[] = [];
	const provider = {
		triggerCharacters: ["@", "#"],
		async getSuggestions() {
			calls.push("getSuggestions");
			return suggestions;
		},
		applyCompletion(lines: string[], cursorLine: number, _cursorCol: number, item: { value: string }) {
			calls.push("applyCompletion");
			const next = [...lines];
			next[cursorLine] = `HOST:${item.value}`;
			return { lines: next, cursorLine, cursorCol: 0 };
		},
		shouldTriggerFileCompletion: () => {
			calls.push("shouldTriggerFileCompletion");
			return false;
		},
	};

	return { provider: provider as unknown as Provider, calls };
}

/** Three skills: two match `de` (one by prefix, one mid-name) and one does not. */
function skillsPi() {
	return createMockPi({
		commands: [
			skillCommand("design", "/skills/design/SKILL.md"),
			skillCommand("code-design", "/skills/code-design/SKILL.md"),
			skillCommand("plan", "/skills/plan/SKILL.md"),
		],
	});
}

/** Call the wrapper's `getSuggestions` for a single-line message. */
async function suggest(line: string, cursorCol = line.length, pi = skillsPi().pi) {
	const { provider, calls } = hostStub();
	const wrapped = wrapWithChainAutocomplete(provider, pi);
	const result = await wrapped.getSuggestions([line], 0, cursorCol, {
		signal: new AbortController().signal,
	});
	return { result, calls };
}

/** Menu entries for the two skills matching `de`, in menu order. */
const DE_MATCHES = [
	{ value: "/skill:design", label: "/skill:design" },
	{ value: "/skill:code-design", label: "/skill:code-design" },
];

/** Every skill, in menu order, as the entries for an empty filter look. */
const ALL_SKILLS = [
	{ value: "/skill:code-design", label: "/skill:code-design" },
	{ value: "/skill:design", label: "/skill:design" },
	{ value: "/skill:plan", label: "/skill:plan" },
];

describe("chainTokenAt", () => {
	it("finds a `/skill:` token past the first one", () => {
		expect(chainTokenAt("/skill:a /skill:ca")).toEqual({
			start: 9,
			text: "/skill:ca",
			prefix: "ca",
		});
	});

	it("finds a token written after prose", () => {
		expect(chainTokenAt("please /skill:de")).toEqual({
			start: 7,
			text: "/skill:de",
			prefix: "de",
		});
	});

	it("matches an empty prefix right after the marker", () => {
		expect(chainTokenAt("/skill:plan /skill:")).toEqual({
			start: 12,
			text: "/skill:",
			prefix: "",
		});
	});

	it("leaves a token at the start of the line to pi's own menu", () => {
		expect(chainTokenAt("/skill:design")).toBeNull();
	});

	it("ignores a marker that is not at a token boundary", () => {
		expect(chainTokenAt("/skill:plan x/skill:de")).toBeNull();
	});

	it("ignores paths and URLs", () => {
		expect(chainTokenAt("/etc/hosts")).toBeNull();
		expect(chainTokenAt("https://example.com/x")).toBeNull();
	});

	it("ignores text after the name, where the cursor is not naming a skill", () => {
		expect(chainTokenAt("/skill:plan /skill:design extra")).toBeNull();
	});

	it("accepts a leading fragment once a token is committed on the line", () => {
		// The host never requests completions for a mid-message `/`
		// (`editor.js:1022-1027`), so the request arrives on the next character.
		expect(chainTokenAt("/skill:plan /")).toEqual({ start: 12, text: "/", prefix: "" });
		expect(chainTokenAt("/skill:plan /s")).toEqual({ start: 12, text: "/s", prefix: "" });
		expect(chainTokenAt("/skill:plan /skill")).toEqual({
			start: 12,
			text: "/skill",
			prefix: "",
		});
	});

	it("filters on a bare name fragment", () => {
		expect(chainTokenAt("/skill:plan /pl")).toEqual({ start: 12, text: "/pl", prefix: "pl" });
	});

	it("rejects a leading fragment with nothing committed before it", () => {
		// `/srv` in prose is a path: pi's path completion owns it
		// (`autocomplete.js:388-390`), not the skill menu.
		expect(chainTokenAt("check /s")).toBeNull();
		expect(chainTokenAt("/")).toBeNull();
		expect(chainTokenAt("/s")).toBeNull();
	});

	it("rejects a path-shaped fragment inside a chain", () => {
		// `/plans/x.md` as an argument keeps its own slashes.
		expect(chainTokenAt("/skill:implement /plans/x.md")).toBeNull();
		expect(chainTokenAt("/skill:implement /home/user")).toBeNull();
	});

	it("ignores an empty or whitespace-only tail", () => {
		expect(chainTokenAt("")).toBeNull();
		expect(chainTokenAt("/skill:plan ")).toBeNull();
	});
});

describe("wrapWithChainAutocomplete — getSuggestions", () => {
	it("offers matching skills for a chain token, with the token as the prefix", async () => {
		const { result, calls } = await suggest("/skill:plan /skill:de");

		expect(result).toEqual({ items: DE_MATCHES, prefix: "/skill:de" });
		// The host is not consulted once the menu is ours.
		expect(calls).toEqual([]);
	});

	it("ranks prefix matches above mid-name matches, then by name", async () => {
		const labels = async (line: string) => (await suggest(line)).result?.items.map((i) => i.label);

		expect(await labels("/skill:plan /skill:de")).toEqual([
			"/skill:design",
			"/skill:code-design",
		]);
		expect(await labels("/skill:plan /skill:")).toEqual([
			"/skill:code-design",
			"/skill:design",
			"/skill:plan",
		]);
	});

	it("delegates to the host when the cursor is not in a chain token", async () => {
		const { result, calls } = await suggest("/mo");

		expect(result).toEqual(HOST_SUGGESTIONS);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("leaves the first-token menu to the host, which lists every command", async () => {
		const { result, calls } = await suggest("/skill:de");

		expect(result).toEqual(HOST_SUGGESTIONS);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("falls back to the host when no skill matches the typed prefix", async () => {
		const { result, calls } = await suggest("/skill:plan /skill:zzz");

		expect(result).toEqual(HOST_SUGGESTIONS);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("lists every skill for a leading fragment, replacing what was typed", async () => {
		expect((await suggest("/skill:plan /s")).result).toEqual({
			items: ALL_SKILLS,
			prefix: "/s",
		});
		expect((await suggest("/skill:plan /")).result).toEqual({
			items: ALL_SKILLS,
			prefix: "/",
		});
	});

	it("filters on a bare name fragment", async () => {
		expect((await suggest("/skill:plan /pl")).result).toEqual({
			items: [{ value: "/skill:plan", label: "/skill:plan" }],
			prefix: "/pl",
		});
	});

	it("delegates a leading fragment written in prose", async () => {
		const { result, calls } = await suggest("check /s");

		expect(result).toEqual(HOST_SUGGESTIONS);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("offers nothing once the chain cap is reached", async () => {
		const six = "/skill:a /skill:b /skill:c /skill:d /skill:e /skill:f";
		const { result, calls } = await suggest(`${six} /s`);

		// The seventh marker would not expand (`src/parser.ts` stops at the cap),
		// so the menu stops offering names for it.
		expect(result).toEqual(HOST_SUGGESTIONS);
		expect(calls).toEqual(["getSuggestions"]);
	});

	it("still offers names for the sixth skill of a chain", async () => {
		const five = "/skill:a /skill:b /skill:c /skill:d /skill:e";
		const { result } = await suggest(`${five} /skill:de`);

		expect(result?.items).toEqual(DE_MATCHES);
	});

	it("ignores the cursor column past the token", async () => {
		const line = "/skill:plan /skill:de ignored";
		const { result } = await suggest(line, "/skill:plan /skill:de".length);

		expect(result?.prefix).toBe("/skill:de");
	});

	it("passes the host's trigger characters through", () => {
		const { provider } = hostStub();

		expect(wrapWithChainAutocomplete(provider, skillsPi().pi).triggerCharacters).toEqual(["@", "#"]);
	});
});

describe("wrapWithChainAutocomplete — applyCompletion", () => {
	it("inserts the chosen skill in place, mid-line", () => {
		const line = "/skill:a /skill:de";
		const { provider } = hostStub();
		const wrapped = wrapWithChainAutocomplete(provider, skillsPi().pi);

		const result = wrapped.applyCompletion([line], 0, line.length, DE_MATCHES[0]!, "/skill:de");

		expect(result.lines).toEqual(["/skill:a /skill:design "]);
		expect(result.cursorLine).toBe(0);
		expect(result.cursorCol).toBe("/skill:a /skill:design ".length);
	});

	it("completes a bare name fragment into the full marker", () => {
		const line = "/skill:plan /pl";
		const { provider } = hostStub();
		const wrapped = wrapWithChainAutocomplete(provider, skillsPi().pi);

		const result = wrapped.applyCompletion([line], 0, line.length, {
			value: "/skill:plan",
			label: "/skill:plan",
		}, "/pl");

		expect(result.lines).toEqual(["/skill:plan /skill:plan "]);
		expect(result.cursorCol).toBe("/skill:plan /skill:plan ".length);
	});

	it("delegates a first-token completion to the host", () => {
		const line = "/skill:de";
		const { provider, calls } = hostStub();
		const wrapped = wrapWithChainAutocomplete(provider, skillsPi().pi);

		const result = wrapped.applyCompletion([line], 0, line.length, {
			value: "skill:design",
			label: "skill:design",
		}, "/skill:de");

		expect(result.lines).toEqual(["HOST:skill:design"]);
		expect(calls).toEqual(["applyCompletion"]);
	});
});

describe("wrapWithChainAutocomplete — shouldTriggerFileCompletion", () => {
	it("lets Tab complete a skill inside a chain token", () => {
		const { provider, calls } = hostStub();
		const wrapped = wrapWithChainAutocomplete(provider, skillsPi().pi);

		expect(wrapped.shouldTriggerFileCompletion?.(["/skill:a /skill:de"], 0, 18)).toBe(true);
		expect(wrapped.shouldTriggerFileCompletion?.(["/skill:a /p"], 0, 12)).toBe(true);
		expect(calls).toEqual([]);
	});

	it("delegates outside a chain token", () => {
		const { provider, calls } = hostStub();
		const wrapped = wrapWithChainAutocomplete(provider, skillsPi().pi);

		expect(wrapped.shouldTriggerFileCompletion?.(["a file na"], 0, 10)).toBe(false);
		expect(calls).toEqual(["shouldTriggerFileCompletion"]);
	});
});

describe("registerChainAutocomplete", () => {
	/** Capture the wrappers an extension hands to the host's UI context. */
	function captureFactories() {
		const factories: AutocompleteProviderFactory[] = [];
		const ctx = createMockCtx({
			ui: { addAutocompleteProvider: (factory: AutocompleteProviderFactory) => factories.push(factory) },
		});
		return { factories, ctx };
	}

	it("is registered by the extension entry point on session start", async () => {
		const mock = skillsPi();
		registerMultiSkills(mock.pi);
		const { factories, ctx } = captureFactories();

		mock.sessionStartHandlers[0]?.({ type: "session_start", reason: "startup" }, ctx);

		expect(factories).toHaveLength(1);
		const wrapped = factories[0]?.(hostStub().provider);
		const result = await wrapped?.getSuggestions(["/skill:plan /skill:de"], 0, 21, {
			signal: new AbortController().signal,
		});
		expect(result?.items).toEqual(DE_MATCHES);
	});

	it("re-registers for every reason, because the host clears wrappers per session", () => {
		const mock = skillsPi();
		registerMultiSkills(mock.pi);
		const { factories, ctx } = captureFactories();

		for (const reason of ["startup", "new", "resume", "fork", "reload"] as const) {
			mock.sessionStartHandlers[0]?.({ type: "session_start", reason }, ctx);
		}

		expect(factories).toHaveLength(5);
	});

	it("registers nothing but the wrapper when called directly", () => {
		const mock = skillsPi();
		const { factories, ctx } = captureFactories();

		registerChainAutocomplete(ctx, mock.pi);

		expect(factories).toHaveLength(1);
	});
});
