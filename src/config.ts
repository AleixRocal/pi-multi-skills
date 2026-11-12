/**
 * Chain configuration — the one place a cap or a threshold is decided.
 *
 * Why a module and not a constant: the cap used to be `MAX_CHAINED_SKILLS`
 * (`src/parser.ts:38`), one number compiled into the parser. Making it
 * configurable separates "what the default is" (here) from "how a token list is
 * built" (`src/parser.ts`, still pure), and gives the two readers — the input
 * handler and the autocomplete wrapper — a single resolver instead of two
 * copies of the same comparison.
 *
 * Why a string flag: pi's `registerFlag` offers `"boolean"` and `"string"` and
 * no number (`core/extensions/types.d.ts:1280-1290`), so a numeric cap is a
 * string that this module parses. There is no per-extension settings namespace
 * to read instead — `SettingsSchema` is a closed object
 * (`core/settings-schema.d.ts:101-194`) — and `getSettings()` would answer with
 * the merge of every key pi itself defines, none of which is ours.
 *
 * Why a bad value is absorbed silently: a mistyped flag must not cost a
 * start-up. It is not invisible either — the cost notice names the effective
 * cap whenever it fires, so a value that fell back to the default shows up on
 * the first chain that overruns it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Default ceiling on chained skills — Claude Code's "the first skill plus up to
 * five more", and the value `MAX_CHAINED_SKILLS` has carried since the first
 * release. `--skill-chain-max` overrides it.
 */
export const DEFAULT_MAX_CHAINED_SKILLS = 6;

/** Name of the CLI flag, in one place so the declaration and the read cannot drift. */
export const MAX_CHAINED_SKILLS_FLAG = "skill-chain-max";

/**
 * Character count above which a chain's injected context is reported.
 *
 * `plan.md:141` records both the number a comparable fork uses and the intent to
 * warn above a threshold; 50_000 is that number. Deliberately not a flag: one
 * dial is enough, and this one is a heuristic whose right value nobody knows.
 */
export const COST_WARN_CHARS = 50_000;

/**
 * Whole-string integer test.
 *
 * `Number.parseInt` stops at the first non-digit, so `"1.5"` would resolve to a
 * cap of 1 and `"6skills"` to 6 — silently, and both wrong. Requiring the digit
 * run to be the entire string is what makes the fallback predictable.
 */
const INTEGER = /^\d+$/;

/** The effective cap: the flag when it is a positive integer, else the default. */
export function resolveMaxChainedSkills(pi: ExtensionAPI): number {
	const raw = pi.getFlag(MAX_CHAINED_SKILLS_FLAG);
	if (typeof raw !== "string" || !INTEGER.test(raw)) return DEFAULT_MAX_CHAINED_SKILLS;
	const max = Number.parseInt(raw, 10);
	return max >= 1 ? max : DEFAULT_MAX_CHAINED_SKILLS;
}
