import { Alert } from '@emdash/ui/react/primitives';

export function SkillsInfoBox() {
  return (
    <Alert.Root status="info" icon={null}>
      <Alert.Description>
        Skills from the{' '}
        <a
          href="https://github.com/openai/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          OpenAI
        </a>{' '}
        and{' '}
        <a
          href="https://github.com/anthropics/skills"
          target="_blank"
          rel="noopener noreferrer"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          Anthropic
        </a>{' '}
        catalogs. Install a skill to make it available across all your coding agents. Skills follow
        the open{' '}
        <a
          href="https://agentskills.io"
          target="_blank"
          rel="noopener noreferrer"
          className="decoration-muted-foreground/40 font-medium text-foreground underline underline-offset-2 hover:decoration-foreground"
        >
          Agent Skills
        </a>{' '}
        standard.
        {/* OZdash: dropped the "let us know through the feedback modal" line. */}
      </Alert.Description>
    </Alert.Root>
  );
}
