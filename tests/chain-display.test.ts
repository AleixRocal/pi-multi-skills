/**
 * Chain display — the typed form in the transcript, and the host fact it rests
 * on.
 *
 * The unit half pins the marker and the reconstruction. The integration half
 * uses the host's OWN `parseSkillBlock` (exported from the package root) to pin
 * the reason the marker exists: a chain must not reach the collapsible skill
 * card, because the card runs no markdown transformers, and a transformer is the
 * only display hook this extension has.
 */

import { describe, expect, it } from "vitest";
import { parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import {
	CHAIN_DISPLAY_MARKER,
	markChainForDisplay,
	renderSkillChain,
} from "../src/chain-display.js";
import { buildSkillBlock } from "../src/expander.js";

/** A block byte-exactly as `src/expander.ts` emits it. */
function block(name: string, body: string, location = `/skills/${name}/SKILL.md`): string {
	return buildSkillBlock({ name, filePath: location, baseDir: `/skills/${name}` }, body);
}

describe("markChainForDisplay", () => {
	it("leaves a single bare skill to pi's own card", () => {
		const single = block("design", "DESIGN BODY");

		expect(markChainForDisplay(single)).toBe(single);
	});

	it("marks a chain so the host renders text instead of a card", () => {
		const chain = `${block("a", "A BODY")}\n\n${block("b", "B BODY")}`;

		expect(markChainForDisplay(chain)).toBe(`${CHAIN_DISPLAY_MARKER}${chain}`);
	});

	it("leaves a message that does not start with a block alone", () => {
		// `please /skill:design now` is emitted as `please\n\n<block>`: the anchored
		// host parse already fails, so the transformer already sees everything and a
		// marker would only add a stray character.
		const withPreamble = `please\n\n${block("design", "DESIGN BODY")}`;

		expect(markChainForDisplay(withPreamble)).toBe(withPreamble);
	});

	it("is idempotent", () => {
		const chain = markChainForDisplay(`${block("a", "A")}\n\n${block("b", "B")}`);

		expect(markChainForDisplay(chain)).toBe(chain);
	});

	it("does not count a block mention inside a body", () => {
		// A body may quote the syntax without carrying a whole block: the closing
		// tag has to sit on its own line for the host's pattern to match.
		const body = 'See <skill name="x" location="y"> in the docs.';
		const single = block("docs", body);

		expect(markChainForDisplay(single)).toBe(single);
	});
});

describe("renderSkillChain", () => {
	it("rewrites a chain as the text the user typed", () => {
		const chain = markChainForDisplay(
			`${block("research", "RESEARCH BODY")}\n\nrefactor auth\n\n${block("design", "DESIGN BODY")}\n\nwrite tests`,
		);

		expect(renderSkillChain(chain)).toBe(
			"/skill:research refactor auth /skill:design write tests",
		);
	});

	it("drops the marker", () => {
		const marked = markChainForDisplay(`${block("a", "A")}\n\n${block("b", "B")}`);

		expect(renderSkillChain(marked).startsWith(CHAIN_DISPLAY_MARKER)).toBe(false);
	});

	it("keeps a token that owns no arguments argument-less", () => {
		const chain = markChainForDisplay(`${block("a", "A")}\n\n${block("b", "B")}`);

		expect(renderSkillChain(chain)).toBe("/skill:a /skill:b");
	});

	it("keeps the preamble in front, as the user wrote it", () => {
		const withPreamble = `please review\n\n${block("design", "D")}\n\nthe auth module`;

		expect(renderSkillChain(withPreamble)).toBe("please review /skill:design the auth module");
	});

	it("keeps multi-line arguments whole", () => {
		const chain = `${block("design", "D")}\n\nline one\n\nline two`;

		expect(renderSkillChain(chain)).toBe("/skill:design line one\n\nline two");
	});

	it("keeps an unresolved token that stayed verbatim", () => {
		const mixed = `/skill:nope x\n\n${block("design", "D")}\n\ny`;

		expect(renderSkillChain(mixed)).toBe("/skill:nope x /skill:design y");
	});

	it("is idempotent — the rewritten text carries no block", () => {
		const once = renderSkillChain(markChainForDisplay(`${block("a", "A")}\n\n${block("b", "B")}`));

		expect(renderSkillChain(once)).toBe(once);
	});

	it("leaves a hand-typed span that is not host-shaped verbatim", () => {
		const spanned = '<skill name="design">\nbody\n</skill>';

		expect(renderSkillChain(spanned)).toBe(spanned);
	});
});

describe("chain display — the host's own parse", () => {
	it("renders a single skill as pi's card, not as text (the byte-parity contract)", () => {
		expect(parseSkillBlock(block("design", "D"))).not.toBeNull();
	});

	it("renders a chain as plain text, which is what runs the transformer", () => {
		const marked = markChainForDisplay(`${block("a", "A")}\n\nx\n\n${block("b", "B")}\n\ny`);

		expect(parseSkillBlock(marked)).toBeNull();
	});

	it("round-trips an emitted chain back to the typed chain", () => {
		const marked = markChainForDisplay(
			`${block("research", "R")}\n\nrefactor auth\n\n${block("design", "D")}\n\nwrite tests`,
		);

		expect(renderSkillChain(marked)).toBe(
			"/skill:research refactor auth /skill:design write tests",
		);
	});
});

describe("chain display — the transcript line", () => {
	it("is one plain line: no block, no body, no marker", () => {
		const marked = markChainForDisplay(
			`${block("research", "RESEARCH BODY")}\n\nrefactor auth\n\n${block("design", "DESIGN BODY")}\n\nwrite tests`,
		);

		expect(renderVisible(renderSkillChain(marked))).toBe(
			"/skill:research refactor auth /skill:design write tests",
		);
	});
});

/**
 * Render `markdown` the way the transcript does, with ANSI stripped and padding
 * dropped, so the assertion is about what a reader sees.
 *
 * `UserMessageComponent` is not importable (the package's `exports` map exposes
 * the root only), but its markdown surface is: `Markdown` from pi-tui, wired the
 * way `components/user-message.js:31-41` wires it.
 */
function renderVisible(markdown: string): string {
	const identity = (text: string) => text;
	const theme = new Proxy({}, { get: () => identity });
	const component = new Markdown(
		markdown,
		1,
		1,
		theme as never,
		{ color: identity, bgColor: identity },
		{ preserveOrderedListMarkers: true, preserveBackslashEscapes: true },
	);

	return component
		.render(120)
		.map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim())
		.filter((line) => line.length > 0)
		.join("\n");
}
