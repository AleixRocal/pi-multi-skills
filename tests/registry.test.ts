import { afterEach, describe, expect, it } from "vitest";
import { buildSkillIndex, getSkillIndex, invalidateSkillIndex } from "../src/registry.js";
import { createMockPi, skillCommand } from "./helpers/mock-pi.js";

afterEach(() => {
	invalidateSkillIndex();
});

describe("buildSkillIndex", () => {
	it("indexes skill-sourced commands only, stripping the skill: prefix", () => {
		const { pi } = createMockPi({
			commands: [
				skillCommand("design", "/skills/design/SKILL.md"),
				{
					name: "help",
					description: "built-in",
					source: "extension",
					sourceInfo: { path: "/ext/help.ts", source: "test", scope: "user", origin: "package" },
				},
			],
		});

		expect([...buildSkillIndex(pi).keys()]).toEqual(["design"]);
	});

	it("derives baseDir as dirname(filePath), ignoring sourceInfo.baseDir", () => {
		const { pi } = createMockPi({
			commands: [
				{
					name: "skill:design",
					description: "",
					source: "skill",
					sourceInfo: {
						path: "/pkg/node_modules/pkg-owning-design/skills/design/SKILL.md",
						source: "test",
						scope: "user",
						origin: "package",
						baseDir: "/pkg/node_modules/pkg-owning-design",
					},
				},
			],
		});

		expect(buildSkillIndex(pi).get("design")).toEqual({
			name: "design",
			filePath: "/pkg/node_modules/pkg-owning-design/skills/design/SKILL.md",
			baseDir: "/pkg/node_modules/pkg-owning-design/skills/design",
		});
	});

	it("skips entries with no path or an empty name", () => {
		const { pi } = createMockPi({
			commands: [
				{
					name: "skill:",
					description: "",
					source: "skill",
					sourceInfo: { path: "/a/SKILL.md", source: "test", scope: "user", origin: "package" },
				},
				{
					name: "skill:noPath",
					description: "",
					source: "skill",
					sourceInfo: { path: "", source: "test", scope: "user", origin: "package" },
				},
			],
		});

		expect([...buildSkillIndex(pi).keys()]).toEqual([]);
	});
});

describe("getSkillIndex", () => {
	it("caches the index until invalidated", () => {
		const { pi } = createMockPi({ commands: [skillCommand("a", "/s/a/SKILL.md")] });

		const first = getSkillIndex(pi);
		expect(getSkillIndex(pi)).toBe(first);

		invalidateSkillIndex();
		expect(getSkillIndex(pi)).not.toBe(first);
	});
});
