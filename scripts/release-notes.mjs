#!/usr/bin/env node
/**
 * Release notes for the version in `package.json`, read out of `CHANGELOG.md`.
 *
 * Why this exists rather than `gh release create --generate-notes`: generated
 * notes are the list of merged PR titles, which is a worse document than the
 * changelog entry the release is already required to have (CONTRIBUTING.md ->
 * "Changelog"). Reading the same file the user reads also means a release
 * cannot be created for a version nobody wrote down.
 *
 * Usage:
 *   node scripts/release-notes.mjs                  # fail if the version is missing
 *   node scripts/release-notes.mjs --allow-missing  # for dry runs
 *
 * Exit code is the contract: 0 = notes on stdout, 1 = the changelog has no
 * section for this version (which must stop a release, not produce one).
 */

import { readFileSync } from "node:fs";

const allowMissing = process.argv.includes("--allow-missing");

/** Heading of a released version: `## [1.2.3] - 2026-10-15`, not `## [Unreleased]`. */
function versionHeading(version) {
	return (line) => line.startsWith(`## [${version}]`);
}

function readVersion() {
	try {
		return JSON.parse(readFileSync("package.json", "utf8")).version;
	} catch (error) {
		console.error(`cannot read the version from package.json: ${error.message}`);
		process.exit(1);
	}
}

const version = readVersion();
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");

const start = lines.findIndex(versionHeading(version));
if (start === -1) {
	if (allowMissing) {
		console.log(`_No CHANGELOG.md section for ${version}._`);
		process.exit(0);
	}
	console.error(
		`CHANGELOG.md has no "## [${version}]" section. Date the "## [Unreleased]" ` +
			`entry for ${version} before tagging — the release notes come from it.`,
	);
	process.exit(1);
}

// A section runs until the next version heading; the trailing link definitions
// at the bottom of the file are therefore excluded.
const next = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
const body = lines.slice(start + 1, next === -1 ? lines.length : next).join("\n").trim();

if (body === "") {
	console.error(`CHANGELOG.md has an empty section for ${version}.`);
	process.exit(1);
}

console.log(body);
