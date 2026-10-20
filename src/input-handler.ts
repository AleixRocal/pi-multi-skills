/**
 * Input handler — the `input` hook that turns one user message naming several
 * skills into N sibling `<skill …>` blocks.
 *
 * Why this hook: Pi dispatches `input` BEFORE its own skill expansion — `prompt()`
 * runs `_runInputHandlers` at `agent-session.js:1623` and only then
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
 * threaded through unchanged. It is read for exactly one thing — the warning a
 * chain produces (`ctx.ui.notify`, `core/extensions/types.d.ts:548`) — because
 * the facts that warning names are known here and nowhere else.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { markChainForDisplay } from "./chain-display.js";
import { COST_WARN_CHARS, resolveMaxChainedSkills } from "./config.js";
import { SKILL_BLOCK_PREFIX, expandSkillTokens } from "./expander.js";
import { getSkillIndex } from "./registry.js";
import type { SkillExpansion } from "./types.js";

/** The marker this module names in its notice; same literal the parser tokenises. */
const MARKER = "/skill:";

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
 * One notice per transformed message, built from the expansion plan.
 *
 * Built from the plan rather than from the emitted text because only the
 * expander knows which names resolved, which overran the cap and which were
 * collapsed; a reader that has to re-parse the text can only guess. This is the
 * surface that keeps the transcript honest: the transcript shows what the user
 * typed (it is rebuilt from blocks and cannot see a failed name), and the notice
 * says what actually ran.
 *
 * Empty when there is nothing to say, which is every well-behaved chain below
 * the cost threshold.
 */
function buildNotice(expansion: SkillExpansion, chars: number, max: number): string {
	const lines: string[] = [];

	if (chars >= COST_WARN_CHARS) {
		const skills = expansion.expanded.length;
		lines.push(`${skills} skill${skills === 1 ? "" : "s"} · ${formatChars(chars)} chars injected`);
	}
	if (expansion.unresolved.length > 0) {
		lines.push(`${formatNames(expansion.unresolved)} not found — left as text`);
	}
	if (expansion.overflow.length > 0) {
		lines.push(`${formatNames(expansion.overflow)} past the cap (${max}) — left as argument text`);
	}
	if (expansion.duplicated.length > 0) {
		lines.push(`${formatNames(expansion.duplicated)} expanded once`);
	}

	return lines.join(" · ");
}

/** `31.2k` above a thousand, the raw count below it. */
function formatChars(chars: number): string {
	return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
}

/** `/skill:a, /skill:b` — the syntax the user typed, not a bare name. */
function formatNames(names: readonly string[]): string {
	return names.map((name) => `${MARKER}${name}`).join(", ");
}

/**
 * Emit the notice, if this message has anything worth saying.
 *
 * `chars` is the length of the text actually handed to pi, not the plan's own
 * cost: on the rescue path the message also carries blocks another extension
 * emitted, and those are context the model pays for too.
 */
function reportIfWorthwhile(
	ctx: ExtensionContext,
	expansion: SkillExpansion,
	chars: number,
	max: number,
): void {
	const notice = buildNotice(expansion, chars, max);
	if (notice.length > 0) ctx.ui.notify(notice, "warning");
}

/**
 * Handle one `input` event.
 *
 * Guards, in order:
 *
 *  1. `source === "extension"` → `continue`. The only way an extension re-enters
 *     this hook is `pi.sendUserMessage`, which forces `source: "extension"`
 *     (`agent-session.js:1907`), so this single check breaks any loop over our
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
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): InputEventResult {
	// Guard 1.
	if (event.source === "extension") return { action: "continue" };

	const text = event.text;
	// Resolved once per message and never cached: the flag is a lookup, and a
	// cached copy would be one more thing that can go stale across a session swap.
	const max = resolveMaxChainedSkills(pi);

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

		const residual = expandSkillTokens(text.slice(boundary), getSkillIndex(pi), max);
		if (residual === null) return { action: "continue" };

		const finalText = `${text.slice(0, boundary)}${BLOCK_SEPARATOR}${residual.text}`;
		reportIfWorthwhile(ctx, residual, finalText.length, max);

		return { action: "transform", text: markChainForDisplay(finalText, namedWithoutBlock(residual)) };
	}

	// Clean path. `expandSkillTokens` returns null when the message names no skill
	// at all, or when every token it names failed to resolve (guard 2).
	const expanded = expandSkillTokens(text, getSkillIndex(pi), max);
	if (expanded === null) return { action: "continue" };

	reportIfWorthwhile(ctx, expanded, expanded.text.length, max);

	return { action: "transform", text: markChainForDisplay(expanded.text, namedWithoutBlock(expanded)) };
}

/**
 * Skills this message names that carry no block of their own.
 *
 * The display has to keep a chain off the card path, and a card would swallow
 * exactly these: a name that did not resolve, a marker past the cap, a name
 * collapsed into an earlier block. `markChainForDisplay` adds them to the blocks
 * it can count, because a single block plus one of these is still a chain.
 */
function namedWithoutBlock(expansion: SkillExpansion): number {
	return expansion.unresolved.length + expansion.overflow.length + expansion.duplicated.length;
}
