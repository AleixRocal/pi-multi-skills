/**
 * Skill-chain parser.
 *
 * A "chain" is a user message that names one or more skills with
 * `/skill:<name>` tokens. Each token owns the free text from the end of its
 * name up to the next token — or, for the last token, to the end of the
 * message. That is positional binding.
 *
 * Two deliberate divergences from Pi's native `_expandSkillCommand`
 * (`dist/core/agent-session.js:1698-1722`):
 *
 *  - Native splits at the FIRST space (`text.indexOf(" ")`, `:1701-1703`) and
 *    swallows everything after it as one skill's argument text, so
 *    `/skill:a /skill:b x` silently loses `b`. Here every `/skill:` marker is
 *    a candidate and each token binds the text that follows it.
 *  - Native only expands when the message STARTS with `/skill:` (`:1698`).
 *    Here a marker anywhere in the message is a token, which is what lets the
 *    rescue path (text that already starts with `<skill ` and still carries a
 *    residual `/skill:`) reuse this same function.
 *
 * The parser imports no host code and touches no filesystem, so the tokeniser
 * stays unit-testable in isolation and is shared by the clean and the rescue
 * path. The cap is an argument, not a constant: what the ceiling *is* belongs to
 * `src/config.ts`, and a default here would be a second copy of that policy.
 */

import type { SkillChain, SkillToken, TokenStart } from "./types.js";

/** Marker pi's own expansion recognises (`agent-session.js:1699`). */
const TOKEN_MARKER = "/skill:";

/** A skill name is a non-whitespace run; pi's own tokenisation is single-space (`:1701`). */
const WHITESPACE = /\s/;

/**
 * Collect token boundaries left to right.
 *
 * The first `max` become `tokens`; every later marker becomes `overflow`. The
 * scan deliberately does not stop at the cap: an over-cap marker is not a skill,
 * but it is something the caller has to be able to name ("`/skill:g` did not
 * run"), and this is the only place that can still tell one marker from another.
 *
 * Overflow entries are never bound — their text stays inside the last admitted
 * token's arguments, which is the invariant that makes an overrun degrade into
 * readable text instead of input that disappears.
 */
function collectTokenStarts(
	text: string,
	max: number,
): { tokens: TokenStart[]; overflow: TokenStart[] } {
	const tokens: TokenStart[] = [];
	const overflow: TokenStart[] = [];
	let cursor = 0;

	while (true) {
		const marker = text.indexOf(TOKEN_MARKER, cursor);
		if (marker === -1) break;

		const nameStart = marker + TOKEN_MARKER.length;
		let nameEnd = nameStart;
		while (nameEnd < text.length && !WHITESPACE.test(text.charAt(nameEnd))) nameEnd++;

		const name = text.slice(nameStart, nameEnd);
		// `/skill:` with no name cannot resolve to anything, so it is not a
		// chainable token: leave it to the surrounding text (it surfaces in the
		// preamble or in a neighbouring token's args) instead of binding
		// arguments to a name that can never match.
		if (name.length === 0) {
			cursor = nameStart;
			continue;
		}

		const token: TokenStart = { name, start: marker, end: nameEnd };
		if (tokens.length < max) tokens.push(token);
		else overflow.push(token);
		cursor = nameEnd;
	}

	return { tokens, overflow };
}

/** Bind each boundary to the text it owns, up to the next boundary. */
function bindArgs(text: string, starts: readonly TokenStart[]): SkillToken[] {
	return starts.map((token, index) => {
		const next = starts[index + 1];
		const regionEnd = next ? next.start : text.length;
		return {
			name: token.name,
			start: token.start,
			end: token.end,
			args: text.slice(token.end, regionEnd).trim(),
		};
	});
}

/**
 * Scan a user message for chainable `/skill:<name>` tokens.
 *
 * Returns the preamble (text before the first token) plus every token in
 * message order, each with the offsets needed to rebuild the message exactly —
 * which is how the input handler keeps unresolvable tokens verbatim in place.
 *
 * `max` is the caller's ceiling (`resolveMaxChainedSkills` in `src/config.ts`).
 * It is required, not defaulted, so the number lives in exactly one module.
 */
export function parseSkillChain(text: string, max: number): SkillChain {
	const { tokens: starts, overflow } = collectTokenStarts(text, max);
	if (starts.length === 0) return { preamble: "", tokens: [], overflow };
	const first = starts[0];
	return {
		preamble: text.slice(0, first.start).trim(),
		tokens: bindArgs(text, starts),
		overflow,
	};
}
