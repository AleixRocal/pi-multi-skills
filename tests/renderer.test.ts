import { describe, expect, it } from "vitest";
import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { registerMultiSkills } from "../extensions/index.js";
import { CHAIN_DISPLAY_MARKER, markChainForDisplay } from "../src/chain-display.js";
import { buildSkillBlock } from "../src/expander.js";
import { registerSkillChainRenderer, skillChainTransformer } from "../src/renderer.js";
import { createMockPi, skillCommand } from "./helpers/mock-pi.js";

/**
 * `renderSkillChain` itself is covered in `tests/chain-display.test.ts`, together
 * with the host's `parseSkillBlock`. This file covers the transformer around it:
 * where it registers, when it stays out of the way, and what a chain looks like
 * once it has run.
 */

/** A transform context as the interactive transcript builds it (`markdown-transform.js:2`). */
function context(messageType: MarkdownTransformContext["messageType"]): MarkdownTransformContext {
	return { messageType, isStreaming: false, availableWidth: 80 };
}

/** A block byte-exactly as `src/expander.ts` emits it. */
function emittedBlock(name: string, location: string, body: string): string {
	return buildSkillBlock({ name, filePath: location, baseDir: `/skills/${name}` }, body);
}

/** An emitted two-skill chain, marker included — what the transformer receives. */
function markedChain(): string {
	return markChainForDisplay(
		`${emittedBlock("research", "/skills/research/SKILL.md", "Research body")}\n\nrefactor auth\n\n${emittedBlock("design", "/skills/design/SKILL.md", "Design body")}\n\nwrite tests`,
	);
}

describe("renderer — registration", () => {
	it("registers exactly one markdown transformer and leaves the other surfaces intact", () => {
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

	it("rewrites a user message that carries a chain", () => {
		const out = skillChainTransformer(markedChain(), context("user"));

		expect(out).toBe("/skill:research refactor auth /skill:design write tests");
	});
});

describe("renderer — what the transcript shows", () => {
	it("shows one `/skill:<name>` per token, with the arguments the user typed", () => {
		const out = skillChainTransformer(markedChain(), context("user"));

		expect(out.match(/\/skill:/g)).toHaveLength(2);
		expect(out).toContain("/skill:research refactor auth");
		expect(out).toContain("/skill:design write tests");
	});

	it("leaks no block, no body and no marker into the transcript", () => {
		const out = skillChainTransformer(markedChain(), context("user"));

		expect(out).not.toContain("<skill ");
		expect(out).not.toContain("</skill>");
		expect(out).not.toContain("Research body");
		expect(out).not.toContain(CHAIN_DISPLAY_MARKER);
	});

	it("is stable when the same message is rendered twice", () => {
		const once = skillChainTransformer(markedChain(), context("user"));

		expect(skillChainTransformer(once, context("user"))).toBe(once);
	});

	it("leaves a hand-typed span that is not host-shaped verbatim", () => {
		const spanned = '<skill name="design">\nbody\n</skill>';

		expect(skillChainTransformer(spanned, context("user"))).toBe(spanned);
	});
});
