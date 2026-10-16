/**
 * Read-only `skills` listing tool.
 *
 * Gives the model a way to discover, mid-turn, which skills it can chain: the
 * `/skill:a /skill:b` syntax is only useful if `a` and `b` are known to exist.
 *
 * The tool lists and never invokes. Pi's skill expansion runs on user input only
 * — `_expandSkillCommand` has exactly two call-sites (`agent-session.js:1632`
 * and `:1729`) and neither touches a tool result — so a tool cannot cause a hard
 * skill invocation. Reporting the canonical SKILL.md path lets the model follow
 * up with the built-in `read` tool instead.
 *
 * The surface is deliberately small: `exposure: "direct"`, TypeBox `parameters`
 * of `{ query?: string; limit?: number }`, and a result of
 * `{ name, description, location }[]` — enough for the model to decide what to
 * read, and no more surface to keep honest.
 *
 * Names and locations come from the registry the expander itself resolves
 * against (`src/registry.ts`), so the tool can never advertise a skill the
 * expander would miss, nor hide one it would find. Descriptions are not part of
 * a registry entry (name, filePath and baseDir — `src/types.ts`), so they are
 * read from `pi.getCommands()` and joined on `sourceInfo.path` — the same value
 * the registry stores as `filePath`, which keeps the `skill:` name-prefix rule
 * owned by one module.
 */

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getSkillIndex } from "./registry.js";
import type { SkillIndex } from "./types.js";

/** Tool name the model calls. */
const TOOL_NAME = "skills";

/** Page size when `limit` is omitted. */
const DEFAULT_LIMIT = 20;

/** Hard ceiling on `limit`; the model narrows `query` to page past it. */
const MAX_LIMIT = 100;

/** One skill as the tool reports it. */
export interface SkillListing {
	/** Skill name without the `skill:` prefix, e.g. `design`. */
	readonly name: string;
	/** Description from the skill's frontmatter; `""` when it declares none. */
	readonly description: string;
	/** Canonical SKILL.md path — readable with the built-in `read` tool. */
	readonly location: string;
}

/** Structured tool details: the returned page plus the truncation facts. */
export interface SkillsToolDetails {
	/** The returned page, sorted by name. */
	readonly skills: readonly SkillListing[];
	/** Skills matching `query`, before `limit` was applied. */
	readonly total: number;
	/** True when more skills matched than the page carries. */
	readonly truncated: boolean;
}

/**
 * Description per canonical SKILL.md path, from the live command registry.
 *
 * Keyed by path rather than by name so that joining needs no second copy of the
 * `skill:` name-prefix rule: `sourceInfo.path` is exactly the value
 * `src/registry.ts` stores as `SkillEntry.filePath`.
 */
function descriptionByPath(pi: ExtensionAPI): Map<string, string> {
	const descriptions = new Map<string, string>();
	for (const command of pi.getCommands()) {
		if (command.source !== "skill") continue;
		descriptions.set(command.sourceInfo.path, command.description ?? "");
	}
	return descriptions;
}

/** Case-insensitive match against a skill's name or its description. */
function matchesQuery(listing: SkillListing, needle: string): boolean {
	if (needle.length === 0) return true;
	return (
		listing.name.toLowerCase().includes(needle) ||
		listing.description.toLowerCase().includes(needle)
	);
}

/** Every indexed skill, sorted by name, paired with its description. */
function listSkills(index: SkillIndex, descriptions: ReadonlyMap<string, string>): SkillListing[] {
	const listings: SkillListing[] = [];
	for (const entry of index.values()) {
		listings.push({
			name: entry.name,
			description: descriptions.get(entry.filePath) ?? "",
			location: entry.filePath,
		});
	}
	// Plain code-unit ordering, not `localeCompare`: the result must not depend
	// on the host's ICU locale.
	listings.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	return listings;
}

/** Model-facing text for a page that carries no skill. */
function emptyPageText(needle: string): string {
	return needle.length === 0
		? "No skills are available in this session."
		: `No skill matches "${needle}". Call skills without a query to list every skill.`;
}

/**
 * Register the read-only `skills` tool on `pi`.
 *
 * Called once from `registerMultiSkills` (`extensions/index.ts`). `execute`
 * closes over `pi` because every call reads the live registry (`getSkillIndex`)
 * and the live descriptors (`pi.getCommands()`); the registry cache is what
 * bounds that, and it is invalidated on `session_start`.
 */
export function registerSkillsTool(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: TOOL_NAME,
			label: "Skills",
			description: `List the skills available in this session, with the canonical SKILL.md path for each.

Several skills can be invoked in one message by naming them in order:
\`/skill:research /skill:design refactor auth\`. Each \`/skill:<name>\` token of the chain owns
the text that follows it up to the next token, and a chain carries at most 6 skills. This tool
reports which names exist, so a chain is never built from a guessed name.

The tool only lists; it never invokes a skill. Read the skill's SKILL.md at \`location\` to see
its full instructions.`,
			promptSnippet:
				"List the skills available in this session and their SKILL.md paths before chaining `/skill:<name>` invocations.",
			// Read-only discovery. `direct` keeps the tool declared to
			// the model while active, and the host activates it on registration
			// (`docs/extensions.md:165`).
			exposure: "direct",
			// The tool only reads. Declared as an MCP annotation so a permission
			// extension can auto-allow it (`docs/extensions.md:167`).
			annotations: { readOnlyHint: true },
			parameters: Type.Object({
				query: Type.Optional(
					Type.String({
						description:
							"Case-insensitive substring matched against skill names and descriptions. Omit to list every skill.",
					}),
				),
				limit: Type.Optional(
					Type.Integer({
						minimum: 1,
						maximum: MAX_LIMIT,
						description: `Maximum number of skills to return (default ${DEFAULT_LIMIT}).`,
					}),
				),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
				// `limit` is schema-validated, but clamp anyway so a direct caller
				// that bypasses validation cannot ask for an unbounded page.
				const requested = params.limit ?? DEFAULT_LIMIT;
				const limit = Number.isFinite(requested)
					? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
					: DEFAULT_LIMIT;
				const needle = (params.query ?? "").trim().toLowerCase();

				const matched = listSkills(getSkillIndex(pi), descriptionByPath(pi)).filter((listing) =>
					matchesQuery(listing, needle),
				);
				const skills = matched.slice(0, limit);
				const details: SkillsToolDetails = {
					skills,
					total: matched.length,
					truncated: matched.length > skills.length,
				};

				const text =
					skills.length === 0
						? emptyPageText(needle)
						: JSON.stringify(skills, null, 2) +
							(details.truncated
								? `\n\nShowing ${skills.length} of ${details.total} skills — narrow \`query\` to see the rest.`
								: "");

				return { content: [{ type: "text", text }], details };
			},
		}),
	);
}
