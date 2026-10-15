#!/usr/bin/env node
/**
 * Skill archive — the upload artifact for a skill marketplace.
 *
 * Agensi takes a zip containing a valid `SKILL.md` (`agensi.io/terms` §6.2) and
 * validates that the frontmatter `name` matches the parent folder, so the
 * archive keeps `<name>/` at its root. Regenerating it here rather than zipping
 * by hand is what keeps the listing from drifting from the repository: the zip
 * is a build output, not a copy someone remembers to refresh.
 *
 * Usage: npm run skill:zip [-- <skill-name>]
 *
 * Needs the `zip` binary. Like `demo:video` needing Chromium and ffmpeg, it
 * says so and exits rather than producing a half-archive.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKILLS_DIR = join(ROOT, "skills");
const OUT_DIR = join(ROOT, "dist");

/** The frontmatter `name`, which must equal the directory name. */
function declaredName(skillFile) {
	const match = /^---\n[\s\S]*?^name:\s*(.+)$/m.exec(readFileSync(skillFile, "utf-8"));
	return match?.[1].trim();
}

function skillNames() {
	return readdirSync(SKILLS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
		.map((entry) => entry.name)
		.sort();
}

function main() {
	if (!existsSync(SKILLS_DIR)) {
		console.error(`no skills directory at ${SKILLS_DIR}`);
		process.exit(1);
	}

	const available = skillNames();
	const requested = process.argv[2];
	if (requested && !available.includes(requested)) {
		console.error(`no skill named "${requested}" — available: ${available.join(", ")}`);
		process.exit(1);
	}
	const name = requested ?? available[0];
	if (!name) {
		console.error("no skills to package");
		process.exit(1);
	}

	// The marketplace refuses a submission whose name disagrees with its folder,
	// so the archive is not worth building until that holds.
	const declared = declaredName(join(SKILLS_DIR, name, "SKILL.md"));
	if (declared !== name) {
		console.error(`skills/${name}/SKILL.md declares name: ${declared ?? "(none)"} — must match`);
		process.exit(1);
	}

	mkdirSync(OUT_DIR, { recursive: true });
	const archive = join(OUT_DIR, `${name}.zip`);
	try {
		// -X strips uid/gid and extended attributes: the archive carries the
		// skill, not the machine it happened to be built on. -D drops the
		// directory entries, which the extractor recreates anyway.
		execFileSync("zip", ["-X", "-D", "-q", "-r", archive, name], {
			cwd: SKILLS_DIR,
			stdio: ["ignore", "inherit", "inherit"],
		});
	} catch (error) {
		if (error.code === "ENOENT") {
			console.error("skill:zip needs the `zip` binary (apt install zip / brew install zip)");
			process.exit(1);
		}
		console.error(`skill:zip failed: ${error.message}`);
		process.exit(1);
	}

	const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
	console.log(`wrote dist/${name}.zip — ${entries.length} files:`);
	for (const entry of entries) console.log(`  ${entry}`);
	console.log(`\ndist/ is gitignored — upload this file as-is, it is not part of the tarball`);
}

main();
