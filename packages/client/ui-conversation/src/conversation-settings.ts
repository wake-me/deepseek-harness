/** Durable conversation preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Field carrying the collapsed Think preview's visible line count. */
export const REASONING_PREVIEW_LINES_FIELD = 'reasoningPreviewLines'

/** Smallest collapsed Think preview: one line. */
export const MIN_REASONING_PREVIEW_LINES = 1

/** Largest collapsed Think preview: bounded so a collapsed row stays compact. */
export const MAX_REASONING_PREVIEW_LINES = 8

/** Default preserves the original inline single-line summary; wider windows are opt-in. */
export const DEFAULT_REASONING_PREVIEW_LINES = 1

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Visible wrapped-line count of a collapsed Think preview. */
  reasoningPreviewLines: number
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [REASONING_PREVIEW_LINES_FIELD]: z.number().step(1)
    .min(MIN_REASONING_PREVIEW_LINES)
    .max(MAX_REASONING_PREVIEW_LINES)
    .default(DEFAULT_REASONING_PREVIEW_LINES),
})
