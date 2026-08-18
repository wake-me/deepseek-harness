/**
 * Reasoning-preview policy: owns the live collapsed Think preview line count
 * and mirrors the durable `ui-conversation` section the same way the composer
 * submission policy does. No setter lives here yet — the count is a deployment
 * preference edited in the settings document, not a per-view control.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_REASONING_PREVIEW_LINES } from '../../conversation-settings.ts'
import type { ConversationSettings } from '../../conversation-settings.ts'

/** Live reasoning-preview preference read by the chat node views. */
export class ReasoningPreviewPolicy {
  /** Reactive preview line-count source for the assistant-step inject face. */
  readonly lines: SnapshotStore<number> = createSnapshotStore(DEFAULT_REASONING_PREVIEW_LINES)

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
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
