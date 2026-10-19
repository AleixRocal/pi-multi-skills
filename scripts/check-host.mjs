#!/usr/bin/env node
/**
 * Host-citation check — every `file:line` a comment cites must still point at
 * what the comment says it does.
 *
 * Why this exists. The extension is pinned to pi 1.3.0 *by reading*, not by an
 * API contract: the comments name the host line that makes each decision true
 * (`AGENTS.md` → *What this is*). That base decays silently. Going 1.2.0 → 1.3.0
 * moved `agent-session.js` by `+1` and `interactive-mode.js` by `+2` without a
 * single cited region changing its text — the exact drift a reader cannot see,
 * and the reason a comment can be wrong while every test stays green.
 *
 * What is asserted, and which silent failure each assertion covers:
 *
 *  1. The cited path resolves to exactly one file in an installed host package.
 *     `agent-session.js` is written bare in some comments and as
 *     `dist/core/agent-session.js` in others; both must land on the same file.
 *     Zero matches means the host moved or removed it; more than one means the
 *     citation is imprecise, which is a defect rather than something to guess at.
 *  2. The cited lines exist in that file.
 *  3. The text of those lines is unchanged — `first`/`last` are the readable
 *     form, and a hash of the whole range is what actually fails, so an edit
 *     inside the range is caught even when both boundary lines still read the
 *     same.
 *  4. Every citation written in the sources has a baseline entry. A new comment
 *     cannot cite a host line without someone snapshotting it.
 *
 * `--update` rewrites the snapshot from the installed host and prints what moved.
 * That is the bump recipe: the diff of `scripts/host-baseline.json` *is* the
 * re-read, and a range whose `sha256` changed is a range whose behaviour changed.
 *
 * Exit code is the contract: 0 = every citation still holds.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts/host-baseline.json");

/** Packages whose sources the comments cite. Order matters only for reporting. */
const HOST_PACKAGES = [
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
];

/** Where citations are written. `plans/` and `.rpiv/` are local, never scanned. */
const SCAN_DIRS = ["src", "extensions", "scripts", "tests"];
const SCAN_FILES = ["AGENTS.md", "CONTRIBUTING.md"];
const SCAN_EXTS = [".ts", ".mjs"];

/**
 * Citations that point at this repository, not at the host. A cite is self-repo
 * when its path starts with one of these prefixes.
 */
const SELF_PREFIXES = ["src/", "tests/", "extensions/", "scripts/", "skills/"];

/**
 * Citations this repository cannot verify offline. `@juicesharp/rpiv-args` is
 * the extension this one must stay byte-identical with (`AGENTS.md` →
 * invariant 2); it is a third-party package, deliberately not a dependency, so
 * its lines are counted as skipped rather than claimed as verified.
 */
const EXTERNAL = new Map([
	["args.ts", "@juicesharp/rpiv-args"],
	["rpiv-args/index.ts", "@juicesharp/rpiv-args"],
]);

/**
 * Citations whose bare name matches more than one host file, resolved by hand.
 *
 * `loader.js` exists twice: the host's extension loader (which rejects a tool
 * whose `parameters` is not an object schema) and a pi-tui spinner component.
 * The test that cites it asserts the former, so the pin is a reading, not a
 * guess — and it is recorded here rather than hidden in a precedence rule.
 */
const PINNED = new Map([[`loader.js`, { package: `@earendil-works/pi-coding-agent`, path: `dist/core/extensions/loader.js` }]]);

/** `path/to/file.ext:53-63` — also `:66,141`, `:381,388-390`, `:1710-1711`. */
const CITE_RE = /([A-Za-z0-9_@][A-Za-z0-9_./@-]*\.(?:d\.ts|ts|js|mjs)):(\d+(?:[,-]\d+)*)/g;

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Expand `53-63`, `66,141`, `381,388-390` into the line numbers they name. */
function expandLines(spec) {
	const lines = [];
	for (const part of spec.split(",")) {
		const [start, end = start] = part.split("-").map(Number);
		for (let n = start; n <= end; n += 1) lines.push(n);
	}
	return lines;
}

/** Every file in an installed host package, keyed by its package-relative path. */
function indexPackage(pkg) {
	const root = join(ROOT, "node_modules", pkg);
	const out = [];
	const walk = (rel) => {
		const abs = join(root, rel);
		let entries;
		try {
			entries = readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			// A nested node_modules is another package's tree; never ours.
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules") walk(child);
			} else if (entry.isFile()) out.push(child);
		}
	};
	walk("");
	return out;
}

