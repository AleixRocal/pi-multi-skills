/**
 * Chain autocomplete — the `/skill:` menu at every chain position, not only the
 * first token.
 *
 * Why this module exists. Pi's own menu is line-start only:
 *
 *  - `CombinedAutocompleteProvider.getSuggestions`
 *    (`@earendil-works/pi-tui/dist/autocomplete.js:232-235`) enters the command
 *    branch only when the text before the cursor, trimmed, starts with `/` AND
 *    carries no space. A second token (`/skill:a /ski`) has a space, so it falls
 *    through to the argument branch (`:263-271`), finds that `skill:<name>`
 *    declares no `getArgumentCompletions`, and returns `null` — no menu.
 *  - `applyCompletion` (`:303`) treats an item as a command only when the text
 *    before the prefix is empty, i.e. only the first token.
 *  - The editor auto-triggers on `/` only at the start of the message
 *    (`components/editor.js:1022-1027`) and refuses `/` as a declared trigger
 *    character (`:1952-1956`), so a mid-message `/` starts nothing by itself.
 *
 * It still fires one keystroke later: `isInSlashCommandContext`
 * (`editor.js:1845-1847`) is `textBeforeCursor.trimStart().startsWith("/")`,
 * which stays true for the whole chain, so the request that would have been made
 * by the second `/` is made on the character after it. That is why a half-typed
 * marker counts as a chain position too (`chainTokenAt`), and why the menu lists
 * every skill from `/s` onward rather than only from the complete marker.
 *
 * Contract with the host: `ctx.ui.addAutocompleteProvider(factory)`
 * (`core/extensions/types.d.ts:66,141`) wraps the current provider. Suggestions
 * are replaced only for a chain token at the cursor; every other position —
 * including the first token, where pi's menu lists all commands rather than only
 * skills — is delegated unchanged, so nothing outside a chain moves.
 *
 * Two host facts this module does NOT rely on, recorded so the delegation is not
 * mistaken for an oversight: `/` cannot be a trigger character (the editor drops
 * it, `editor.js:1952-1956`), and the provider is asked again on every keystroke
 * of a `/`-prefixed message, so no trigger declaration is needed.
 */

import type { AutocompleteProviderFactory, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAX_CHAINED_SKILLS, parseSkillChain } from "./parser.js";
import { getSkillIndex } from "./registry.js";

/**
 * The host publishes the factory type but not the provider it wraps
 * (`core/extensions/types.d.ts:66`); `AutocompleteProvider` and
 * `AutocompleteItem` themselves live in `@earendil-works/pi-tui`, which this
 * package does not depend on. Deriving both from the factory keeps the declared
 * dependency surface at `@earendil-works/pi-coding-agent` alone.
 */
type AutocompleteProvider = Parameters<AutocompleteProviderFactory>[0];
type AutocompleteItem = NonNullable<
	Awaited<ReturnType<AutocompleteProvider["getSuggestions"]>>
>["items"][number];

/** Marker the parser and pi's own expansion both recognise (`agent-session.js:1698`). */
const TOKEN_MARKER = "/skill:";

/**
 * The whitespace-delimited run the cursor sits in, with its offset.
 *
 * A run is the parser's own unit: `src/parser.ts` reads a skill name as
 * everything up to the next whitespace, so the menu and the expander agree on
 * where a token ends.
 */
function trailingRun(line: string): { start: number; text: string } | null {
	const match = /(^|\s)(\S*)$/u.exec(line);
	if (match === null) return null;
	return { start: match.index + (match[1]?.length ?? 0), text: match[2] ?? "" };
}

/** A chain token being typed at the cursor. */
export interface ChainToken {
	/** Offset of the leading `/`, within the line. */
	readonly start: number;
	/** The text the menu's choice replaces, e.g. `"/skill:de"` or `"/p"`. */
	readonly text: string;
	/** Partial name typed so far, without the marker; `""` when only the marker is partial. */
	readonly prefix: string;
}

/**
 * The chain token the cursor sits at the end of, when it is worth a menu.
 *
 * Two shapes count:
 *
 *  - **The full marker** — `/skill:<partial name>`. Unambiguous anywhere in the
 *    message, so it needs no further condition.
 *  - **A leading fragment** — `/`, `/s`, … `/skill`, or a bare `/name`. This is
 *    what makes the menu usable at all: the host never requests completions for a
 *    mid-message `/` (`components/editor.js:1022-1027`, and `/` is rejected as a
 *    trigger character at `:1952-1956`), so the request arrives on the character
 *    that follows it, and the fragment is what has been typed by then.
 *
 * A leading fragment counts only after a token is already committed on the line,
 * and only while it stays name-shaped (no further `/`): that keeps `check /srv`
 * and `/skill:implement /plans/x.md` on pi's path completion
 * (`autocomplete.js:388-390`) instead of offering skills.
 *
 * `null` means "not ours": nothing at the cursor, or a token at the very start of
 * the line — the position pi's own menu already serves, with every command rather
 * than only skills (`autocomplete.js:233-262`).
 */
