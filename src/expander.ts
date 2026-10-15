/**
 * Byte-exact skill-block emitter.
 *
 * Reproduces Pi's native `_expandSkillCommand` output character for character
 * (`dist/core/agent-session.js:1708-1710`): the `<skill …>` header, the
 * relative-references pointer line, the body, and the closing tag — with
 * `body = stripFrontmatter(content).trim()` and the native suffix rule
 * `args ? `${block}\n\n${args}` : block`.
 *
 * Two contracts ride on that byte-exactness, and the host documents neither:
 *
 *  - `parseSkillBlock` (`agent-session.js:53-63`) matches the emitted text with
 *    a `^…$`-anchored regex whose body group is lazy and whose optional
 *    trailing group must be separated by EXACTLY `\n\n`. One character of drift
 *    — or a trailing newline — silently demotes the message to raw text and the
 *    interactive skill card never renders.
 *  - `@juicesharp/rpiv-args` emits the same template (`args.ts:367-373`, with
 *    the byte-exactness note at `args.ts:150-158`), so the two extensions stay
 *    interchangeable in either handler order.
 *
 * `expandSkillTokens` is the single token→block rewrite shared by the clean path
 * and the rescue path, which is why it scans whatever text it is handed instead
 * of assuming the message starts with a token: it replaces every token it can
 * resolve and leaves every token it cannot resolve verbatim in place, so one
 * unknown skill never costs the caller the rest of the chain. It returns `null`
 * when nothing was expanded, which is the handler's signal to step aside and
 * let Pi's own expansion run.
 */

import { readFileSync } from "node:fs";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseSkillChain } from "./parser.js";
import type { SkillEntry, SkillIndex, SkillToken } from "./types.js";

/**
 * Re-entrancy marker: text that already carries an emitted block starts with
 * this. Byte-identical to `@juicesharp/rpiv-args` (`args.ts:71`, applied at
 * `:409`), so the two extensions recognise each other's output.
 */
export const SKILL_BLOCK_PREFIX = "<skill ";

/**
 * Blocks are joined by exactly this separator: `parseSkillBlock` requires
 * `\n\n` before its trailing user-message group, and joining never appends a
 * trailing newline (which would break the regex's `$` anchor).
 */
const BLOCK_SEPARATOR = "\n\n";

/**
 * Render the emitted wrapper for one skill.
 *
 * Byte-exact against `agent-session.js:1709` — do not reformat this template
 * literal, and never append a trailing newline.
 */
export function buildSkillBlock(entry: SkillEntry, body: string): string {
	return `<skill name="${entry.name}" location="${entry.filePath}">\nReferences are relative to ${entry.baseDir}.\n\n${body}\n</skill>`;
}

/**
 * Native trailing-argument rule (`agent-session.js:1710`). No labeled trailer:
 * that is `rpiv-args`' own token-path convention (`args.ts:381,388-390`), and
 * adding it here would break N=1 byte-parity with native Pi.
 */
export function appendArgs(skillBlock: string, args: string): string {
	return args ? `${skillBlock}\n\n${args}` : skillBlock;
}

/**
 * One token → one emitted block, or `null` when the token cannot be served.
 *
 * The SKILL.md is read on every call — matching Pi (`agent-session.js:1707`)
 * and `rpiv-args` — so a skill edited mid-session is picked up on the next
 * message and no body is cached between messages. A missing or unreadable file
 * is not an error: the token falls back to verbatim text and the rest of the
 * chain still expands.
 */
function renderSkillToken(token: SkillToken, index: SkillIndex): string | null {
	const entry = index.get(token.name);
	if (entry === undefined) return null;

	let content: string;
	try {
		content = readFileSync(entry.filePath, "utf-8");
	} catch {
		return null;
	}

	const body = stripFrontmatter(content).trim();
	return appendArgs(buildSkillBlock(entry, body), token.args);
}

/**
 * Replace every resolvable `/skill:<name>` token in `text` with its block.
 *
 * Text that belongs to no resolvable token — the preamble, and the original
 * span of any token whose name is unknown or whose file cannot be read — stays
 * verbatim, so user text is never deleted. Returns `null` when the text carries
 * no token at all, or when none of the tokens resolved: both mean the handler
 * should let Pi's native expansion handle the message.
 *
 * Scanning is deliberately unscoped. `parseSkillChain` looks for markers only
 * inside the message it is handed, so a caller that must protect an
 * already-emitted block (the rescue path) passes the residual text after the
 * last `</skill>` rather than the whole message.
 */
export function expandSkillTokens(text: string, index: SkillIndex): string | null {
	const chain = parseSkillChain(text);
	if (chain.tokens.length === 0) return null;

	const parts: string[] = [];
	if (chain.preamble.length > 0) parts.push(chain.preamble);

	let expandedTokens = 0;
	for (let i = 0; i < chain.tokens.length; i++) {
		const token = chain.tokens[i];
		const block = renderSkillToken(token, index);
		if (block === null) {
			// Guard 3: leave the original span of the unresolvable token in
			// place — `/skill:<name>` plus the text it bound — so the user's
			// message survives the failed resolution untouched.
			const spanEnd = i + 1 < chain.tokens.length ? chain.tokens[i + 1].start : text.length;
			parts.push(text.slice(token.start, spanEnd).trim());
			continue;
		}
		expandedTokens++;
		parts.push(block);
	}

	if (expandedTokens === 0) return null;
	return parts.join(BLOCK_SEPARATOR);
}