function buildIndex() {
	const index = new Map();
	for (const pkg of HOST_PACKAGES) index.set(pkg, indexPackage(pkg));
	const found = [...index.values()].reduce((total, files) => total + files.length, 0);
	if (found === 0) {
		// The whole check rests on reading the host that is installed. Say so
		// instead of reporting every citation as "gone".
		throw new Error(`no host sources under ${join(ROOT, "node_modules")}; run \`npm ci\` first`);
	}
	return index;
}

/**
 * Resolve one cited path to `{ package, path }`.
 *
 * A cite may be written bare (`agent-session.js`), package-relative
 * (`dist/core/agent-session.js`, `core/agent-session.js`) or fully qualified
 * (`@earendil-works/pi-tui/dist/autocomplete.js`). Suffix matching covers all
 * three without a hand-maintained map, and refusing ambiguity is deliberate: a
 * citation that could mean two files is not a checkable claim.
 */
function resolveCite(cited, index) {
	const pinned = PINNED.get(cited);
	if (pinned) return { ok: true, ...pinned };
	let pkgHint = null;
	let rest = cited;
	const scoped = HOST_PACKAGES.find((pkg) => cited.startsWith(`${pkg}/`));
	if (scoped) {
		pkgHint = scoped;
		rest = cited.slice(scoped.length + 1);
	}

	const candidates = [];
	for (const [pkg, files] of index) {
		if (pkgHint && pkg !== pkgHint) continue;
		for (const file of files) {
			if (file === rest || file.endsWith(`/${rest}`)) candidates.push({ package: pkg, path: file });
		}
	}
	if (candidates.length === 1) return { ok: true, ...candidates[0] };
	if (candidates.length === 0) return { ok: false, reason: "unresolved" };
	return { ok: false, reason: "ambiguous", candidates };
}

/** Read a file's lines once; `\r` is stripped so the snapshot is platform-stable. */
function readLines(abs) {
	return readFileSync(abs, "utf8").split("\n").map((line) => line.replace(/\r$/, ""));
}

/** The snapshot for one citation: readable boundaries plus a hash of the range. */
function snapshot(abs, spec) {
	const lines = readLines(abs);
	const cited = expandLines(spec);
	const missing = cited.filter((n) => n > lines.length);
	if (missing.length > 0) return { error: `line ${missing[0]} is past end of file (${lines.length})` };
	const text = cited.map((n) => lines[n - 1]);
	return {
		lines: spec,
		count: cited.length,
		sha256: sha(text.join("\n")),
		first: text[0].trim(),
		last: text[text.length - 1].trim(),
	};
}

/** Every distinct citation written in the scanned sources. */
function scanSources() {
	const found = new Map();
	const record = (abs, file) => {
		const text = readFileSync(abs, "utf8");
		for (const match of text.matchAll(CITE_RE)) {
			const cite = `${match[1]}:${match[2]}`;
			if (found.has(cite)) {
				found.get(cite).files.add(file);
				continue;
			}
			found.set(cite, { cite, cited: match[1], spec: match[2], files: new Set([file]) });
		}
	};
	const walk = (rel) => {
		const abs = join(ROOT, rel);
		for (const entry of readdirSync(abs, { withFileTypes: true })) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(child);
			else if (SCAN_EXTS.some((ext) => entry.name.endsWith(ext))) record(join(ROOT, child), child);
		}
	};
	for (const dir of SCAN_DIRS) if (existsSync(join(ROOT, dir))) walk(dir);
	for (const file of SCAN_FILES) if (existsSync(join(ROOT, file))) record(join(ROOT, file), file);
	return found;
}

const isSelf = (cited) => SELF_PREFIXES.some((prefix) => cited.startsWith(prefix));
const externalFor = (cited) => EXTERNAL.get(cited) ?? null;

