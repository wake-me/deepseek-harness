/** Host-backed streaming reasoning preview window policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_REASONING_PREVIEW_LINES, REASONING_PREVIEW_LINES_FIELD,
  type ChatSettings, type ReasoningPreviewLines,
} from '../chat-settings.ts'

/** Live preview line count consumed by the Think row and its Settings row. */
export class ReasoningPreviewPolicy {
  /** Reactive current count; defaults to one line before Host settings arrive. */
  readonly lines: SnapshotStore<ReasoningPreviewLines> = createSnapshotStore(DEFAULT_REASONING_PREVIEW_LINES)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param count - window line count from the accepted values.
   */
  setLines(count: ReasoningPreviewLines): void {
    if (this.lines.getSnapshot() === count) return
    this.lines.set(count)
    void this.host.set(REASONING_PREVIEW_LINES_FIELD, count)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || this.lines.getSnapshot() === section.reasoningPreviewLines) return
    this.lines.set(section.reasoningPreviewLines)
  }
}
