/**
 * pi-multi-skills — Pi extension entry point.
 *
 * Registers the `input` handler that rewrites `/skill:a /skill:b args` chains
 * into N sibling `<skill …>` blocks, the `session_start` invalidator for the
 * name → path index, the chain autocomplete wrapper for the `/skill:` menu past
 * the first token, the read-only `skills` listing tool, and the markdown
 * transformer that collapses blocks 2..N in the transcript.
 *
 * Shape follows @juicesharp/rpiv-args: a thin default export delegating to a
 * `registerX(pi)` helper (`rpiv-args/index.ts:12-14` + `args.ts:477-486`).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChainAutocomplete } from "../src/autocomplete.js";
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
	pi.on("session_start", (event, ctx) => {
		// The skill set is re-enumerated on the two reasons that can change it
		// (`SessionStartEvent.reason`): a fresh process, or a reload that
		// re-reads settings and packages.
		if (event.reason === "startup" || event.reason === "reload") {
			invalidateSkillIndex();
		}
		// Every reason needs the wrapper back, including "new"/"resume"/"fork":
		// the interactive host clears every registered wrapper before it swaps
		// sessions (`interactive-mode.js:363-365` → `resetExtensionUI`).
		registerChainAutocomplete(ctx, pi);
	});
	// Read-only discovery, so a chain is never built from a guessed skill name.
	registerSkillsTool(pi);
	// Blocks 2..N collapse in the transcript, so a chain reads as N references
	// instead of raw XML.
	registerSkillChainRenderer(pi);
}

export default function (pi: ExtensionAPI): void {
	registerMultiSkills(pi);
}
