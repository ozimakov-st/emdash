import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@core/primitives/agents/api';
import type { NotificationSettings } from '@core/primitives/app-settings/api';
import { attachAttentionChime, resolveChimeFile } from './ozdash-attention-chime';

const settings: NotificationSettings = {
  enabled: true,
  sound: true,
  customSoundPath: '~/Library/Application Support/emdash-oz/chime.wav',
  osNotifications: true,
  soundFocusMode: 'always',
};

function agentEvent(type: AgentEvent['type'], payload: AgentEvent['payload'] = {}): AgentEvent {
  return {
    type,
    source: 'hook',
    providerId: 'claude',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    timestamp: 1,
    payload,
  };
}

function setup(current: NotificationSettings = settings) {
  let emit: (event: AgentEvent) => void = () => {};
  const playSound = vi.fn();
  const showBanner = vi.fn();
  const dispose = attachAttentionChime({
    onAgentEvent: (handler) => {
      emit = handler;
      return () => {};
    },
    settings: { get: async () => current },
    isAppFocused: () => true,
    describe: async () => 'Claude Code - attention-test',
    openTask: vi.fn(),
    logger: { warn: vi.fn() },
    playSound,
    showBanner,
  });
  return { emit: (event: AgentEvent) => emit(event), playSound, showBanner, dispose };
}

describe('attachAttentionChime', () => {
  it('plays the chime and shows the banner once per attention state', async () => {
    const { emit, playSound, showBanner } = setup();
    emit(agentEvent('start'));
    emit(agentEvent('notification', { notificationType: 'permission_prompt' }));
    emit(agentEvent('notification', { notificationType: 'permission_prompt' }));
    await vi.waitFor(() => expect(showBanner).toHaveBeenCalledTimes(1));
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledWith(settings);
    expect(showBanner).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-1' }),
      'Claude Code - attention-test',
      { level: 'input', status: 'awaiting-input' }
    );
  });

  it('stays quiet when notifications are off', async () => {
    const { emit, playSound, showBanner } = setup({ ...settings, enabled: false });
    emit(agentEvent('stop'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playSound).not.toHaveBeenCalled();
    expect(showBanner).not.toHaveBeenCalled();
  });
});

describe('resolveChimeFile', () => {
  const custom = join(homedir(), 'Library/Application Support/emdash-oz/chime.wav');

  it('expands ~/ and uses the custom file when it exists', () => {
    expect(resolveChimeFile(settings.customSoundPath, (path) => path === custom)).toBe(custom);
  });

  it('falls back to the macOS Glass sound', () => {
    const glass = '/System/Library/Sounds/Glass.aiff';
    expect(resolveChimeFile(settings.customSoundPath, (path) => path === glass)).toBe(glass);
    expect(resolveChimeFile('', (path) => path === glass)).toBe(glass);
    expect(resolveChimeFile('', () => false)).toBeNull();
  });
});
