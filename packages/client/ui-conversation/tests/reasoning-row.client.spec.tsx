// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()

function flushAnimationFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    for (const callback of callbacks) callback(index)
  }
}

beforeEach(() => {
  nextAnimationFrameId = 1
  animationFrames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('defaults to the inline single-line summary, without a preview window', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
      />,
    )
    // The default posture keeps the summary inline in the header row.
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.container.querySelector('[class*="preview"]')).toBeNull()
  })

  it('follows the latest inline streaming line to its end, then restores the settled first line', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    const summary = view.getByText('Newest reasoning tokens')
    Object.defineProperties(summary, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
    })

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(2)
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(1)
    expect(summary.scrollLeft).toBe(200)
    expect(summary.getAttribute('data-follow-end')).toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    flushAnimationFrames(3)
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.queryByText('运行中')).toBeNull()
    expect(summary.scrollLeft).toBe(0)
    expect(summary.hasAttribute('data-follow-end')).toBe(false)
  })

  it('expands from either Think or the inline summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('Think'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('follows the streaming tail vertically, then settles back to the inline single-line summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        reasoningPreviewLines={3}
        streaming
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    // The streaming window carries the whole streamed text; only its tail is visible.
    const preview = view.getByText('Inspect the session Newest reasoning tokens')
    Object.defineProperties(preview, {
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 72 },
    })

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        reasoningPreviewLines={3}
        streaming
      />,
    )
    expect(preview.scrollTop).toBe(0)
    flushAnimationFrames(2)
    expect(preview.scrollTop).toBe(0)
    flushAnimationFrames(1)
    expect(preview.scrollTop).toBe(228)

    // Settlement unmounts the window; the row returns to the inline posture.
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        reasoningPreviewLines={3}
        streaming={false}
      />,
    )
    flushAnimationFrames(3)
    expect(view.queryByText('运行中')).toBeNull()
    expect(view.container.querySelector('[class*="preview"]')).toBeNull()
    expect(view.getByText('Inspect the session')).toBeTruthy()
  })

  it('expands from the streaming window, and collapse brings the window back while still running', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        reasoningPreviewLines={3}
        streaming
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session Check persistence'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('Think'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('Inspect the session Check persistence')).toBeTruthy()
  })

  it('expanded Think drops the collapsed summary and renders plain prose, no IN card', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        reasoningPreviewLines={3}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('Think'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })

  it('sizes the streaming window from the configured line count', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'One line of reasoning' }]}
        reasoningPreviewLines={5}
        streaming
      />,
    )
    expect(view.getByText('One line of reasoning').style.getPropertyValue('--reasoning-preview-lines')).toBe('5')
  })

  it('renders no window for empty reasoning text while streaming', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: '' }]}
        reasoningPreviewLines={3}
        streaming
      />,
    )
    expect(view.getByText('Think')).toBeTruthy()
    expect(view.container.querySelector('[class*="preview"]')).toBeNull()
  })
})
