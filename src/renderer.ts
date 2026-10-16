/**
 * Skill-chain renderer — rewrites an emitted chain in the transcript as the
 * chain the user typed (`/skill:a x /skill:b y`).
 *
 * Why a markdown transformer and not a message renderer: transformers are the
 * only display hook an extension has, and they run on the plain-text path only
 * — `interactive-mode.js:3195-3209` sends a message whose text starts with a
 * well-formed block to the collapsible skill card, which runs no transformers
 * (`components/skill-invocation-message.js:9-37`). Blocks that do reach a
 * `UserMessageComponent` are rewritten there (`components/user-message.js:37`).
 *
 * `src/chain-display.ts` owns the whole shape of that contract: the marker that
 * keeps a chain off the card path, and the reconstruction of `/skill:<name>`
 * plus its arguments. This module is the registration and the gating around it.
 *
 * The transformer is display-only. It rewrites the markdown the TUI renders,
 * never the session message, so the model still receives the full `<skill …>`
 * blocks the input handler emitted.
 */

import type { ExtensionAPI, MarkdownTransformer } from "@earendil-works/pi-coding-agent";
import { renderSkillChain } from "./chain-display.js";
import { SKILL_BLOCK_PREFIX } from "./expander.js";

/**
 * The transformer. User-message markdown only, and only when it still carries a
 * block to rewrite.
 */
export const skillChainTransformer: MarkdownTransformer = (markdown, context) => {
	// Transformers run for assistant markdown too — the completed and streaming
	// assistant components are wired with the same list
	// (`components/assistant-message.js:86,118`) — but an emitted block is only
	// ever part of a USER message, so this gate is what keeps the transformer off
	// model output.
	if (context.messageType !== "user") return markdown;

	// Cheap early return before any regex work: this runs on every USER message
	// render in the session, so the substring test is what keeps the transformer
	// out of the hot path.
	if (!markdown.includes(SKILL_BLOCK_PREFIX)) return markdown;

	return renderSkillChain(markdown);
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
