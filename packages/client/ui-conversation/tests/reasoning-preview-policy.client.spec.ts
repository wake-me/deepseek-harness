// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_REASONING_PREVIEW_LINES } from '../src/conversation-settings.ts'
import { ReasoningPreviewPolicy } from '../src/client/chat/reasoning-preview-policy.ts'
import type { ConversationSettings } from '../src/conversation-settings.ts'

describe('ReasoningPreviewPolicy', () => {
  it('defaults without a scope', () => {
    expect(new ReasoningPreviewPolicy().lines.getSnapshot()).toBe(DEFAULT_REASONING_PREVIEW_LINES)
  })

  it('adopts a standing section, follows later changes, and never writes back', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'queue', reasoningPreviewLines: 5 }, revision: 1, writable: true })
    const policy = new ReasoningPreviewPolicy(host.scope)
    expect(policy.lines.getSnapshot()).toBe(5)
    host.publish({ value: { busyEnter: 'queue', reasoningPreviewLines: 8 }, revision: 2 })
    expect(policy.lines.getSnapshot()).toBe(8)
    host.publish({ value: { busyEnter: 'queue', reasoningPreviewLines: 8 }, revision: 3 })
    expect(policy.lines.getSnapshot()).toBe(8)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('keeps the live value when a later section is absent', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'queue', reasoningPreviewLines: 5 }, revision: 1, writable: true })
    const policy = new ReasoningPreviewPolicy(host.scope)
    host.publish({ value: undefined, revision: 2 })
    expect(policy.lines.getSnapshot()).toBe(5)
  })
})
