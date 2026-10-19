import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The host-citation contract.
 *
 * Every comment in `src/`, `extensions/` and the specs justifies a decision by
 * citing a line of the host's own source. That is the only pin this package has
 * — there is no API contract, only `file:line` (`AGENTS.md` → *What this is*) —
 * and it decays silently: a bump can move a function without changing a word of
 * the cited text, which is what 1.2.0 → 1.3.0 did to `agent-session.js` by `+1`
 * and `interactive-mode.js` by `+2`.
 *
 * `scripts/check-host.mjs` is the gate; this spec is the reason it cannot be
 * skipped. It spawns the script rather than re-implementing verification, so
 * there is one definition of "still holds" and the failure lands in `npm test`
 * as well as in CI. What the script asserts, per citation: the path resolves to
 * exactly one installed host file, the lines exist, a hash of the range is
 * unchanged, and every citation written in the sources is registered — so a new
 * comment cannot cite a host line that nobody snapshotted.
 *
 * The snapshot lives in `scripts/host-baseline.json` and is regenerated with
 * `npm run check:host -- --update`. Its diff is the re-read a host bump needs:
 * line numbers moving means nothing cited changed; a `sha256` changing means
 * something cited did.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BASELINE = join(ROOT, "scripts", "host-baseline.json");

interface Citation {
	package?: string;
	path?: string;
	lines?: string;
	count?: number;
	sha256?: string;
	first?: string;
	last?: string;
	external?: string;
}

interface Baseline {
	host: Record<string, string>;
	citations: Record<string, Citation>;
	docs: Record<string, string>;
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as Baseline;

describe("host citations", () => {
	it("still point at the text they claim", () => {
		// 60 citations are checked against the installed host; 12 are external
		// (`@juicesharp/rpiv-args`), counted as skipped rather than as verified.
		// `execFileSync` throws on a non-zero exit, which is the assertion: if the
		// tree drifts, this throws with the script's report as the message.
		const report = execFileSync("node", [join(ROOT, "scripts", "check-host.mjs")], {
			cwd: ROOT,
			encoding: "utf-8",
		});
		const summary = report.match(/^host check: (\d+) verified, (\d+) external.*?(\d+) unregistered, (\d+) drifted/m);
		expect(summary, report).not.toBeNull();
		const [, verified, , unregistered, drifted] = summary ?? [];
		expect(Number(verified), report).toBeGreaterThan(0);
		expect(Number(unregistered), report).toBe(0);
		expect(Number(drifted), report).toBe(0);
	});

	it("are all snapshot or explicitly external", () => {
		const entries = Object.entries(baseline.citations);
		expect(entries.length).toBeGreaterThan(50);
		for (const [cite, entry] of entries) {
			if (entry.external) {
				// Counting these as verified would overstate coverage: the package
				// is not a dependency, so its lines cannot be read offline.
				expect(entry.package, `${cite} is external and also resolved`).toBeUndefined();
				expect(entry.external, `${cite} names no external package`).toMatch(/^@/);
				continue;
			}
			expect(entry.package, `${cite} has no package`).toMatch(/^@earendil-works\//);
			expect(entry.path, `${cite} has no path`).toBeTruthy();
			expect(entry.lines, `${cite} has no line spec`).toMatch(/^\d+([,-]\d+)*$/);
			expect(entry.sha256, `${cite} has no range hash`).toMatch(/^[0-9a-f]{64}$/);
			expect(entry.count, `${cite} has no line count`).toBeGreaterThan(0);
			expect(entry.first, `${cite} has no first line`).toBeTruthy();
			expect(entry.last, `${cite} has no last line`).toBeTruthy();
		}
	});

	it("were snapshotted against the host that is actually installed", () => {
		// A stale `host` map would make the bump warning lie: the check compares
		// this map against the installed versions to print "1.3.0 -> 1.4.0".
		for (const pkg of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
			const manifest = JSON.parse(
				readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf-8"),
			) as { version: string };
			expect(baseline.host[pkg], `${pkg} snapshot is stale`).toBe(manifest.version);
		}
	});

	it("snapshot the docs that are shipped with the host", () => {
		// Docs are advisory: a docs-only bump is not a behaviour change, so the
		// script warns instead of failing. The snapshot exists so a *citation*
		// failure can name the docs worth re-reading.
		const docs = Object.keys(baseline.docs);
		expect(docs).toContain("docs/packages.md");
		expect(docs).toContain("docs/extensions.md");
		expect(docs.every((file) => /^docs\/.*\.(md|json)$/.test(file)), "docs snapshot carries a non-doc file").toBe(
			true,
		);
	});
});
