// Fork (ozimakov-st): the command lines OZdash agent presets launch (model + auto-approve
// + effort) for claude, codex and cursor.
import { describe, expect, it } from 'vitest';
import { provider as claude } from './claude/index';
import { provider as codex } from './codex/index';
import { provider as cursor } from './cursor/index';

const fresh = {
  autoApprove: true,
  initialPrompt: 'do it',
  sessionId: 'conv-1',
  isResuming: false,
};

describe('OZdash preset command lines', () => {
  it('claude: session id, skip permissions, model, effort, prompt', () => {
    const command = claude.behavior.prompt!.buildCommand({
      ...fresh,
      cli: 'claude',
      model: 'opus',
      effort: 'high',
    });

    expect(command.args).toEqual([
      '--session-id',
      'conv-1',
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'high',
      'do it',
    ]);
  });

  it('codex: full-access config, free-form model, reasoning effort, prompt', () => {
    const command = codex.behavior.prompt!.buildCommand({
      ...fresh,
      cli: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'high',
    });

    expect(command.args).toEqual([
      '-c',
      'approval_policy=never',
      '-c',
      'sandbox_mode=danger-full-access',
      '--dangerously-bypass-hook-trust',
      '-m',
      'gpt-6.1-sol',
      '-c',
      'model_reasoning_effort=high',
      'do it',
    ]);
  });

  it('cursor: force + approve MCPs, model, no effort flag, prompt', () => {
    const command = cursor.behavior.prompt!.buildCommand({
      ...fresh,
      cli: 'cursor-agent',
      model: 'cursor-grok-4.6-high',
      effort: 'high',
    });

    expect(command.args).toEqual([
      '-f',
      '--approve-mcps',
      '--model',
      'cursor-grok-4.6-high',
      'do it',
    ]);
  });

  it('leaves out model and effort when they are empty', () => {
    const command = claude.behavior.prompt!.buildCommand({
      ...fresh,
      cli: 'claude',
      autoApprove: false,
      model: '',
    });

    expect(command.args).toEqual(['--session-id', 'conv-1', 'do it']);
  });
});
