// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

const useStubPreviewLines = <S,>(select: (value: number) => S): S => select(1)

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('follows the latest streaming line, then restores the settled first line', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    expect(view.getByText('Newest reasoning tokens').parentElement?.getAttribute('data-follow-end'))
      .toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    expect(view.getByText('Newest reasoning tokens keep arriving').parentElement
      ?.getAttribute('data-follow-end')).toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    const settledSummary = view.getByText('Inspect the session')
    expect(view.queryByText('运行中')).toBeNull()
    expect(settledSummary.parentElement?.hasAttribute('data-follow-end')).toBe(false)
  })

  it('renders the multi-line streaming window when the count is above one', () => {
    const useFourLines = <S,>(select: (value: number) => S): S => select(4)
    const streamingText = 'plan step one\nplan step two\nplan step three\nplan step four\nplan step five'
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: streamingText }]}
        streaming
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useFourLines}
      />,
    )
    // The window replaces the inline summary and shows the whole streamed text.
    expect(view.container.querySelector('[data-reasoning-preview="4"]')).toBeTruthy()
    expect(view.container.querySelector('[data-follow-end]')).toBeNull()

    // The line-count variable must ride the root: custom properties inherit
    // downward only, so a value set on the window itself cannot reach the root
    // height calc that reserves the window's lines.
    expect(view.container.querySelector<HTMLElement>('[data-preview]')
      ?.style.getPropertyValue('--reasoning-preview-lines')).toBe('4')
    expect(view.container.querySelector<HTMLElement>('[data-reasoning-preview]')
      ?.style.getPropertyValue('--reasoning-preview-lines')).toBe('')

    // Settlement unmounts the window and restores the single-line posture.
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: streamingText }]}
        streaming={false}
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useFourLines}
      />,
    )
    expect(view.container.querySelector('[data-reasoning-preview]')).toBeNull()
    expect(view.getByText('plan step one').parentElement?.hasAttribute('data-follow-end')).toBe(false)
  })

  it('settles on the first non-blank line when reasoning opens with newlines', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: '\n\nAnalyze the request\nDraft the plan' }]}
        streaming={false}
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    expect(view.getByText('Analyze the request')).toBeTruthy()
  })

  it('expands from either Think or the reasoning summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('思考'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded Think drops the inline summary and renders plain prose, no IN card', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages} reasoningPreviewLines={useStubPreviewLines}
      />,
    )
    fireEvent.click(view.getByText('思考'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })
})