/** Hash the docs the host ships: markdown and the index, never the images. */
function docsSnapshot() {
	const root = join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "docs");
	const out = {};
	const walk = (rel) => {
		const abs = join(root, rel);
		let entries;
		try {
			entries = readdirSync(abs, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(child);
			else if (entry.name.endsWith(".md") || entry.name === "docs.json") {
				out[`docs/${child}`] = sha(readFileSync(join(root, child), "utf8"));
			}
		}
	};
	walk("");
	// Sorted so the snapshot diffs cleanly when a bump touches a few pages.
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Parse a JSON file, naming the file when it is malformed instead of a bare SyntaxError. */
function readJson(abs) {
	let text;
	try {
		text = readFileSync(abs, "utf8");
	} catch (cause) {
		throw new Error(`cannot read ${abs}: ${cause.message}`);
	}
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new Error(`${abs} is not valid JSON: ${cause.message}`);
	}
}

function hostVersions() {
	const versions = {};
	for (const pkg of HOST_PACKAGES) {
		const manifest = join(ROOT, "node_modules", pkg, "package.json");
		if (existsSync(manifest)) versions[pkg] = readJson(manifest).version;
	}
	return versions;
}

/** Build the whole baseline from the installed host, collecting the failures it sees. */
function buildBaseline() {
	const index = buildIndex();
	const citations = {};
	const problems = [];
	const found = scanSources();
	const keys = [...found.keys()].sort();

	for (const cite of keys) {
		const entry = found.get(cite);
		if (isSelf(entry.cited)) continue;
		const external = externalFor(entry.cited);
		if (external) {
			citations[cite] = { external };
			continue;
		}
		const resolved = resolveCite(entry.cited, index);
		if (!resolved.ok) {
			problems.push(
				resolved.reason === "ambiguous"
					? `${cite} is ambiguous: ${resolved.candidates.map((c) => `${c.package}/${c.path}`).join(", ")}`
					: `${cite} resolves to no file in the installed host packages`,
			);
			continue;
		}
		const snap = snapshot(join(ROOT, "node_modules", resolved.package, resolved.path), entry.spec);
		if (snap.error) {
			problems.push(`${cite}: ${snap.error}`);
			continue;
		}
		citations[cite] = { package: resolved.package, path: resolved.path, ...snap };
	}

	return { baseline: { host: hostVersions(), citations, docs: docsSnapshot() }, problems, found };
}

/** Compare one citation against the current host. Returns a report line, or null when it holds. */
function verifyCitation(cite, entry, index) {
	if (entry.external) return null;
	const abs = join(ROOT, "node_modules", entry.package, entry.path);
	if (!existsSync(abs)) {
		const cited = cite.slice(0, cite.lastIndexOf(":"));
		const resolved = resolveCite(cited, index);
		const where = resolved.ok ? ` -> ${resolved.package}/${resolved.path}` : "";
		return `${cite}: ${entry.package}/${entry.path} is gone${where}`;
	}
	const lines = readLines(abs);
	const expected = expandLines(entry.lines);
	const past = expected.filter((n) => n > lines.length);
	if (past.length > 0) return `${cite}: cited line ${past[0]} is past end of file (${lines.length}): ${entry.path}`;
	const actual = expected.map((n) => lines[n - 1]);
	if (sha(actual.join("\n")) === entry.sha256) return null;

	const report = [`${cite} -> ${entry.path}`, `  expected :${expected[0]}  ${entry.first}`];
	report.push(`  actual   :${expected[0]}  ${actual[0].trim()}`);
	if (entry.first !== actual[0].trim()) {
		// The most useful line in the whole check: where the cited text lives now.
		const moved = lines.findIndex((line) => line.trim() === entry.first);
		report.push(
			moved >= 0
				? `  the expected text now starts at :${moved + 1} (${moved + 1 - expected[0] >= 0 ? "+" : ""}${moved + 1 - expected[0]})`
				: "  the expected text is no longer in this file",
		);
	} else {
		report.push(`  the boundary lines are unchanged; the edit is inside :${expected[0]}-${expected[expected.length - 1]}`);
	}
	return report.join("\n");
}

