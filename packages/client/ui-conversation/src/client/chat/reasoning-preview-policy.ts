/**
 * Reasoning-preview policy: owns the live collapsed Think preview line count
 * and mirrors the durable `ui-conversation` section the same way the composer
 * submission policy does. The General settings row writes through `setLines`;
 * adoption from the scope never writes back.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_REASONING_PREVIEW_LINES, REASONING_PREVIEW_LINES_FIELD,
} from '../../conversation-settings.ts'
import type { ConversationSettings } from '../../conversation-settings.ts'

/** Live reasoning-preview preference read by the chat node views. */
export class ReasoningPreviewPolicy {
  /** Reactive preview line-count source for the assistant-step inject face. */
  readonly lines: SnapshotStore<number> = createSnapshotStore(DEFAULT_REASONING_PREVIEW_LINES)

  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the streaming preview window's line count; the live value
   * publishes before the durable write starts.
   * @param count - accepted window size in wrapped lines.
   */
  setLines(count: number): void {
    if (this.lines.getSnapshot() === count) return
    this.lines.set(count)
    void this.host?.set(REASONING_PREVIEW_LINES_FIELD, count)
  }

  /**
   * Adopt the scope's accepted durable count without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.lines.getSnapshot() === section.reasoningPreviewLines) return
    this.lines.set(section.reasoningPreviewLines)
  }
}
