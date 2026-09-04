/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { useState, type CSSProperties } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const visible = text.trimStart()
  const newline = visible.indexOf('\n')
  return newline === -1 ? visible : visible.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.reasoningPreviewLines - live preview line-count store.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, reasoningPreviewLines, t }: {
  text: string
  running: boolean
  reasoningPreviewLines: SnapshotSelectorHook<number>
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const previewLines = reasoningPreviewLines(value => value)
  const windowed = running && previewLines > 1
  const summary = running ? latestLine(text) : firstLine(text)

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={windowed || undefined}
      style={windowed ? { '--reasoning-preview-lines': previewLines } as CSSProperties : undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={windowed ? undefined : (
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-follow-end={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
      {windowed && !expanded && text.length > 0 && (
        <div
          className={css.preview}
          data-reasoning-preview={previewLines}
          onClick={() => { setExpanded(value => !value) }}
        >
          {text}
        </div>
      )}
    </div>
  )
}
