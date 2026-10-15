#!/usr/bin/env node
/**
 * Tarball contract check — what `npm publish` would actually ship.
 *
 * `npm pack --dry-run` is the only check that reads the real `files` globs in
 * package.json, so it is the only place a packaging mistake (a missing source
 * file the entry point imports, or a test file riding along) can be caught
 * before it reaches the registry. `npm publish` is not undoable, so this runs
 * in CI on every pull request and again in the release job.
 *
 * Exit code is the contract: 0 = the tarball is publishable.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/** Always in the tarball. */
const REQUIRED = [
	"package.json",
	"README.md",
	"CHANGELOG.md",
	"LICENSE",
	"extensions/index.ts",
];

/** Never in the tarball: tests, CI, tooling, local state. */
const FORBIDDEN_PREFIXES = ["tests/", "scripts/", ".github/", ".pi/", ".rpiv/"];
const FORBIDDEN_SUFFIXES = [".test.ts", ".tsbuildinfo"];

/**
 * Every source file the extension can reach at runtime must ship — the
 * transitive closure of the entry point's relative imports, not just its direct
 * ones (`src/types.ts` is only imported by other modules, and would otherwise
 * be excludable from the tarball without this check noticing).
 */
function requiredSources() {
	const entry = "extensions/index.ts";
	const seen = new Set();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.shift();
		if (seen.has(file) || !existsSync(file)) continue;
		seen.add(file);
		for (const match of readFileSync(file, "utf8").matchAll(/from\s+"([^"]+)"/g)) {
			const specifier = match[1];
			if (!specifier.startsWith(".")) continue;
			const resolved = normalize(join(dirname(file), specifier)).replace(/\.js$/, ".ts");
			if (!seen.has(resolved)) queue.push(resolved);
		}
	}
	return [...seen].sort();
}

let pack;
try {
	const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
		encoding: "utf8",
		// npm writes its notices to stderr; stdout stays parseable JSON.
		stdio: ["ignore", "pipe", "inherit"],
	});
	// npm 10 emits an array of one entry, npm 11 an object keyed by package
	// name, and a wrapper can prefix the output with notice lines. Accept all
	// three shapes rather than pinning the check to one npm version.
	const parsed = JSON.parse(raw.slice(raw.search(/[[{]/)));
	pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];} catch (error) {
	console.error(`pack check failed: ${error.message}`);
	process.exit(1);
}

const paths = pack.files.map((file) => file.path);

const missing = [...REQUIRED, ...requiredSources()].filter((path) => !paths.includes(path));
const forbidden = paths.filter(
	(path) =>
		FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
		FORBIDDEN_SUFFIXES.some((suffix) => path.endsWith(suffix)),
);

if (missing.length > 0 || forbidden.length > 0) {
	console.error("pack check failed");
	if (missing.length > 0) console.error(`  missing from tarball: ${missing.join(", ")}`);
	if (forbidden.length > 0) console.error(`  must not ship: ${forbidden.join(", ")}`);
	process.exit(1);
}

console.log(
	`pack check ok: ${paths.length} files, ${pack.size} bytes packed, ` +
		`${pack.unpackedSize} bytes unpacked`,
);
