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

/** Name -> entry lookup, rebuilt once per session. */
export type SkillIndex = ReadonlyMap<string, SkillEntry>;

/**
 * A `/skill:` occurrence before argument binding: the name and the offsets that
 * delimit it.
 *
 * Kept separate from `SkillToken` because a marker the cap did not admit has no
 * arguments to bind — it is only *reported*, so a caller can say which skill did
 * not run instead of silently dropping it.
 */
export interface TokenStart {
	/** Skill name as written, without the `/skill:` prefix. */
	readonly name: string;
	/** Offset of the leading `/` of `/skill:`. */
	readonly start: number;
	/** Offset just past the name (the first whitespace, or end of message). */
	readonly end: number;
}

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
	/**
	 * Markers the cap did not admit, in message order.
	 *
	 * Never bound: their text stays inside the last admitted token's arguments,
	 * so an overrun degrades into text the model can still read rather than
	 * input that disappears. Reported so a caller can name what did not run.
	 */
	readonly overflow: readonly TokenStart[];
}

/**
 * What one `expandSkillTokens` call actually did, alongside the text it emitted.
 *
 * This is the plan the input handler decides from — how many skills a chain
 * really expanded, which names failed, which overran the cap. Every one of those
 * facts used to be recovered by re-parsing the emitted text, which is what made
 * a two-token chain render as a single-skill card.
 */
export interface SkillExpansion {
	/** The text to hand back to pi: blocks and verbatim spans, as before. */
	readonly text: string;
	/** Names emitted as a block, in first-occurrence order. */
	readonly expanded: readonly string[];
	/** Names left verbatim because they resolved to nothing. */
	readonly unresolved: readonly string[];
	/** Names past the cap, left as argument text. */
	readonly overflow: readonly string[];
	/** Names collapsed into an earlier block of the same name. */
	readonly duplicated: readonly string[];
	/** `text.length` — the context cost of this expansion. */
	readonly chars: number;
}
