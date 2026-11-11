// Fork (ozimakov-st): OZ chat composer. The stock ChatComposer (drafts, @files, /commands,
// queue, images) with fewer controls: send/stop and attach. Model, effort, mode and the
// other agent options live under one "⋯" menu, with a small model chip next to it.
import { providerChoices, type ProviderConfigOption } from '@emdash/core/runtimes/acp/api/client';
import { ChatComposer } from '@emdash/ui/react/components';
import type {
  CommandItem,
  ComposerAttachment,
  ContextMentionProvider,
  MentionItem,
  PromptEditorRef,
} from '@emdash/ui/react/components';
import { DropdownMenu, toast } from '@emdash/ui/react/primitives';
import { ChevronDown, MoreHorizontal } from 'lucide-react';
import { observer, useObserver } from 'mobx-react-lite';
import { useCallback, useMemo, useRef } from 'react';
import { getSearchClient } from '@core/features/search/api/client';
import {
  asProvisioned,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import type { OzChatStore, OzDraftAttachment } from './chat-store';

type AcpChatStore = OzChatStore;
type AcpPromptAttachment = OzDraftAttachment;
type ImageMimeType = OzDraftAttachment['ref']['mimeType'];

const IMAGE_TYPES: Record<string, ImageMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The image type ACP accepts for a file, or null (same rule as Emdash chat). */
function imageMimeType(file: File): ImageMimeType | null {
  const declared = file.type.toLowerCase();
  const known = Object.values(IMAGE_TYPES).find((type) => type === declared);
  if (known) return known;
  return IMAGE_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

function readFileAsDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

async function uploadImage(store: AcpChatStore, file: File): Promise<AcpPromptAttachment | null> {
  const mimeType = imageMimeType(file);
  if (!mimeType) return null;
  const [previewUrl, ref] = await Promise.all([
    readFileAsDataUrl(file),
    store
      .uploadAttachment({
        source: file.stream(),
        size: file.size,
        mimeType,
        name: file.name || 'image',
      })
      .catch(() => null),
  ]);
  if (!ref) return null;
  return { ref: { type: 'attachment', id: ref.id, name: ref.name, mimeType }, previewUrl };
}

function choiceName(option: ProviderConfigOption, value: unknown): string | null {
  if (option.type !== 'select') return null;
  return providerChoices(option).find((choice) => choice.value === value)?.name ?? null;
}

/** "Opus 5.5 · High": the model and effort the session uses right now. */
function sessionChipLabel(options: readonly ProviderConfigOption[]): string | null {
  const model = options.find((option) => option.category === 'model');
  const effort = options.find((option) => option.category === 'thought_level');
  const parts = [
    model ? choiceName(model, model.currentValue) : null,
    effort ? choiceName(effort, effort.currentValue) : null,
  ].filter((part): part is string => !!part && part.toLowerCase() !== 'default');
  return parts.length ? parts.join(' · ') : null;
}

const SessionMenu = observer(function SessionMenu({ store }: { store: AcpChatStore }) {
  const options = store.providerOptions ?? [];
  const enabled = store.canSetOptions;
  const chip = sessionChipLabel(options);
  if (options.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="oz-session-chip"
        aria-label="Session options"
        disabled={!enabled}
      >
        {chip && <span>{chip}</span>}
        {chip ? <ChevronDown /> : <MoreHorizontal />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" sideOffset={6}>
        {options.map((option) =>
          option.type === 'boolean' ? (
            <DropdownMenu.CheckboxItem
              key={option.id}
              checked={option.currentValue}
              onCheckedChange={(checked) => store.setOption(option.id, checked === true)}
            >
              {option.name}
            </DropdownMenu.CheckboxItem>
          ) : (
            <DropdownMenu.Sub key={option.id}>
              <DropdownMenu.SubTrigger>
                <span>{option.name}</span>
                <span style={{ marginLeft: 'auto', paddingLeft: 12, opacity: 0.6 }}>
                  {choiceName(option, option.currentValue) ?? option.currentValue}
                </span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent>
                <DropdownMenu.RadioGroup
                  value={option.currentValue}
                  onValueChange={(value) => store.setOption(option.id, String(value))}
                >
                  {providerChoices(option).map((choice) => (
                    <DropdownMenu.RadioItem key={choice.value} value={choice.value}>
                      {choice.name}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          )
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
});

export const OzComposer = observer(function OzComposer({ store }: { store: AcpChatStore }) {
  const editorApiRef = useRef<PromptEditorRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const disabledReason = projectAvailabilityUi.getLiveActionDisabledReason(store.projectId);
  const workspaceId = useObserver(
    () => asProvisioned(getTaskStore(store.projectId, store.taskId))?.workspaceId
  );
  const attachments: ComposerAttachment[] = store.draftAttachments.map((attachment) => ({
    id: attachment.ref.id,
    name: attachment.ref.name ?? 'image',
    kind: 'image',
    previewUrl: attachment.previewUrl,
    mimeType: attachment.ref.mimeType,
  }));

  const submit = useCallback(
    (text: string) => {
      if (!text.trim() && store.draftAttachments.length === 0) return;
      store.submitPrompt(text, store.draftAttachments);
    },
    [store]
  );

  const addImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => imageMimeType(file) !== null);
      if (images.length < files.length) {
        toast.error('Only PNG, JPEG, GIF and WebP images can be attached here.');
      }
      const uploaded = (await Promise.all(images.map((file) => uploadImage(store, file)))).filter(
        (attachment): attachment is AcpPromptAttachment => attachment !== null
      );
      if (uploaded.length) store.addDraftAttachments(uploaded);
    },
    [store]
  );

  const mentionProvider = useMemo<ContextMentionProvider | undefined>(() => {
    if (!workspaceId) return undefined;
    return {
      async search(query: string): Promise<MentionItem[]> {
        const files = await (await getSearchClient()).searchWorkspaceFiles({ workspaceId, query });
        return files.map((file) => ({
          id: file.relativePath,
          label: file.relativePath,
          name: file.filename,
          kind: 'file',
          description: file.relativePath,
        }));
      },
    };
  }, [workspaceId]);

  const queryCommands = useCallback(
    async (query: string): Promise<CommandItem[]> => {
      const normalized = query.trim().toLowerCase();
      return store.commands.filter(
        (command) =>
          !normalized ||
          command.name.toLowerCase().includes(normalized) ||
          (command.description ?? '').toLowerCase().includes(normalized)
      );
    },
    [store]
  );

  const a = store.affordances;
  return (
    <div className="oz-composer">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void addImages(files);
        }}
      />
      <ChatComposer
        model={store.composerModel}
        editorApiRef={editorApiRef}
        placeholder="Ask to make changes, @mention files, run /commands"
        disabled={Boolean(disabledReason)}
        isWorking={a.isWorking}
        canSubmit={a.canSubmit}
        onSubmit={submit}
        onSubmitWhileWorking={store.liveActionsEnabled ? submit : undefined}
        onStop={a.canCancel ? () => store.stop() : undefined}
        queuedPrompts={store.queuedPrompts}
        onEditQueuedPrompt={(id, text) => store.editQueuedPrompt(id, text)}
        onDeleteQueuedPrompt={(id) => store.deleteQueuedPrompt(id)}
        onReorderQueuedPrompts={(ids) => store.reorderQueuedPrompts(ids)}
        onSendQueuedPromptNow={(id) => store.sendQueuedPromptNow(id)}
        mentionProvider={mentionProvider}
        queryCommands={queryCommands}
        attachments={attachments}
        onAttachmentsChange={(next) => {
          const keep = new Set(next.map((attachment) => attachment.id));
          for (const attachment of attachments)
            if (!keep.has(attachment.id)) store.removeDraftAttachment(attachment.id);
        }}
        onAttach={store.liveActionsEnabled ? () => fileInputRef.current?.click() : undefined}
        onImageFilesDropped={
          store.liveActionsEnabled ? (files) => void addImages(files) : undefined
        }
        configurationControls={<SessionMenu store={store} />}
      />
    </div>
  );
});
