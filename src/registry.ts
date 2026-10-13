/**
 * Skill registry — the name → path index the expander resolves against.
 *
 * The index is built from `pi.getCommands()`, which is authoritative: by the
 * time an extension sees it, pi has already run skill discovery, trust checks,
 * package filtering, frontmatter validation and name-collision resolution.
 * Walking the filesystem here would duplicate all of that and could disagree
 * with what `/skill:<name>` actually resolves to.
 *
 * Modelled on @juicesharp/rpiv-args (args.ts:313-338).
 */

import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SkillEntry, SkillIndex } from "./types.js";

/** pi publishes skill-sourced commands as `skill:<name>` (agent-session.js:2726-2732). */
const SKILL_COMMAND_PREFIX = "skill:";

let skillIndex: SkillIndex | null = null;

/** Drop the cache so the next `getSkillIndex` rebuilds from `pi.getCommands()`. */
export function invalidateSkillIndex(): void {
	skillIndex = null;
}

/** Build a fresh name → entry index from the live command registry. */
export function buildSkillIndex(pi: ExtensionAPI): SkillIndex {
	const index = new Map<string, SkillEntry>();
	for (const command of pi.getCommands()) {
		if (command.source !== "skill") continue;
		const name = command.name.startsWith(SKILL_COMMAND_PREFIX)
			? command.name.slice(SKILL_COMMAND_PREFIX.length)
			: command.name;
		const filePath = command.sourceInfo.path;
		if (!filePath || name.length === 0) continue;
		index.set(name, { name, filePath, baseDir: dirname(filePath) });
	}
	return index;
}

/**
 * The session's skill index, built on first use and reused until
 * `invalidateSkillIndex()` is called.
 */
export function getSkillIndex(pi: ExtensionAPI): SkillIndex {
	if (skillIndex === null) skillIndex = buildSkillIndex(pi);
	return skillIndex;
}
