import type { CommandContext } from '#services/agent-plugins/api/plugins/capabilities/prompt';
import type { TuiAgentStartInput } from './schemas';

/**
 * Fork (ozimakov-st): the prompt-command context the TUI runtime builds an agent command
 * from (everything but the resolved CLI path). Exported so tests can follow a start
 * input to the final command line the same way the runtime does.
 */
export function tuiPromptCommandContext(
  input: TuiAgentStartInput,
  isResuming: boolean
): Omit<CommandContext, 'cli'> {
  return {
    extraArgs: input.extraArgs,
    autoApprove: input.autoApprove ?? false,
    initialPrompt: isResuming ? undefined : input.initialPrompt,
    sessionId: input.conversationId,
    providerSessionId: input.sessionId ?? undefined,
    isResuming,
    model: input.model ?? '',
    effort: input.effort ?? undefined,
  };
}
