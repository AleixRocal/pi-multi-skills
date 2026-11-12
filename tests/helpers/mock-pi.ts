/**
 * Minimal pi test doubles.
 *
 * `emitInput` reproduces the host's handler chain behaviourally — see
 * @earendil-works/pi-coding-agent/dist/core/extensions/runner.js:1210-1245:
 * handlers run in registration order, each handler observes the previous
 * handler's text, `transform` reassigns `currentText`/`currentImages`,
 * `handled` short-circuits the whole chain, and a throwing handler is reported
 * and then skipped with the chain continuing. The final return is `transform`
 * only when the text or the images actually changed.
 *
 * There is no published harness to reuse (`@juicesharp/rpiv-test-utils` is not
 * on npm), so this file is deliberately self-contained.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	MarkdownTransformer,
	MarkdownTransformerOptions,
	SessionStartEvent,
	SlashCommandInfo,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** An `input` handler as the host would call it. */
export type InputHandler = (
	event: InputEvent,
	ctx: ExtensionContext,
) => Promise<InputEventResult | void> | InputEventResult | void;

/** A `session_start` handler as the host would call it. */
export type SessionStartHandler = (
	event: SessionStartEvent,
	ctx: ExtensionContext,
) => Promise<void> | void;

export interface MockPi {
	/** The double itself, safe to hand to code that expects `ExtensionAPI`. */
	readonly pi: ExtensionAPI;
	/** Handlers registered on `input`, in registration order. */
	readonly inputHandlers: InputHandler[];
	/** Handlers registered on `session_start`, in registration order. */
	readonly sessionStartHandlers: SessionStartHandler[];
	/** Tools registered via `registerTool`. */
	readonly tools: ToolDefinition[];
	/** Transformers registered via `registerMarkdownTransformer`. */
	readonly markdownTransformers: MarkdownTransformer[];
	/** The options each transformer was registered with, in the same order. */
	readonly markdownTransformerOptions: (MarkdownTransformerOptions | undefined)[];
	/** Flags registered via `registerFlag`, in registration order. */
	readonly flagRegistrations: FlagRegistration[];
}

/** A `registerFlag` call as the host would have received it. */
export interface FlagRegistration {
	readonly name: string;
	readonly type: "boolean" | "string";
	readonly default?: string | boolean;
	readonly description?: string;
}

/** Build a `pi` double backed by an in-memory command list. */
export function createMockPi(
	options: { commands?: SlashCommandInfo[]; flags?: Record<string, string | boolean> } = {},
): MockPi {
	const commands = options.commands ?? [];
	const inputHandlers: InputHandler[] = [];
	const sessionStartHandlers: SessionStartHandler[] = [];
	const tools: ToolDefinition[] = [];
	const markdownTransformers: MarkdownTransformer[] = [];
	const markdownTransformerOptions: (MarkdownTransformerOptions | undefined)[] = [];
	/** CLI values, as `--flag value` would have supplied them. */
	const flagValues: Record<string, string | boolean> = { ...options.flags };
	const flagRegistrations: FlagRegistration[] = [];

	const pi = {
		on(event: string, handler: InputHandler | SessionStartHandler) {
			if (event === "input") {
				inputHandlers.push(handler as InputHandler);
				return () => {
					const index = inputHandlers.indexOf(handler as InputHandler);
					if (index !== -1) inputHandlers.splice(index, 1);
				};
			}
			if (event === "session_start") {
				sessionStartHandlers.push(handler as SessionStartHandler);
				return () => {
					const index = sessionStartHandlers.indexOf(handler as SessionStartHandler);
					if (index !== -1) sessionStartHandlers.splice(index, 1);
				};
			}
			return () => {};
		},
		getCommands: () => commands,
		registerTool: (tool: ToolDefinition) => {
			tools.push(tool);
		},
		registerCommand: () => {},
		registerMarkdownTransformer: (
			transformer: MarkdownTransformer,
			options?: MarkdownTransformerOptions,
		) => {
			markdownTransformers.push(transformer);
			markdownTransformerOptions.push(options);
		},
		registerFlag: (name: string, flag: FlagRegistration) => {
			flagRegistrations.push({
				name,
				type: flag.type,
				...(flag.default !== undefined && { default: flag.default }),
				...(flag.description !== undefined && { description: flag.description }),
			});
			// The host answers `getFlag` with the declared default when the user did not
			// pass the flag (`core/extensions/types.d.ts:1290`), so a double that always
			// returned `undefined` would let a resolver test pass for the wrong reason.
			if (!(name in flagValues) && flag.default !== undefined) flagValues[name] = flag.default;
		},
		getFlag: (name: string) => flagValues[name],
	} as unknown as ExtensionAPI;

	return {
		pi,
		inputHandlers,
		sessionStartHandlers,
		tools,
		markdownTransformers,
		markdownTransformerOptions,
		flagRegistrations,
	};
}

/** Build an `ExtensionContext` double with the few members this extension uses. */
export function createMockCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: "/tmp/pi-multi-skills-test",
		sessionManager: { getSessionId: () => "test-session" },
		ui: { notify: () => {} },
		...overrides,
	} as unknown as ExtensionContext;
}

export interface EmitInputOptions {
	readonly source?: InputEvent["source"];
	readonly streamingBehavior?: InputEvent["streamingBehavior"];
	readonly images?: InputEvent["images"];
	readonly ctx?: ExtensionContext;
}

/**
 * Run a flat list of `input` handlers the way `ExtensionRunner#emitInput` does.
 * Pass handlers in registration order; mix our handler with a stub standing in
 * for another extension to test order independence.
 */
export async function emitInput(
	handlers: readonly InputHandler[],
	text: string,
	options: EmitInputOptions = {},
): Promise<InputEventResult> {
	const ctx = options.ctx ?? createMockCtx();
	const source = options.source ?? "interactive";
	const originalImages = options.images;
	let currentText = text;
	let currentImages = originalImages;

	for (const handler of handlers) {
		try {
			const event: InputEvent = {
				type: "input",
				text: currentText,
				images: currentImages,
				source,
				streamingBehavior: options.streamingBehavior,
			};
			const result = await handler(event, ctx);
			if (result?.action === "handled") return { action: "handled" };
			if (result?.action === "transform") {
				currentText = result.text;
				currentImages = result.images ?? currentImages;
			}
		} catch {
			// The host reports the error and continues the chain with the
			// current text — it never aborts the dispatch.
		}
	}

	return currentText !== text || currentImages !== originalImages
		? { action: "transform", text: currentText, images: currentImages }
		: { action: "continue" };
}

/** Build a `SlashCommandInfo` fixture for a skill. */
export function skillCommand(name: string, filePath: string, description = ""): SlashCommandInfo {
	return {
		name: `skill:${name}`,
		description,
		source: "skill",
		sourceInfo: { path: filePath, source: "test", scope: "user", origin: "package" },
	};
}
