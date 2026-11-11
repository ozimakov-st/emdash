import { describe, expect, it } from 'vitest';
import {
  SESSION_MODE_DEFAULT,
  normalizeSessionMode,
  resolveChatView,
  resolveLaunchTransport,
  resolveMcpTransport,
  sessionModeForToggle,
} from './session-mode';

describe('session mode', () => {
  it('defaults to OZ chat, also for unknown stored values', () => {
    expect(SESSION_MODE_DEFAULT).toBe('oz-chat');
    expect(normalizeSessionMode(undefined)).toBe('oz-chat');
    expect(normalizeSessionMode('acp')).toBe('oz-chat');
    expect(normalizeSessionMode('terminal')).toBe('terminal');
  });

  it('chat modes use ACP; a provider without ACP falls back to the terminal', () => {
    expect(resolveLaunchTransport('oz-chat', true)).toEqual({ type: 'acp', fellBack: false });
    expect(resolveLaunchTransport('emdash-chat', true)).toEqual({ type: 'acp', fellBack: false });
    expect(resolveLaunchTransport('oz-chat', false)).toEqual({ type: 'pty', fellBack: true });
    expect(resolveLaunchTransport('terminal', true)).toEqual({ type: 'pty', fellBack: false });
  });

  it('MCP: explicit chatUi wins, otherwise the global mode', () => {
    expect(resolveMcpTransport(false, 'oz-chat', true).type).toBe('pty');
    expect(resolveMcpTransport(true, 'terminal', true).type).toBe('acp');
    expect(resolveMcpTransport(undefined, 'oz-chat', true).type).toBe('acp');
    expect(resolveMcpTransport(undefined, 'terminal', true).type).toBe('pty');
    expect(resolveMcpTransport(undefined, 'oz-chat', false)).toEqual({
      type: 'pty',
      fellBack: true,
    });
  });

  it('an ACP conversation shows its own view choice, else follows the global mode', () => {
    expect(resolveChatView(null, 'oz-chat')).toBe('oz');
    expect(resolveChatView(null, 'terminal')).toBe('oz');
    expect(resolveChatView(null, 'emdash-chat')).toBe('emdash');
    expect(resolveChatView('emdash', 'oz-chat')).toBe('emdash');
    expect(resolveChatView('oz', 'emdash-chat')).toBe('oz');
  });

  it('the dialog toggle keeps the chat flavor', () => {
    expect(sessionModeForToggle('emdash-chat', true)).toBe('emdash-chat');
    expect(sessionModeForToggle('terminal', true)).toBe('oz-chat');
    expect(sessionModeForToggle('oz-chat', false)).toBe('terminal');
  });
});
