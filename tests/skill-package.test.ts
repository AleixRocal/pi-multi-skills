import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The packaging contract for `skills/`.
 *
 * Every rule here fails *quietly* somewhere else, which is why it is a test
 * rather than a convention:
 *
 *  - A `name` that disagrees with its directory is refused by other Agent
 *    Skills implementations (`docs/skills.md:83` says pi tolerates it and the
 *    next host does not).
 *  - A `SKILL.md` without a `description`, or with malformed frontmatter, is
 *    never loaded at all (`docs/skills.md:85`) — the skill simply does not
 *    exist for the model.
 *  - A link to a page that `files` did not ship reads as a dangling reference
 *    to whoever follows it.
 *  - A `skills/` entry missing from package.json `files` keeps the skill in
 *    this repository and out of every install.
 *
 * Nothing here touches the host: it is a filesystem contract, so it stays a
 * plain unit test.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKILLS_DIR = join(ROOT, "skills");

/** Names are lowercase, hyphen-separated, at most 64 characters (`skills.md:81`). */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAME_MAX = 64;
/** `skills.md:81`. */
const DESCRIPTION_MAX = 1024;
/** The top tier stays legible; reference material belongs in `references/`. */
const SKILL_LINES_MAX = 100;

interface Skill {
	readonly dir: string;
	readonly name: string;
	readonly file: string;
	readonly body: string;
	readonly frontmatter: ReadonlyMap<string, string>;
}

/** Read the `key: value` scalars this contract depends on, and only those. */
function readFrontmatter(text: string): Map<string, string> {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
	expect(match, "SKILL.md must open with a frontmatter block").not.toBeNull();
	const fields = new Map<string, string>();
	for (const line of match![1].split("\n")) {
		const scalar = /^([a-z][a-z0-9-]*):\s*(.+)$/.exec(line);
		if (scalar) fields.set(scalar[1], scalar[2].trim());
	}
	return fields;
}

function readSkills(): Skill[] {
	return readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => {
			const dir = join(SKILLS_DIR, entry.name);
			const file = join(dir, "SKILL.md");
			const text = readFileSync(file, "utf-8");
			return {
				dir,
				name: entry.name,
				file,
				body: text.replace(/^---\n[\s\S]*?\n---\n/, ""),
				frontmatter: readFrontmatter(text),
			};
		});
}

const skills = readSkills();

describe("skills/ packaging", () => {
	it("ships at least one skill", () => {
		expect(skills.length).toBeGreaterThan(0);
	});

	for (const skill of skills) {
		describe(skill.name, () => {
			it("declares the directory name, in the portable shape", () => {
				// The name is what a chain resolves and what pi registers as
				// `/skill:<name>`; a mismatch loads under a name nobody typed.
				expect(skill.frontmatter.get("name")).toBe(skill.name);
				expect(skill.name).toMatch(NAME_PATTERN);
				expect(skill.name.length).toBeLessThanOrEqual(NAME_MAX);
			});

			it("carries a routing description the model can act on", () => {
				const description = skill.frontmatter.get("description") ?? "";
				expect(description.length).toBeGreaterThan(0);
				expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
				// A description without a trigger leaves the model no way to
				// know when the skill applies — the skill is loaded on demand.
				expect(description).toMatch(/use when/i);
			});

			it("keeps SKILL.md to the top tier", () => {
				const lines = skill.body.trimEnd().split("\n").length;
				expect(lines).toBeLessThanOrEqual(SKILL_LINES_MAX);
			});

			it("links only to files that live beside it", () => {
				for (const link of skill.body.matchAll(/\]\(([^)]+)\)/g)) {
					const target = link[1];
					if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
					const path = resolve(dirname(skill.file), target.split("#")[0]);
					expect(existsSync(path), `${skill.name} links to a missing ${target}`).toBe(true);
				}
			});
		});
	}
});

describe("package.json exposes them", () => {
	const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
		pi?: { skills?: string[] };
		files?: string[];
	};

	it("declares the skills directory in the pi manifest", () => {
		const declared = manifest.pi?.skills ?? [];
		expect(declared.length).toBeGreaterThan(0);
		for (const entry of declared) {
			expect(existsSync(resolve(ROOT, entry)), `${entry} does not exist`).toBe(true);
		}
		// Every skill must sit under a declared root, or pi never loads it.
		for (const skill of skills) {
			const declaredRoot = dirname(skill.dir);
			expect(
				declared.some((entry) => resolve(ROOT, entry) === declaredRoot),
				`${skill.name} is outside the declared skill roots`,
			).toBe(true);
		}
	});

	it("ships the skills directory in the publish tarball", () => {
		expect((manifest.files ?? []).some((entry) => entry.startsWith("skills/"))).toBe(true);
	});

	it("keeps the skill name human-readable in the directory listing", () => {
		for (const skill of skills) {
			expect(basename(skill.dir)).toBe(skill.name);
		}
	});
});
