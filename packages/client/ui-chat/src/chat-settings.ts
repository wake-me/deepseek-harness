/** Chat transcript preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Default preserves the compact process disclosure introduced by Chat. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'

/** Field carrying the streaming reasoning preview window line count. */
export const REASONING_PREVIEW_LINES_FIELD = 'reasoningPreviewLines'

/** Preview window line counts accepted at settings boundaries. */
export const REASONING_PREVIEW_LINES_VALUES = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** Streaming reasoning preview window line count. */
export type ReasoningPreviewLines = typeof REASONING_PREVIEW_LINES_VALUES[number]

/** Default preserves the shipped inline single-line summary. */
export const DEFAULT_REASONING_PREVIEW_LINES: ReasoningPreviewLines = 1

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content. */
  transcriptView: TranscriptViewMode
  /** Streaming reasoning preview window line count; 1 keeps one line. */
  reasoningPreviewLines: ReasoningPreviewLines
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
  [REASONING_PREVIEW_LINES_FIELD]: z.union([...REASONING_PREVIEW_LINES_VALUES]).default(DEFAULT_REASONING_PREVIEW_LINES),
})
