// Fork (ozimakov-st): OZ chat. Which mode a session starts in, and how an ACP session
// is shown. Pure data and rules, shared by the renderer and the main process.
//
//   mode         transport   view
//   oz-chat      acp         OZ chat (Conductor-like renderer)
//   emdash-chat  acp         Emdash chat (the stock chat-ui renderer)
//   terminal     pty         terminal
//
// A conversation's transport is fixed when it is created. The view of an ACP
// conversation can change at any time.

export const SESSION_MODES = ['oz-chat', 'emdash-chat', 'terminal'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/** Oleg's default: every new session starts in OZ chat. */
export const SESSION_MODE_DEFAULT: SessionMode = 'oz-chat';

export const SESSION_MODE_OPTIONS: ReadonlyArray<{
  id: SessionMode;
  label: string;
  description: string;
}> = [
  { id: 'oz-chat', label: 'OZ chat', description: 'Calm chat view, no permission prompts' },
  { id: 'emdash-chat', label: 'Emdash chat', description: 'The standard Emdash chat view' },
  { id: 'terminal', label: 'Terminal', description: 'The agent CLI in a terminal' },
];

export type ChatView = 'oz' | 'emdash';

export function isSessionMode(value: unknown): value is SessionMode {
  return typeof value === 'string' && (SESSION_MODES as readonly string[]).includes(value);
}

/** The global setting, or the default when it is missing or unknown. */
export function normalizeSessionMode(value: unknown): SessionMode {
  return isSessionMode(value) ? value : SESSION_MODE_DEFAULT;
}

export type LaunchTransport = {
  type: 'acp' | 'pty';
  /** True when a chat mode was asked for but the provider has no chat (ACP) support. */
  fellBack: boolean;
};

/**
 * The transport a new session uses. Chat modes need ACP; a provider without it falls
 * back to the terminal, and `fellBack` says so.
 */
export function resolveLaunchTransport(
  mode: SessionMode,
  providerSupportsAcp: boolean
): LaunchTransport {
  if (mode === 'terminal') return { type: 'pty', fellBack: false };
  return providerSupportsAcp ? { type: 'acp', fellBack: false } : { type: 'pty', fellBack: true };
}

/**
 * MCP `create_task` / `create_conversation`: an explicit `chatUi` wins; without it the
 * global session mode decides.
 */
export function resolveMcpTransport(
  chatUi: boolean | undefined,
  mode: SessionMode,
  providerSupportsAcp: boolean
): LaunchTransport {
  if (chatUi === false) return { type: 'pty', fellBack: false };
  if (chatUi === true) return resolveLaunchTransport('oz-chat', providerSupportsAcp);
  return resolveLaunchTransport(mode, providerSupportsAcp);
}

/**
 * How an ACP conversation is shown: its own choice (tab menu) wins; otherwise the
 * global mode (`emdash-chat` → Emdash chat, anything else → OZ chat).
 */
export function resolveChatView(
  override: ChatView | null | undefined,
  mode: SessionMode
): ChatView {
  if (override === 'oz' || override === 'emdash') return override;
  return mode === 'emdash-chat' ? 'emdash' : 'oz';
}

/** The session mode a chat/terminal toggle sets, keeping the current chat flavor. */
export function sessionModeForToggle(current: SessionMode, useChat: boolean): SessionMode {
  if (!useChat) return 'terminal';
  return current === 'terminal' ? 'oz-chat' : current;
}
