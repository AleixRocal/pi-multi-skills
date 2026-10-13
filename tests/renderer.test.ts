import { describe, expect, it } from "vitest";
import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import { buildSkillBlock } from "../src/expander.js";
import {
	collapseSkillBlocks,
	registerSkillChainRenderer,
	skillChainTransformer,
} from "../src/renderer.js";
import { createMockPi, skillCommand } from "./helpers/mock-pi.js";

/** A transform context as the interactive transcript builds it (`markdown-transform.js:2`). */
function context(messageType: MarkdownTransformContext["messageType"]): MarkdownTransformContext {
	return { messageType, isStreaming: false, availableWidth: 80 };
}

/** A block byte-exactly as Slice 3's emitter produces it. */
function emittedBlock(name: string, location: string, body: string): string {
	return buildSkillBlock({ name, filePath: location, baseDir: `/skills/${name}` }, body);
}

/** The text the host hands a `UserMessageComponent` for a two-skill chain. */
function secondOfTwo(): string {
	return `${emittedBlock("plan", "/skills/plan/SKILL.md", "Plan body")}\n\nwrite tests`;
}

describe("renderer — registration", () => {
	it("registers exactly one markdown transformer and leaves the earlier surfaces intact", () => {
		const mock = createMockPi({
			commands: [skillCommand("design", "/skills/design/SKILL.md", "Shape code")],
		});

		registerMultiSkills(mock.pi);

		expect(mock.markdownTransformers).toHaveLength(1);
		expect(mock.markdownTransformers[0]).toBe(skillChainTransformer);
		expect(mock.inputHandlers).toHaveLength(1);
		expect(mock.tools.map((tool) => tool.name)).toEqual(["skills"]);
	});

	it("registers the transformer when called on its own", () => {
		const mock = createMockPi();

		registerSkillChainRenderer(mock.pi);

		expect(mock.markdownTransformers).toEqual([skillChainTransformer]);
	});
});

describe("renderer — gating", () => {
	it("returns assistant markdown byte-identical", () => {
		const raw = emittedBlock("design", "/skills/design/SKILL.md", "Body");

		expect(skillChainTransformer(raw, context("assistant"))).toBe(raw);
	});

	it("returns assistant-thinking markdown byte-identical", () => {
		const raw = emittedBlock("design", "/skills/design/SKILL.md", "Body");

		expect(skillChainTransformer(raw, context("assistant-thinking"))).toBe(raw);
	});

	it("returns a user message that carries no block byte-identical", () => {
		const raw = "please run /skill:design on src/app.ts";

		expect(skillChainTransformer(raw, context("user"))).toBe(raw);
	});

	it("collapses a user message that does carry a block", () => {
		const raw = emittedBlock("design", "/skills/design/SKILL.md", "Body");

		expect(skillChainTransformer(raw, context("user"))).not.toContain("<skill ");
	});
});

describe("renderer — collapsing", () => {
	it("collapses an emitted block to a one-line reference carrying its name and path", () => {
		const raw = emittedBlock("design", "/skills/design/SKILL.md", "Body");

		const out = collapseSkillBlocks(raw);

		expect(out).toContain("> **[skill] design**");
		expect(out).toContain("/skills/design/SKILL.md");
		expect(out).not.toContain("<skill ");
	});

	it("collapses only the blocks it is handed and keeps trailing argument text", () => {
		const out = collapseSkillBlocks(secondOfTwo());

		expect(out).toContain("> **[skill] plan**");
		expect(out.endsWith("\n\nwrite tests")).toBe(true);
	});

	it("keeps one reference per block — chained skills are never fused", () => {
		const raw = [
			emittedBlock("a", "/skills/a/SKILL.md", "Body a"),
			emittedBlock("b", "/skills/b/SKILL.md", "Body b"),
		].join("\n\n");

		expect(collapseSkillBlocks(raw).split("[skill]").length - 1).toBe(2);
	});

	it("is idempotent — a collapsed message has nothing left to collapse", () => {
		const once = collapseSkillBlocks(secondOfTwo());

		expect(collapseSkillBlocks(once)).toBe(once);
	});

	it("collapses a multi-line body whole, even when the body mentions the block syntax", () => {
		const body = [
			"Line one.",
			"",
			'Pi wraps a skill as <skill name="x" location="y"> here.',
			"Line three.",
		].join("\n");

		const out = collapseSkillBlocks(emittedBlock("design", "/skills/design/SKILL.md", body));

		expect(out).toContain("> **[skill] design**");
		expect(out).not.toContain("<skill ");
	});

	it("leaves a hand-typed span that is not host-shaped verbatim", () => {
		const spanned = '<skill name="design">\nbody\n</skill>';

		expect(collapseSkillBlocks(spanned)).toBe(spanned);
		expect(skillChainTransformer(spanned, context("user"))).toBe(spanned);
	});
});
