/**
 * Skill-chain renderer — collapses the extra blocks of a chained message into
 * compact one-line references in the interactive transcript.
 *
 * Why a markdown transformer and not a message renderer: `parseSkillBlock`
 * (`agent-session.js:53-63`) consumes only the FIRST block of a message. The
 * transcript renders that one as a collapsible skill card and hands the
 * remainder — blocks 2..N plus any trailing argument text — to a
 * `UserMessageComponent` (`interactive-mode.js:3193-3207`), whose markdown is a
 * surface registered transformers run on (`components/user-message.js:37`; the
 * skill card runs none, `components/skill-invocation-message.js:9-37`). So a
 * transformer sees exactly the text blocks 2..N live in.
 *
 * Block 1 is deliberately left alone: it already gets a native skill card, and
 * collapsing it would mean the text stopped looking like a skill block — the
 * byte-parity contract `src/expander.ts` exists to keep.
 *
 * One extra case does land here. A message with prose before its first token
 * (`please /skill:design now`) is emitted as `please\n\n<skill …>`, which the
 * `^…$`-anchored `parseSkillBlock` rejects, so the WHOLE message reaches
 * `UserMessageComponent` and this transformer collapses its block too — the
 * readable outcome for text the host would otherwise show as raw XML.
 *
 * The transformer is display-only. It rewrites the markdown the TUI renders,
 * never the session message, so the model still receives the full `<skill …>`
 * blocks the input handler emitted.
 */

import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { SKILL_BLOCK_PREFIX } from "./expander.js";

/**
 * One emitted block, in the shape the host recognises (`parseSkillBlock`,
 * `agent-session.js:54`): the `<skill name="…" location="…">` header, a
 * newline, a lazy body, and a `</skill>` close on its own line.
 *
 * Anchoring on the host's shape — rather than on `src/expander.ts`'s template —
 * keeps one notion of "well-formed block" in the project, and the lazy body
 * mirrors the host's own regex. The `/g` flag is safe at module scope because
 * `String.prototype.replace` resets `lastIndex`; the pattern is never used with
 * `exec`/`test`.
 */
const SKILL_BLOCK_PATTERN = /<skill name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill>/g;

/**
 * Reference that replaces one collapsed block: the `[skill]` vocabulary the
 * host's own card uses (`components/skill-invocation-message.js:35,44`), plus
 * the canonical path so the block stays traceable.
 */
function renderSkillReference(name: string, location: string): string {
	return `> **[skill] ${name}** — \`${location}\``;
}

/**
 * Collapse every well-formed block in `markdown` to its one-line reference.
 *
 * Surrounding text — trailing argument text, prose — is left untouched, so a
 * chain keeps its per-skill arguments in the transcript.
 */
export function collapseSkillBlocks(markdown: string): string {
	return markdown.replace(SKILL_BLOCK_PATTERN, (_match, name: string, location: string) =>
		renderSkillReference(name, location),
	);
}

/**
 * The transformer. User-message markdown only, and only when it still carries a
 * block to collapse.
 */
export const skillChainTransformer: MarkdownTransformer = (markdown, context) => {
	// Transformers run for assistant markdown too — the completed and streaming
	// assistant components are wired with the same list
	// (`components/assistant-message.js:86,118`) — but an emitted block is only
	// ever part of a USER message, so this gate is what keeps the transformer off
	// model output.
	if (context.messageType !== "user") return markdown;

	// Cheap early return before any regex work: this runs on every user-message
	// render (`## Performance Considerations`).
	if (markdown.indexOf(SKILL_BLOCK_PREFIX) === -1) return markdown;

	return collapseSkillBlocks(markdown);
};

/**
 * Register the transformer on `pi`.
 *
 * Called once from `registerMultiSkills` (`extensions/index.ts`). Pi keeps at
 * most ONE transformer per extension — `registerMarkdownTransformer` assigns,
 * it does not append (`dist/core/extensions/loader.js:280-283`) — and
 * aggregates across extensions (`dist/core/extensions/runner.js:538-540`), so
 * one registration is exactly one transformer. Registration is unconditional:
 * the host applies transformers only from the interactive transcript
 * (`components/user-message.js:37`), so this is inert under `--print` and RPC.
 */
export function registerSkillChainRenderer(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer(skillChainTransformer);
}
