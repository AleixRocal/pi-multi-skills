/**
 * pi-multi-skills — Pi extension entry point.
 *
 * Registers the `input` handler that rewrites `/skill:a /skill:b args` chains
 * into N sibling `<skill …>` blocks, the `session_start` invalidator for the
 * name → path index, the read-only `skills` listing tool, and the markdown
 * transformer that collapses blocks 2..N in the transcript.
 *
 * Shape follows @juicesharp/rpiv-args: a thin default export delegating to a
 * `registerX(pi)` helper (`rpiv-args/index.ts:12-14` + `args.ts:477-486`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleInput } from "../src/input-handler.js";
import { invalidateSkillIndex } from "../src/registry.js";
import { registerSkillChainRenderer } from "../src/renderer.js";
import { registerSkillsTool } from "../src/skills-tool.js";

/**
 * Register every surface this extension contributes.
 *
 * `pi` is threaded into the handler rather than captured as module state, so the
 * extension owns no new singleton besides the registry cache — the same reason
 * `rpiv-args` threads it (`args.ts:392-395`).
 */
export function registerMultiSkills(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => handleInput(event, ctx, pi));
	pi.on("session_start", (event) => {
		// The skill set is re-enumerated per session; `startup` and `reload` are
		// the two reasons that can change it (`SessionStartEvent.reason`).
		if (event.reason === "startup" || event.reason === "reload") {
			invalidateSkillIndex();
		}
	});
	// Decision 7: read-only discovery, so a chain is never built from a guessed
	// skill name.
	registerSkillsTool(pi);
	// Decision 8: blocks 2..N are collapsed in the transcript, so a chain reads
	// as N references instead of raw XML.
	registerSkillChainRenderer(pi);
}

export default function (pi: ExtensionAPI): void {
	registerMultiSkills(pi);
}
