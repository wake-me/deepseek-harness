// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { PreviewLinesRow } from '../src/client/settings/PreviewLinesRow.tsx'
import type { PreviewLinesRowProps } from '../src/client/settings/PreviewLinesRow.tsx'
import { ReasoningPreviewPolicy } from '../src/client/chat/reasoning-preview-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount() {
  const policy = new ReasoningPreviewPolicy()
  const setPreviewLines = vi.fn((count: number) => { policy.setLines(count) })
  const props: PreviewLinesRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    usePreviewLines: bindSnapshotSelector(policy.lines),
    setPreviewLines,
    t: makeTranslate(en),
  }
  render(<PreviewLinesRow {...props} />)
  return { policy, setPreviewLines }
}

describe('PreviewLinesRow', () => {
  it('explains the streaming-only scope and shows the original single line by default', () => {
    mount()
    expect(screen.getByText('Think streaming window lines')).toBeDefined()
    expect(screen.getByText('Applies only while reasoning streams; settled rows stay one line')).toBeDefined()
    expect(screen.getByRole('button', { name: /1 line \(original\)/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects a wider window, follows later preference changes, and closes outside', () => {
    const m = mount()
    const trigger = screen.getByRole('button', { name: /1 line \(original\)/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '5 lines' }))
    expect(m.setPreviewLines).toHaveBeenCalledWith(5)
    expect(screen.getByRole('button', { name: /5 lines/ })).toBeDefined()

    act(() => { m.policy.setLines(8) })
    const wideTrigger = screen.getByRole('button', { name: /8 lines/ })
    fireEvent.click(wideTrigger)
    expect(screen.getByRole('menuitem', { name: '1 line (original)' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: '8 lines' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: '8 lines' })).toBeNull()
  })
})