function verify(baseline) {
	const index = buildIndex();
	const lines = [];
	const found = scanSources();
	let verified = 0;
	let external = 0;

	const bump = Object.entries(hostVersions())
		.filter(([pkg, version]) => baseline.host?.[pkg] && baseline.host[pkg] !== version)
		.map(([pkg, version]) => `${pkg} ${baseline.host[pkg]} -> ${version}`);
	if (bump.length > 0) lines.push(`host bumped: ${bump.join(", ")}`);

	const docs = docsSnapshot();
	const recorded = baseline.docs ?? {};
	const changed = Object.keys(docs).filter((file) => recorded[file] !== docs[file]);
	const added = Object.keys(docs).filter((file) => !(file in recorded));
	const removed = Object.keys(recorded).filter((file) => !(file in docs));
	if (changed.length + added.length + removed.length > 0) {
		const parts = [
			changed.length ? `changed ${changed.join(", ")}` : "",
			added.length ? `new ${added.join(", ")}` : "",
			removed.length ? `gone ${removed.join(", ")}` : "",
		].filter(Boolean);
		lines.push(`docs drifted from the baseline: ${parts.join("; ")} (read them before trusting a moved citation)`);
	}

	const failures = [];
	for (const [cite, entry] of Object.entries(baseline.citations ?? {})) {
		if (entry.external) {
			external += 1;
			continue;
		}
		const failure = verifyCitation(cite, entry, index);
		if (failure) failures.push(failure);
		else verified += 1;
	}

	// Coverage: a citation written today and never snapshotted is unverified, not passing.
	const unregistered = [];
	for (const [cite, entry] of found) {
		if (isSelf(entry.cited) || externalFor(entry.cited)) continue;
		if (cite in (baseline.citations ?? {})) continue;
		unregistered.push(`${cite} (in ${[...entry.files].join(", ")})`);
	}
	const stale = Object.keys(baseline.citations ?? {}).filter((cite) => {
		const entry = found.get(cite);
		return !entry && !baseline.citations[cite].external;
	});

	const externalNames = [...new Set(Object.values(baseline.citations ?? {}).map((e) => e.external).filter(Boolean))];
	const summary = `host check: ${verified} verified, ${external} external${externalNames.length ? ` (${externalNames.join(", ")})` : ""}, ${unregistered.length} unregistered, ${failures.length} drifted`;
	if (lines.length > 0) console.log(lines.join("\n"));
	console.log(summary);
	for (const entry of unregistered) console.log(`UNREGISTERED ${entry}`);
	for (const cite of stale) console.log(`STALE ${cite} — no longer cited anywhere; rerun --update`);
	for (const failure of failures) console.log(`FAIL ${failure}`);

	const ok = failures.length === 0 && unregistered.length === 0 && stale.length === 0;
	return ok;
}

function update() {
	const previous = existsSync(BASELINE_PATH) ? readJson(BASELINE_PATH) : null;
	const { baseline, problems } = buildBaseline();
	if (problems.length > 0) {
		console.error("cannot snapshot the host:");
		for (const problem of problems) console.error(`  ${problem}`);
		return false;
	}
	writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);

	const before = previous?.citations ?? {};
	const after = baseline.citations;
	const added = Object.keys(after).filter((cite) => !(cite in before));
	const gone = Object.keys(before).filter((cite) => !(cite in after));
	const changed = Object.keys(after).filter((cite) => before[cite] && before[cite].sha256 !== after[cite].sha256);
	const moved = Object.keys(after).filter(
		(cite) => before[cite] && before[cite].sha256 === after[cite].sha256 && before[cite].lines !== after[cite].lines,
	);
	console.log(
		`baseline written: ${Object.keys(after).length} citations (${added.length} new, ${gone.length} gone, ${changed.length} changed text, ${moved.length} moved)`,
	);
	if (before.host && Object.keys(baseline.host).some((pkg) => before.host[pkg] !== baseline.host[pkg])) {
		console.log(`host: ${JSON.stringify(before.host)} -> ${JSON.stringify(baseline.host)}`);
	}
	for (const cite of [...changed, ...moved]) {
		const was = before[cite];
		const now = after[cite];
		console.log(`  ${cite}: :${was?.lines} -> :${now.lines}${was?.sha256 !== now.sha256 ? " (text changed)" : ""}`);
	}
	for (const cite of added) console.log(`  + ${cite}`);
	for (const cite of gone) console.log(`  - ${cite}`);
	return true;
}

const mode = process.argv.includes("--update") ? "update" : "verify";
if (!existsSync(BASELINE_PATH) && mode === "verify") {
	console.error("scripts/host-baseline.json is missing; run `npm run check:host -- --update`");
	process.exit(1);
}
const ok = mode === "update" ? update() : verify(readJson(BASELINE_PATH));
process.exit(ok ? 0 : 1);
