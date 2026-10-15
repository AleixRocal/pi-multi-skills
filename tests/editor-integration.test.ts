/**
 * The wrapper inside the host's real editor.
 *
 * `tests/host-provider.test.ts` pins the provider seam; this file pins the one
 * thing neither the unit tests nor the provider tests can see: *when* the editor
 * asks at all. The host requests completions for a mid-message `/` only when its
 * autocomplete list is already open (`components/editor.js:1022-1027` runs the
 * `char === "/"` branch only for `isAtStartOfMessage()`, and `/` is filtered out
 * of `triggerCharacters` at `:1952-1956`), so what a user sees while typing a
 * chain depends on editor state, not only on this extension.
 *
 * The probe drives the real `Editor` with a bare TUI double: the editor touches
 * only `tui.requestRender` and `tui.terminal.rows` (`components/editor.js:405`).
 */

import { afterEach, describe, expect, it } from "vitest";
import { CombinedAutocompleteProvider, Editor } from "@earendil-works/pi-tui";
import { wrapWithChainAutocomplete } from "../src/autocomplete.js";
import { invalidateSkillIndex } from "../src/registry.js";
import { createMockPi, skillCommand } from "./helpers/mock-pi.js";

afterEach(() => {
	invalidateSkillIndex();
});

/** Editor internals this probe reads; they are private and read-only here. */
interface Probed {
	autocompleteState?: unknown;
	autocompletePrefix?: string;
	autocompleteList?: { items?: readonly unknown[] };
	autocompleteRequestTask?: Promise<unknown>;
}

/** Skills the editor's command list and the registry both know about. */
const SKILLS = ["design", "plan", "research"];

/** Build an editor whose provider is this extension's wrapper over the real one. */
function editorWithChain(skills: readonly string[] = SKILLS) {
	const base = new CombinedAutocompleteProvider(
		skills.map((name) => ({ name: `skill:${name}` })),
		"/tmp",
		null,
	);
	const wrapped = wrapWithChainAutocomplete(
		base as unknown as Parameters<typeof wrapWithChainAutocomplete>[0],
		createMockPi({
			commands: SKILLS.map((name) => skillCommand(name, `/skills/${name}/SKILL.md`)),
		}).pi,
	);

	const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } };
	const colorFn = (text: string) => text;
	const editor = new Editor(tui as never, new Proxy({}, { get: () => colorFn }) as never, {});
	editor.setAutocompleteProvider(wrapped as never);

	return editor;
}

/** Type `text` one character at a time, waiting for each autocomplete request. */
async function type(editor: Editor, text: string): Promise<void> {
	for (const char of text) {
		editor.handleInput(char);
		await (editor as unknown as Probed).autocompleteRequestTask;
	}
}

/** What the editor is currently showing, if anything. */
function menu(editor: Editor): { prefix: string; items: readonly unknown[] } | null {
	const probed = editor as unknown as Probed;
	const items = probed.autocompleteList?.items;
	if (items === undefined) return null;
	return { prefix: probed.autocompletePrefix ?? "", items };
}

describe("editor integration", () => {
	it("opens pi's own menu for the first token", async () => {
		const editor = editorWithChain();

		await type(editor, "/skill:");

		expect(menu(editor)?.items).toHaveLength(SKILLS.length);
	});

	it("opens the skill menu on the character after the second `/`", async () => {
		const editor = editorWithChain();

		await type(editor, "/skill:plan /");

		// The host does not request for a mid-message `/` on its own.
		expect(menu(editor)).toBeNull();

		await type(editor, "s");

		// Ours: every skill, because `/s` is a half-typed marker.
		expect(menu(editor)).toEqual({
			prefix: "/s",
			items: [
				{ value: "/skill:design", label: "/skill:design" },
				{ value: "/skill:plan", label: "/skill:plan" },
				{ value: "/skill:research", label: "/skill:research" },
			],
		});
	});

	it("keeps the menu open across the marker, and filters as the name is typed", async () => {
		const editor = editorWithChain();

		await type(editor, "/skill:plan /skill:re");

		expect(menu(editor)).toEqual({
			prefix: "/skill:re",
			items: [{ value: "/skill:research", label: "/skill:research" }],
		});
	});

	it("filters on a bare name fragment, the way the first token is picked", async () => {
		const editor = editorWithChain();

		await type(editor, "/skill:plan /re");

		expect(menu(editor)).toEqual({
			prefix: "/re",
			items: [{ value: "/skill:research", label: "/skill:research" }],
		});
	});

	it("writes the chosen skill through the editor's Tab completion", async () => {
		const editor = editorWithChain();

		await type(editor, "/skill:plan /skill:re");
		expect(menu(editor)?.items).toHaveLength(1);

		// Tab accepts the only match (`handleTabCompletion` → `forceFileAutocomplete`
		// → the provider's `applyCompletion`), which is the path a user takes.
		editor.handleInput("\t");
		await (editor as unknown as Probed).autocompleteRequestTask;

		expect(editor.getText()).toBe("/skill:plan /skill:research ");
	});
});
