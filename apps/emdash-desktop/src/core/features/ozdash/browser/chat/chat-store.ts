// Fork (ozimakov-st): what OZ chat needs from a chat session. It is the public surface
// of Emdash's `AcpChatStore` (conversations feature), written out here because a feature
// may not import another feature's browser internals. The ACP tab passes its store in.
import type { ChatState } from '@emdash/chat-ui';
import type {
  AcpSessionStartMode,
  AgentState,
  PromptAttachment,
  ProviderConfigOption,
} from '@emdash/core/runtimes/acp/api/client';
import type { AttachmentMimeType, AttachmentRef } from '@emdash/core/services/attachments/api';
import type {
  CommandItem,
  ComposerQueuedPrompt,
  PromptEditorModel,
} from '@emdash/ui/react/components';
import type { BlobSource } from '@emdash/wire/rpc';

export type OzDraftAttachment = {
  ref: Extract<PromptAttachment, { type: 'attachment' }>;
  previewUrl?: string;
};

export type OzChatStore = {
  readonly conversationId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly chatState: ChatState;
  readonly composerModel: PromptEditorModel;
  readonly session: { agents: { current(): AgentState[] } } | null;
  readonly loadError: { kind: string; message: string } | null;
  readonly historyKnown: boolean;
  readonly historyLoading: boolean;
  readonly messageCount: number;
  readonly isEmpty: boolean;
  readonly liveActionsEnabled: boolean;
  readonly affordances: { isWorking: boolean; canSubmit: boolean; canCancel: boolean };
  readonly permissionQueue: ReadonlyArray<{
    requestId: string;
    options: Array<{ optionId: string; name: string; kind: string }>;
  }>;
  readonly queuedPrompts: ComposerQueuedPrompt[];
  readonly commands: CommandItem[];
  readonly providerOptions: ProviderConfigOption[] | undefined;
  readonly canSetOptions: boolean;
  readonly draftAttachments: OzDraftAttachment[];
  retry(options?: { mode?: AcpSessionStartMode }): void;
  submitPrompt(text: string, attachments?: OzDraftAttachment[]): void;
  stop(): void;
  resolvePermission(optionId: string): void;
  setOption(configId: string, value: string | boolean): void;
  editQueuedPrompt(id: string, text: string): void;
  deleteQueuedPrompt(id: string): void;
  reorderQueuedPrompts(ids: string[]): void;
  sendQueuedPromptNow(id: string): void;
  addDraftAttachments(attachments: OzDraftAttachment[]): void;
  removeDraftAttachment(id: string): void;
  uploadAttachment(input: {
    mimeType: AttachmentMimeType;
    name?: string;
    source: BlobSource;
    size?: number;
  }): Promise<AttachmentRef | null>;
};
