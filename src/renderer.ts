/**
 * Skill-chain renderer — rewrites an emitted chain in the transcript as the
 * chain the user typed (`/skill:a x /skill:b y`).
 *
 * Why a markdown transformer and not a message renderer: transformers are the
 * only display hook an extension has. A message whose text starts with a
 * well-formed block takes the collapsible skill card (`interactive-mode.js:3303-3317`),
 * and the card transforms only the skill BODY as `"custom"` Markdown after
 * prepending a header of its own (`components/skill-invocation-message.js:45-48`)
 * — it never sees the `<skill …>` line, so it cannot rebuild a chain. User
 * message Markdown is transformed on the plain path
 * (`components/user-message.js:41`), which is where a marked chain lands.
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
	// The host also transforms assistant and thinking Markdown
	// (`components/assistant-message.js:110,142`), and the skill card transforms
	// its body as `"custom"` (`components/skill-invocation-message.js:45-48`). An
	// emitted block is only ever part of a USER message, so this gate is what
	// keeps the transformer off every other surface — including on a host that
	// predates the `messageTypes` registration option below.
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
 * it does not append (`dist/core/extensions/loader.js:286-291`) — and
 * aggregates across extensions (`dist/core/extensions/runner.js:539-548`), so
 * one registration is exactly one transformer. Registration is unconditional:
 * the host applies transformers only from the interactive transcript
 * (`components/user-message.js:41`), so this is inert under `--print` and RPC.
 *
 * `messageTypes: ["user"]` names the only surface that can carry a chain, so the
 * host filters the other surfaces before calling us (`dist/core/extensions/loader.js:286-291`).
 * The runtime gate in `skillChainTransformer` stays: an older host ignores the
 * option, and skipping the call is a performance win, not the correctness rule.
 */
export function registerSkillChainRenderer(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer(skillChainTransformer, { messageTypes: ["user"] });
}
