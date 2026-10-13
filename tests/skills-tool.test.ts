import { afterEach, describe, expect, it } from "vitest";
import type {
	AgentToolResult,
	ExtensionToolContext,
	SlashCommandInfo,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import { invalidateSkillIndex } from "../src/registry.js";
import { registerSkillsTool, type SkillsToolDetails } from "../src/skills-tool.js";
import { createMockCtx, createMockPi, skillCommand } from "./helpers/mock-pi.js";

// `getSkillIndex` caches process-wide, so every test starts from a cold cache.
afterEach(() => {
	invalidateSkillIndex();
});

/** A descriptor for a command that is not a skill. */
function otherCommand(name: string, filePath: string): SlashCommandInfo {
	return {
		name,
		description: "not a skill",
		source: "extension",
		sourceInfo: { path: filePath, source: "test", scope: "user", origin: "package" },
	};
}

/** `execute` as this test calls it, with the host's five-argument signature. */
type ExecuteSkills = (
	toolCallId: string,
	params: { query?: string; limit?: number },
	signal: undefined,
	onUpdate: undefined,
	ctx: ExtensionToolContext,
) => Promise<AgentToolResult<SkillsToolDetails>>;

interface Fixture {
	/** The registered definition, for surface assertions. */
	readonly definition: ToolDefinition;
	/** Invoke the tool the way the host does. */
	readonly call: (params: {
		query?: string;
		limit?: number;
	}) => Promise<AgentToolResult<SkillsToolDetails>>;
}

/** Register the tool over the given descriptors and expose a caller. */
function fixture(commands: readonly SlashCommandInfo[]): Fixture {
	const mock = createMockPi({ commands: [...commands] });
	registerSkillsTool(mock.pi);

	const definition = mock.tools.find((tool) => tool.name === "skills");
	if (definition === undefined) throw new Error("the `skills` tool was not registered");

	const execute = definition.execute as unknown as ExecuteSkills;

	return {
		definition,
		call: (params) =>
			execute(
				"call-1",
				params,
				undefined,
				undefined,
				createMockCtx() as unknown as ExtensionToolContext,
			),
	};
}

/** Two skills whose descriptions both differ from their names. */
function twoSkills(): Fixture {
	return fixture([
		skillCommand("plan", "/skills/plan/SKILL.md", "Sequence work into phases"),
		skillCommand("design", "/skills/design/SKILL.md", "Shape code before writing it"),
	]);
}

/** Concatenated text content of a tool result. */
function textOf(result: AgentToolResult<SkillsToolDetails>): string {
	return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

describe("registerSkillsTool — surface", () => {
	it("registers one direct, read-only tool named `skills`", () => {
		const { definition } = twoSkills();

		expect(definition.name).toBe("skills");
		expect(definition.label).toBe("Skills");
		expect(definition.exposure).toBe("direct");
		expect(definition.annotations?.readOnlyHint).toBe(true);
		expect(definition.description.length).toBeGreaterThan(0);
		expect(definition.promptSnippet).toBeTruthy();
	});

	it("declares an object parameter schema, as the host requires (loader.js:233)", () => {
		const { definition } = twoSkills();

		expect(typeof definition.parameters).toBe("object");
		expect(Array.isArray(definition.parameters)).toBe(false);
	});

	it("is registered by the extension entry point alongside the input handler", () => {
		const mock = createMockPi({
			commands: [skillCommand("design", "/skills/design/SKILL.md", "Shape code")],
		});

		registerMultiSkills(mock.pi);

		expect(mock.tools.map((tool) => tool.name)).toEqual(["skills"]);
		expect(mock.inputHandlers).toHaveLength(1);
	});
});

describe("skills tool — listing", () => {
	it("lists every skill sorted by name, with its description and canonical path", async () => {
		const result = await twoSkills().call({});

		expect(result.details).toEqual({
			skills: [
				{
					name: "design",
					description: "Shape code before writing it",
					location: "/skills/design/SKILL.md",
				},
				{ name: "plan", description: "Sequence work into phases", location: "/skills/plan/SKILL.md" },
			],
			total: 2,
			truncated: false,
		});
	});

	it("serializes the page as the model-facing text content", async () => {
		const result = await twoSkills().call({});

		expect(JSON.parse(textOf(result))).toEqual(result.details.skills);
	});

	it("reports an empty description when the skill declares none", async () => {
		const { call } = fixture([skillCommand("bare", "/skills/bare/SKILL.md")]);

		const result = await call({});

		expect(result.details.skills).toEqual([
			{ name: "bare", description: "", location: "/skills/bare/SKILL.md" },
		]);
	});

	it("uses the canonical SKILL.md path, never the package root", async () => {
		const { call } = fixture([
			{
				name: "skill:design",
				description: "Shape code",
				source: "skill",
				sourceInfo: {
					path: "/pkg/node_modules/pkg-owning-design/skills/design/SKILL.md",
					source: "test",
					scope: "user",
					origin: "package",
					baseDir: "/pkg/node_modules/pkg-owning-design",
				},
			},
		]);

		const result = await call({});

		expect(result.details.skills).toEqual([
			{
				name: "design",
				description: "Shape code",
				location: "/pkg/node_modules/pkg-owning-design/skills/design/SKILL.md",
			},
		]);
	});

	it("ignores commands that are not skills", async () => {
		const { call } = fixture([
			skillCommand("design", "/skills/design/SKILL.md", "Shape code"),
			otherCommand("help", "/ext/help.ts"),
		]);

		const result = await call({});

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["design"]);
	});

	it("reports no skills, without failing, when the session has none", async () => {
		const result = await fixture([]).call({});

		expect(result.details).toEqual({ skills: [], total: 0, truncated: false });
		expect(textOf(result)).toBe("No skills are available in this session.");
	});
});

describe("skills tool — query", () => {
	it("matches names case-insensitively", async () => {
		const result = await twoSkills().call({ query: "DESIGN" });

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["design"]);
		expect(result.details.total).toBe(1);
	});

	it("matches descriptions", async () => {
		const result = await twoSkills().call({ query: "sequence" });

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["plan"]);
	});

	it("trims the query before matching", async () => {
		const result = await twoSkills().call({ query: "  design  " });

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["design"]);
	});

	it("treats an empty query as no filter", async () => {
		const result = await twoSkills().call({ query: "   " });

		expect(result.details.skills).toHaveLength(2);
	});

	it("explains an unmatched query instead of failing", async () => {
		const result = await twoSkills().call({ query: "terraform" });

		expect(result.details).toEqual({ skills: [], total: 0, truncated: false });
		expect(textOf(result)).toContain('No skill matches "terraform"');
	});
});

