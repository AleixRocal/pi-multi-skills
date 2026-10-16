#!/usr/bin/env node
/**
 * Tarball contract check — what `npm publish` would actually ship.
 *
 * `npm pack --dry-run` is the only check that reads the real `files` globs in
 * package.json, so it is the only place a packaging mistake (a missing source
 * file the entry point imports, a skill reference file left out of `files`, or
 * a test file riding along) can be caught
 * before it reaches the registry. `npm publish` is not undoable, so this runs
 * in CI on every pull request and again in the release job.
 *
 * It also checks the `pi` manifest, because that manifest is the only source of
 * resources a package has: with a `pi` block the host reads the manifest entries
 * and returns before it ever looks at the conventional directories
 * (`dist/core/package-manager.js:1865-1871`), and a manifest path that is not in
 * the tarball resolves to nothing, with no error and no resource.
 *
 * Exit code is the contract: 0 = the tarball is publishable.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * The packages the host supplies to extensions and skills. A physical copy in
 * `dependencies` bypasses pi's extension module mapping and creates duplicate
 * classes and registries; pi warns about exactly this list at load time
 * (`dist/core/resource-loader.js:18-29` holds the set, `:50-53` builds the
 * warning), so the check has to hold it too.
 */
const HOST_PROVIDED_PACKAGES = new Set([
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@mariozechner/pi-agent-core",
	"@mariozechner/pi-ai",
	"@mariozechner/pi-coding-agent",
	"@mariozechner/pi-tui",
	"@sinclair/typebox",
	"typebox",
]);

/**
 * The `pi` keys the host reads, spelled as the host spells them
 * (`dist/core/pi-manifest.js:3`). Every other key is ignored, and a resource
 * field that is not an array of strings is dropped (`:16-18`) — a misspelt key
 * or a scalar `pi.skills` ships a package that exposes nothing and says nothing.
 */
const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"];

/** What each resource is made of: a resource root that ships none of it is empty. */
const RESOURCE_FILE = {
	extensions: /\.(ts|js)$/,
	skills: /(^|\/)SKILL\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

/** `dist/core/package-manager.js:135-137`. */
const isOverridePattern = (entry) =>
	entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-");

/** `dist/core/package-manager.js:138-140`. */
const hasGlobPattern = (entry) => entry.includes("*") || entry.includes("?");

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

/**
 * Skills ship whole. `files` exposes the directory rather than its contents, so
 * a skill whose `references/` page is missing reaches the model with a dangling
 * link — worse than a skill that never loaded, because the failure is silent.
 * Walk every skill directory and require each file in it.
 */
function requiredSkills() {
	if (!existsSync("skills")) return [];
	const found = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else found.push(path);
		}
	};
	walk("skills");
	return found.sort();
}

/**
 * Every rule the docs state about the manifest, checked against the packed file
 * list rather than the working tree. Returns one line per violation.
 *
 * Only the shape rules and the `dependencies` rule are the host's own; the
 * `pi-package` keyword and the `"*"` peer range come from `docs/packages.md`,
 * so what is asserted here is what the documentation requires of a package that
 * is to be found at all.
 */
function manifestProblems(pkg, packedPaths) {
	const problems = [];

	if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("pi-package")) {
		problems.push('keywords must include "pi-package" — it is what makes the package eligible for the pi package gallery');
	}

	if (typeof pkg.pi !== "object" || pkg.pi === null || Array.isArray(pkg.pi)) {
		problems.push("pi must be an object holding the resource entries");
		return problems;
	}

	for (const field of RESOURCE_FIELDS) {
		const entries = pkg.pi[field];
		// A manifest is exclusive: with `pi` present the host reads the manifest
		// and returns before it walks the conventional directories
		// (`dist/core/package-manager.js:1865-1871`), so a directory that ships
		// resources the manifest never mentions is dead weight pi will not look
		// at — the failure this whole check exists for.
		if (entries === undefined) {
			const orphaned = packedPaths.filter(
				(path) => path.startsWith(`${field}/`) && RESOURCE_FILE[field].test(path),
			);
			if (orphaned.length > 0) {
				problems.push(
					`pi.${field} is missing while the tarball ships ${orphaned.length} ${field} file(s) — the host reads resources only from the manifest, so they would load only if a user narrowed this package by hand`,
				);
			}
			continue;
		}
		if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string")) {
			problems.push(`pi.${field} must be an array of paths — any other shape makes the host drop the field`);
			continue;
		}
		for (const entry of entries) {
			// Override patterns filter what the source entries discovered
			// (`dist/core/package-manager.js:1963`); they are not themselves
			// resolved to files.
			if (isOverridePattern(entry)) continue;
			// A non-glob entry is `resolve(root, entry)` (`:1966`); a glob one
			// is `globSync(pattern, { cwd: root })` (`:142-148`), so its literal
			// prefix is the directory it can match anything under.
			const root = normalize(hasGlobPattern(entry) ? entry.split(/[*?]/)[0] : entry).replace(/\/$/, "");
			const shipped = packedPaths.filter((path) => path === root || path.startsWith(`${root}/`));
			const files = shipped.filter((path) => path === root || RESOURCE_FILE[field].test(path));
			if (files.length === 0) {
				problems.push(
					`pi.${field} entry "${entry}" ships no ${field} file — pi would find nothing there and report nothing`,
				);
			}
		}
	}

	// Absolute URLs: the gallery fetches them, and a relative one resolves
	// against nothing.
	for (const field of ["image", "video"]) {
		const url = pkg.pi[field];
		if (url !== undefined && (typeof url !== "string" || !url.startsWith("https://"))) {
			problems.push(`pi.${field} must be an absolute https: URL`);
		}
	}

	const dependencies = pkg.dependencies;
	const offenders =
		typeof dependencies === "object" && dependencies !== null && !Array.isArray(dependencies)
			? Object.keys(dependencies)
					.filter((name) => HOST_PROVIDED_PACKAGES.has(name))
					.sort()
			: [];
	if (offenders.length > 0) {
		problems.push(
			`host-provided packages must stay in peerDependencies, not dependencies: ${offenders.join(", ")}`,
		);
	}

	for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
		if (range !== "*") {
			problems.push(`peerDependency ${name} must use the "*" range, got "${range}"`);
		}
	}

	return problems;
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

// npm packs `package.json` verbatim (it is in `REQUIRED` above, and no
// `prepack` script rewrites it), so the working-tree manifest is the one in the
// tarball — the same file the host reads when it decides what this package
// exposes.
let pkg;
try {
	pkg = JSON.parse(readFileSync("package.json", "utf8"));
} catch (error) {
	console.error(`pack check failed: package.json is not readable JSON (${error.message})`);
	process.exit(1);
}
const problems = manifestProblems(pkg, paths);

const missing = [...REQUIRED, ...requiredSources(), ...requiredSkills()].filter(
	(path) => !paths.includes(path),
);
const forbidden = paths.filter(
	(path) =>
		FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
		FORBIDDEN_SUFFIXES.some((suffix) => path.endsWith(suffix)),
);

if (missing.length > 0 || forbidden.length > 0 || problems.length > 0) {
	console.error("pack check failed");
	if (missing.length > 0) console.error(`  missing from tarball: ${missing.join(", ")}`);
	if (forbidden.length > 0) console.error(`  must not ship: ${forbidden.join(", ")}`);
	for (const problem of problems) console.error(`  manifest: ${problem}`);
	process.exit(1);
}

console.log(
	`pack check ok: ${paths.length} files, ${pack.size} bytes packed, ` +
		`${pack.unpackedSize} bytes unpacked`,
);
