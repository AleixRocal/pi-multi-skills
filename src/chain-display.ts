/**
 * Chain display — how an emitted chain reaches the transcript as the text the
 * user actually typed.
 *
 * The emitted message is N `<skill …>` blocks joined by blank lines
 * (`src/expander.ts`). Left alone, the transcript would show the first block as
 * pi's collapsible skill card and blocks 2..N as raw XML. Two host facts decide
 * the design:
 *
 *  - `parseSkillBlock` (`core/agent-session.js:53-63`) is `^…$`-anchored. A
 *    message that does not start with a well-formed block takes the plain-text
 *    path (`interactive-mode.js:3193-3207`) and is rendered by
 *    `UserMessageComponent`.
 *  - Markdown transformers — the only display hook an extension has — run on
 *    that plain-text path only (`components/user-message.js:37`). The skill card
 *    runs none (`components/skill-invocation-message.js:9-37`).
 *
 * So a message that WOULD take the card path but is not a single bare skill gets
 * one leading `CHAIN_DISPLAY_MARKER`. That defeats the anchored parse, hands the
 * whole message to the transformer, and `renderSkillChain` rewrites every block
 * back into `/skill:<name> <args>` — the syntax the user typed.
 *
 * The marker is a single zero-width space, chosen because it is invisible, one
 * code unit, and NOT whitespace: `trim()` does not remove it (U+200B is
 * format-category, not `Zs`), so no host-side stripping can resurrect the card.
 * It changes what the host renders, never what the model reads.
 *
 * The single bare-skill message is deliberately left alone: pi's native card is
 * the byte-parity contract (`src/expander.ts`) and the interop surface with
 * `@juicesharp/rpiv-args`.
 *
 * Cost, recorded because it cannot be repaired from here: the HTML export
 * (`core/export-html/template.js:1208`) parses the same anchored way and runs no
 * transformers, so an exported chain shows its blocks as plain text.
 */

import { SKILL_BLOCK_PREFIX } from "./expander.js";

/**
 * Leading marker for a message that must bypass the skill card.
 *
 * Zero-width space: invisible in markdown, and outside the set `trim()` removes,
 * so neither pi's own rendering nor the host's text extraction can drop it and
 * send the message back down the card path.
 */
export const CHAIN_DISPLAY_MARKER = "\u200B";

/**
 * One emitted block, in the shape the host recognises (`parseSkillBlock`,
 * `agent-session.js:54`): the `<skill name="…" location="…">` header, a newline,
 * a lazy body, and a `</skill>` close on its own line.
 *
 * Anchoring on the host's shape — rather than on `src/expander.ts`'s template —
 * keeps one notion of "well-formed block" in the project, and the lazy body
 * mirrors the host's own regex. The `/g` flag is safe at module scope: `replace`
 * resets `lastIndex`, and `matchAll` clones the pattern instead of advancing it.
 */
export const SKILL_BLOCK_PATTERN =
	/<skill name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill>/g;

/** How many well-formed blocks `text` carries. */
function countSkillBlocks(text: string): number {
	return [...text.matchAll(SKILL_BLOCK_PATTERN)].length;
}

/**
 * Mark `text` so the host renders it as plain user markdown instead of a skill
 * card, when that is what the display needs.
 *
 * Two conditions, both necessary:
 *
 *  - The message STARTS with a block. Otherwise the anchored parse already fails
 *    and the transformer already sees everything — marking it would only put a
 *    stray character in a message the host was going to render as text anyway.
 *  - It carries more than one block. A single bare block is pi's native
 *    single-skill message, and that keeps its card.
 *
 * Idempotent, so a caller may apply it to text that already went through it.
 */
export function markChainForDisplay(text: string): string {
	if (text.startsWith(CHAIN_DISPLAY_MARKER)) return text;
	if (!text.startsWith(SKILL_BLOCK_PREFIX)) return text;
	if (countSkillBlocks(text) < 2) return text;
	return `${CHAIN_DISPLAY_MARKER}${text}`;
}

/**
 * Rewrite an emitted chain as the chain the user typed: every block becomes
 * `/skill:<name>`, followed by the text that belongs to it.
 *
 * The emitted layout is `preamble\n\n<block a>\n\nargs a\n\n<block b>\n\nargs b`
 * (blank-line separated, joined by `src/expander.ts`), so the text between one
 * block and the next IS that block's arguments, and `parseSkillChain` bound
 * exactly those arguments in the first place. Reconstructing them here makes the
 * transcript show `/skill:a args a /skill:b args b` — arguments in place, one
 * per token, in chain order.
 *
 * Text that is not part of a well-formed block is left verbatim: the preamble
 * stays in front, and a hand-typed `<skill …>` span that the host would not
 * recognise is untouched.
 */
export function renderSkillChain(markdown: string): string {
	const text = markdown.startsWith(CHAIN_DISPLAY_MARKER)
		? markdown.slice(CHAIN_DISPLAY_MARKER.length)
		: markdown;

	const blocks = [...text.matchAll(SKILL_BLOCK_PATTERN)];
	if (blocks.length === 0) return text;

	const parts: string[] = [];
	const preamble = text.slice(0, blocks[0].index).trim();
	if (preamble.length > 0) parts.push(preamble);

	for (const [i, block] of blocks.entries()) {
		const name = block[1];
		const argsStart = block.index + block[0].length;
		const argsEnd = i + 1 < blocks.length ? blocks[i + 1].index : text.length;
		const args = text.slice(argsStart, argsEnd).trim();
		parts.push(args.length > 0 ? `/skill:${name} ${args}` : `/skill:${name}`);
	}

	return parts.join(" ");
}