describe("skills tool — limit", () => {
	/** Three skills whose descriptions match none of the queries below. */
	function threeSkills(): Fixture {
		return fixture([
			skillCommand("a", "/skills/a/SKILL.md", "plain"),
			skillCommand("b", "/skills/b/SKILL.md", "plain"),
			skillCommand("c", "/skills/c/SKILL.md", "plain"),
		]);
	}

	it("caps the page and still reports the full match count", async () => {
		const result = await threeSkills().call({ limit: 2 });

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["a", "b"]);
		expect(result.details.total).toBe(3);
		expect(result.details.truncated).toBe(true);
		expect(textOf(result)).toContain("Showing 2 of 3");
	});

	it("does not truncate when the limit covers every match", async () => {
		const result = await threeSkills().call({ limit: 3 });

		expect(result.details.skills).toHaveLength(3);
		expect(result.details.truncated).toBe(false);
	});

	it("applies the query before the limit", async () => {
		const result = await threeSkills().call({ query: "c", limit: 1 });

		expect(result.details.skills.map((listing) => listing.name)).toEqual(["c"]);
		expect(result.details.total).toBe(1);
		expect(result.details.truncated).toBe(false);
	});

	it("clamps a limit below 1 to a single skill", async () => {
		const result = await threeSkills().call({ limit: 0 });

		expect(result.details.skills).toHaveLength(1);
		expect(result.details.truncated).toBe(true);
	});

	it("falls back to the default page for a non-finite limit", async () => {
		const result = await threeSkills().call({ limit: Number.NaN });

		expect(result.details.skills).toHaveLength(3);
		expect(result.details.truncated).toBe(false);
	});
});
