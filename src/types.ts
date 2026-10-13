/**
 * Shared types for pi-multi-skills.
 *
 * A "chain" is a user message that names one or more skills with
 * `/skill:<name>` tokens, each optionally followed by the free text it owns.
 * Nothing here imports the pi SDK, so the parser and expander stay testable
 * without a host.
 */

/**
 * One resolvable skill, as published by `pi.getCommands()`.
 *
 * `filePath` is the canonical SKILL.md path (`sourceInfo.path`). `baseDir` is
 * `dirname(filePath)` and deliberately NOT `sourceInfo.baseDir`: for skills
 * contributed by an extension package, `sourceInfo.baseDir` is the *package*
 * root, and for CLI-supplied paths it is `undefined` entirely.
 */
export interface SkillEntry {
	/** Skill name without the `skill:` prefix, e.g. `design`. */
	readonly name: string;
	/** Canonical path to the skill's SKILL.md. */
	readonly filePath: string;
	/** Directory containing `filePath`; the base for relative references. */
	readonly baseDir: string;
}

/** Name → entry lookup, rebuilt once per session. */
export type SkillIndex = ReadonlyMap<string, SkillEntry>;

/**
 * One `/skill:<name>` occurrence found in a user message, together with the
 * free text that belongs to it.
 *
 * Offsets are indices into the original message, so a consumer can rebuild the
 * message exactly (and leave unrecognised tokens verbatim in place).
 */
export interface SkillToken {
	/** Skill name as written, without the `/skill:` prefix. */
	readonly name: string;
	/** Offset of the leading `/` of `/skill:`. */
	readonly start: number;
	/** Offset just past the name (the first whitespace, or end of message). */
	readonly end: number;
	/** Free text between `end` and the next token, trimmed; `""` when none. */
	readonly args: string;
}

/** Result of scanning a message for chainable skill tokens. */
export interface SkillChain {
	/** Text before the first `/skill:` token, trimmed; `""` when none. */
	readonly preamble: string;
	/** Every detected token, in message order. */
	readonly tokens: readonly SkillToken[];
}
