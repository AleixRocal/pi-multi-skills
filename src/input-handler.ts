/**
 * Input handler — the `input` hook that turns one user message naming several
 * skills into N sibling `<skill …>` blocks.
 *
 * Why this hook: Pi dispatches `input` BEFORE its own skill expansion — `prompt()`
 * runs `_runInputHandlers` at `agent-session.js:1622` and only then
 * `_expandSkillCommand` at `:1631`, and the `steer`/`followUp` path does the same
 * at `:1726`/`:1729`. A `{action:"transform"}` return therefore replaces the text
 * Pi goes on to expand, and because the replacement no longer starts with
 * `/skill:` (`:1698`) Pi hands it through untouched, so all N emitted blocks
 * survive to the model.
 *
 * Pipeline shape mirrors @juicesharp/rpiv-args (`args.ts:400-448`): guards first,
 * a single transform last, and every path that cannot serve the message returns
 * `{action:"continue"}` so Pi's native behaviour is left exactly as it is.
 *
 * Both transform paths return through `markChainForDisplay`
 * (`src/chain-display.ts`), which is what makes a multi-skill message render in
 * the transcript as the `/skill:a x /skill:b y` the user typed: the host renders
 * a leading well-formed block as a skill card, and cards run no markdown
 * transformers, so a chain has to be marked not to take that path.
 *
 * `ctx` is part of the host's handler signature (`ExtensionHandler`) and is
 * threaded through unchanged so the exported signature stays stable as the
 * extension grows; it is declared `_ctx` because this expander itself reads no
 * session state — unlike `rpiv-args`, whose `${SESSION_ID}` substitution needs
 * `ctx.sessionManager`.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { markChainForDisplay } from "./chain-display.js";
import { SKILL_BLOCK_PREFIX, expandSkillTokens } from "./expander.js";
import { getSkillIndex } from "./registry.js";

/**
 * Closing tag of the emitted wrapper — the counterpart of `SKILL_BLOCK_PREFIX`
 * and byte-identical to the tail of `buildSkillBlock`'s template literal. The
 * handler needs the boundary so the rescue path can tell an already-emitted
 * block from the text that follows it.
 */
const SKILL_BLOCK_CLOSE = "</skill>";

/**
 * Join between an already-emitted block and the text the rescue path appends to
 * it. Same value as the private `BLOCK_SEPARATOR` in `expander.ts`: both are
 * pinned to the separator `parseSkillBlock` (`agent-session.js:53-63`) requires
 * before its trailing user-message group.
 */
const BLOCK_SEPARATOR = "\n\n";

/**
 * Handle one `input` event.
 *
 * Guards, in order:
 *
 *  1. `source === "extension"` → `continue`. The only way an extension re-enters
 *     this hook is `pi.sendUserMessage`, which forces `source: "extension"`
 *     (`agent-session.js:1906`), so this single check breaks any loop over our
 *     own output.
 *  2. Nothing resolves → `continue`. Pi's own expansion then runs, which also
 *     preserves Pi's error behaviour for a single unknown skill.
 *
 * The third guard lives per token inside `expandSkillTokens`: an unknown name or
 * an unreadable SKILL.md leaves that token's original span verbatim while the
 * rest of the chain still expands, so `/skill:nonexistent /skill:real x` still
 * expands `real`. That departs from `rpiv-args`' whole-message bail
 * (`args.ts:419,425`), which is right for a single-skill expander and wrong for a
 * chain.
 */
export function handleInput(
	event: InputEvent,
	_ctx: ExtensionContext,
	pi: ExtensionAPI,
): InputEventResult {
	// Guard 1.
	if (event.source === "extension") return { action: "continue" };

	const text = event.text;

	// Rescue path. By default `rpiv-args` wins the ordering race —
	// it sits at index 14 of the `packages` array in settings.json and `pi
	// install` appends after it — so `/skill:a /skill:b args` arrives here as
	// `<skill a …>…</skill>\n\n/skill:b args`, and a plain
	// `startsWith("<skill ")` re-entrancy guard (`args.ts:409`) would lose skill
	// `b` without a signal.
	//
	// The scan is deliberately scoped to the text AFTER the last `</skill>`, not
	// to the whole message: an emitted block's body is a skill's own prose, and
	// skills that document chaining (this project's own design skill, for one)
	// carry literal `/skill:` markers. Scanning them would emit a block for every
	// mention.
	const openIndex = text.indexOf(SKILL_BLOCK_PREFIX);
	if (openIndex !== -1) {
		const closeIndex = text.lastIndexOf(SKILL_BLOCK_CLOSE);
		// No closing tag after the opening one — an unterminated block. Nothing
		// can be isolated safely, so leave the whole message to Pi.
		if (closeIndex < openIndex) return { action: "continue" };

		const boundary = closeIndex + SKILL_BLOCK_CLOSE.length;

		const residual = expandSkillTokens(text.slice(boundary), getSkillIndex(pi));
		if (residual === null) return { action: "continue" };

		return {
			action: "transform",
			text: markChainForDisplay(`${text.slice(0, boundary)}${BLOCK_SEPARATOR}${residual}`),
		};
	}

	// Clean path. `expandSkillTokens` returns null when the message names no skill
	// at all, or when every token it names failed to resolve (guard 2).
	const expanded = expandSkillTokens(text, getSkillIndex(pi));
	if (expanded === null) return { action: "continue" };

	return { action: "transform", text: markChainForDisplay(expanded) };
}