export function chainTokenAt(line: string): ChainToken | null {
	const run = trailingRun(line);
	if (run === null || run.start === 0) return null;

	if (run.text.startsWith(TOKEN_MARKER)) {
		return { start: run.start, text: run.text, prefix: run.text.slice(TOKEN_MARKER.length) };
	}

	if (!run.text.startsWith("/") || run.text.slice(1).includes("/")) return null;
	if (parseSkillChain(line.slice(0, run.start)).tokens.length === 0) return null;

	// `/s` is a half-typed marker, so it filters nothing (`""` lists every skill);
	// `/pl` is a name fragment, so it filters on `pl`.
	const typed = run.text.slice(1);
	return { start: run.start, text: run.text, prefix: TOKEN_MARKER.startsWith(run.text) ? "" : typed };
}

/** Plain code-unit ordering, not `localeCompare`: independent of the host's ICU locale. */
function compareNames(a: string, b: string): number {
	if (a === b) return 0;
	return a < b ? -1 : 1;
}

/**
 * Menu entries for `token`, ordered most-specific-first.
 *
 * Prefix matches rank above mid-name matches; ties fall back to `compareNames`,
 * so the menu does not depend on the host's ICU locale.
 *
 * `value` and `label` both read `/skill:<name>`: the label is what the editor
 * shows, and the value is what `applyCompletion` inserts, so the entry is named
 * exactly as the syntax it writes. The editor's own highlight then matches the
 * typed prefix byte for byte (`components/editor.js:1848-1873`).
 */
function chainSuggestions(token: ChainToken, pi: ExtensionAPI): AutocompleteItem[] {
	const needle = token.prefix.toLowerCase();
	const ranked: { name: string; rank: number }[] = [];

	for (const entry of getSkillIndex(pi).values()) {
		const at = entry.name.toLowerCase().indexOf(needle);
		if (at === -1) continue;
		ranked.push({ name: entry.name, rank: at === 0 ? 0 : 1 });
	}

	ranked.sort((a, b) => a.rank - b.rank || compareNames(a.name, b.name));

	return ranked.map((entry) => {
		const command = `${TOKEN_MARKER}${entry.name}`;
		return { value: command, label: command };
	});
}

/**
 * Tokens already committed on the line before `token`.
 *
 * The parser's own cap is the ceiling (`MAX_CHAINED_SKILLS`): once it is
 * reached the menu offers nothing, because a further marker would not expand —
 * the expander stops at the cap and leaves the rest as literal argument text
 * (`src/parser.ts:50-56`).
 */
function committedSkills(line: string, token: ChainToken): number {
	return parseSkillChain(line.slice(0, token.start)).tokens.length;
}

/**
 * Wrap `current` so chain positions get a skill menu.
 *
 * Every method delegates unless the cursor is inside a chain token, which keeps
 * the host's behaviour intact for file paths, `@` attachments, argument
 * completions and the first-token command menu.
 */
export function wrapWithChainAutocomplete(
	current: AutocompleteProvider,
	pi: ExtensionAPI,
): AutocompleteProvider {
	/** Text before the cursor, on the cursor's line. */
	const textBefore = (lines: string[], cursorLine: number, cursorCol: number): string =>
		(lines[cursorLine] ?? "").slice(0, cursorCol);

	return {
		// Passed through rather than declared: `/` cannot be a trigger character
		// (`editor.js:1952-1956`) and does not need to be one.
		triggerCharacters: current.triggerCharacters,

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const line = lines[cursorLine] ?? "";
			const token = chainTokenAt(line.slice(0, cursorCol));

			if (token !== null && committedSkills(line, token) < MAX_CHAINED_SKILLS) {
				const items = chainSuggestions(token, pi);
				if (items.length > 0) return { items, prefix: token.text };
			}

			return current.getSuggestions(lines, cursorLine, cursorCol, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const currentLine = lines[cursorLine] ?? "";
			const before = currentLine.slice(0, cursorCol - prefix.length);

			// Only a chain token is ours. The first-token case has a different
			// `prefix` derivation (`autocomplete.js:303-313`) even though it
			// inserts at the same place, so it keeps the host's implementation.
			if (chainTokenAt(`${before}${prefix}`) === null) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}

			// The item's value is the full `/skill:<name>` the token becomes, so it
			// replaces the typed fragment — partial marker (`/s`), bare name (`/pl`)
			// or complete marker alike.
			const after = currentLine.slice(cursorCol);
			const next = [...lines];
			next[cursorLine] = `${before}${item.value} ${after}`;

			return {
				lines: next,
				cursorLine,
				cursorCol: before.length + item.value.length + 1, // +1 for the space
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			// Inside a chain token, Tab is a skill completion, not a path search:
			// the host's `false` here would swallow the key and show nothing.
			if (chainTokenAt(textBefore(lines, cursorLine, cursorCol)) !== null) return true;
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

/**
 * Register the wrapper on the session's autocomplete chain.
 *
 * Called from `registerMultiSkills` on every `session_start`. Re-registering is
 * safe and necessary: the interactive host drops every wrapper before a session
 * is swapped or reloaded (`interactive-mode.js:363-365` → `resetExtensionUI`),
 * so the "startup", "new", "resume", "fork" and "reload" reasons all need it
 * back. Non-interactive modes stub the call out (`core/extensions/runner.js:152`,
 * `modes/rpc/rpc-mode.js:194`), so no mode guard is needed.
 */
export function registerChainAutocomplete(ctx: ExtensionContext, pi: ExtensionAPI): void {
	ctx.ui.addAutocompleteProvider((current) => wrapWithChainAutocomplete(current, pi));
}
