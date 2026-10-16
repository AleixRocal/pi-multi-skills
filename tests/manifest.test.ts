import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The packaging contract for the `pi` manifest.
 *
 * The manifest is the only source of resources a package has: with a `pi` block
 * the host reads the manifest entries and returns before it ever walks the
 * conventional directories (`dist/core/package-manager.js:1865-1871`). Every
 * mistake in that block therefore fails *quietly*:
 *
 *  - A resource field that is not an array of strings is dropped
 *    (`dist/core/pi-manifest.js:16-18`), so the resource stops existing.
 *  - A key the host does not know (`pi.skill`, `pi.extension`) is never read at
 *    all, which looks exactly like a package that ships nothing.
 *  - A path the host cannot resolve loads nothing — no resource, no error
 *    (`:1966` resolves a non-glob entry as `resolve(root, entry)`).
 *  - A host-provided package in `dependencies` loads a second physical copy
 *    that bypasses pi's module mapping (`dist/core/resource-loader.js:18-29`
 *    holds the set, `:50-53` is the warning it earns).
 *
 * `scripts/check-pack.mjs` asserts the same rules against the published tarball;
 * this spec asserts them against the working tree, so the failure lands in
 * `npm test` rather than at the end of a release.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The keys the host reads, in its own order (`dist/core/pi-manifest.js:3`). */
const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

/** The non-resource keys the host reads (`docs/packages.md`, gallery previews). */
const PREVIEW_FIELDS = ["image", "video"] as const;

/** What each resource is made of: a resource root with none of it is empty. */
const RESOURCE_FILE: Record<(typeof RESOURCE_FIELDS)[number], RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /(^|\/)SKILL\.md$/,
	prompts: /\.md$/,
	themes: /\.json$/,
};

/** The host's own set, copied from `dist/core/resource-loader.js:18-29`. */
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

interface Manifest {
	readonly keywords?: readonly string[];
	readonly pi?: Record<string, unknown>;
	readonly dependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as Manifest;
const pi = manifest.pi ?? {};

/** The entries declared for one resource type, or `[]` when it is not declared. */
const entriesOf = (field: string): string[] => {
	const entries = pi[field];
	return Array.isArray(entries) ? (entries as string[]) : [];
};

/** `dist/core/package-manager.js:135-140`. */
const isOverridePattern = (entry: string): boolean =>
	entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-");
const hasGlobPattern = (entry: string): boolean => entry.includes("*") || entry.includes("?");

/** Every file under `dir`, as paths relative to the repository root. */
function filesUnder(dir: string): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) walk(path);
			else found.push(relative(ROOT, path));
		}
	};
	walk(dir);
	return found;
}

describe("the manifest declares a pi package", () => {
	it("carries the gallery keyword", () => {
		// `docs/packages.md`: the keyword is what makes an npm package eligible
		// for the pi package gallery, and nothing else is checked.
		expect(manifest.keywords).toContain("pi-package");
	});

	it("keeps the pi block free of keys the host would ignore", () => {
		const known = [...RESOURCE_FIELDS, ...PREVIEW_FIELDS] as string[];
		const unknown = Object.keys(pi).filter((key) => !known.includes(key));
		// A misspelt key is not an error to the host; it is simply never read.
		expect(unknown, `pi.${unknown.join(", pi.")} is never read by pi`).toEqual([]);
	});

	it("declares every resource as an array of paths", () => {
		for (const field of RESOURCE_FIELDS) {
			const entries = pi[field];
			if (entries === undefined) continue;
			// Any other shape makes the host drop the field silently
			// (`dist/core/pi-manifest.js:16-18`).
			expect(Array.isArray(entries), `pi.${field} must be an array`).toBe(true);
			expect(
				(entries as unknown[]).every((entry) => typeof entry === "string"),
				`pi.${field} must hold only strings`,
			).toBe(true);
		}
	});

	it("declares a root for every resource the repository ships", () => {
		for (const field of RESOURCE_FIELDS) {
			const dir = join(ROOT, field);
			const shipped = existsSync(dir)
				? filesUnder(dir).filter((path) => RESOURCE_FILE[field].test(path))
				: [];
			if (shipped.length === 0) continue;
			// The conventional directory is only read when there is no `pi`
			// block at all (`dist/core/package-manager.js:1865-1871`), so a
			// shipped resource the manifest does not mention is invisible.
			expect(entriesOf(field).length, `pi.${field} is missing`).toBeGreaterThan(0);
		}
	});
});

describe("every declared resource root resolves", () => {
	for (const field of RESOURCE_FIELDS) {
		const entries = entriesOf(field);
		if (entries.length === 0) continue;

		describe(field, () => {
			it("exists on disk", () => {
				for (const entry of entries) {
					// Override patterns filter what the source entries found
					// (`dist/core/package-manager.js:1963`) instead of resolving
					// to a path of their own; a glob entry is discovered by
					// traversal.
					if (isOverridePattern(entry) || hasGlobPattern(entry)) continue;
					const path = normalize(resolve(ROOT, entry));
					expect(existsSync(path), `${entry} does not exist`).toBe(true);
					// A non-glob entry is `resolve(root, entry)` (`:1966`), so a
					// path that escapes the package root can never ship.
					expect(path.startsWith(ROOT), `${entry} leaves the package root`).toBe(true);
				}
			});

			it("holds a file of this resource type", () => {
				for (const entry of entries) {
					if (isOverridePattern(entry) || hasGlobPattern(entry)) continue;
					const path = resolve(ROOT, entry);
					// Existence is the spec above; this one is about what is inside.
					if (!existsSync(path)) continue;
					const shipped = statSync(path).isDirectory()
						? filesUnder(path)
						: [relative(ROOT, path)];
					// A root that ships none of its own resource type loads nothing —
					// a directory entry for `skills` without a `SKILL.md` under it is
					// the quiet way to ship a package with no skills.
					expect(
						shipped.some((file) => RESOURCE_FILE[field].test(file)),
						`${entry} declares no ${field} file`,
					).toBe(true);
				}
			});
		});
	}
});

describe("host-provided packages stay peers", () => {
	it("never appears in dependencies", () => {
		const offenders = Object.keys(manifest.dependencies ?? {}).filter((name) =>
			HOST_PROVIDED_PACKAGES.has(name),
		);
		// A physical copy bypasses pi's extension module mapping and produces
		// duplicate classes and registries; the host warns about it
		// (`dist/core/resource-loader.js:50-53`).
		expect(offenders, `${offenders.join(", ")} must be a peerDependency`).toEqual([]);
	});

	it("is declared with the * range", () => {
		for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
			// `docs/packages.md`: host packages are declared with a `"*"` range,
			// because the host's own copy is the only one that may load.
			expect(range, `${name} must use the "*" range`).toBe("*");
		}
	});
});

describe("gallery previews", () => {
	it("points at absolute https URLs", () => {
		for (const field of PREVIEW_FIELDS) {
			const url = pi[field];
			if (url === undefined) continue;
			// The gallery fetches these itself; a relative path resolves
			// against nothing.
			expect(typeof url).toBe("string");
			expect(String(url).startsWith("https://"), `pi.${field} is not absolute`).toBe(true);
		}
	});
});
