/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { DEFAULT_REASONING_PREVIEW_LINES } from '../../conversation-settings.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row. The
 * default single line keeps the summary inline next to the title — the
 * settled first line, or the latest non-blank line while streaming, chased
 * horizontally by its one-line scrollport. A configured count of 2–8 swaps
 * it for a multi-line window under the header that follows the tail
 * vertically while streaming and clamps to the head lines with an ellipsis
 * once settled. Expanding either posture swaps the preview for the complete
 * reasoning prose.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.previewLines - visible wrapped-line count of the collapsed preview.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({
  text,
  running,
  previewLines = DEFAULT_REASONING_PREVIEW_LINES,
  t,
}: {
  text: string
  running: boolean
  previewLines?: number | undefined
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const windowed = previewLines > 1
  const summary = running ? latestLine(text) : firstLine(text)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  const schedulePreviewScroll = useThrottledVisualUpdate(() => {
    const element = previewRef.current
    if (element === null) return
    element.scrollTop = running ? element.scrollHeight - element.clientHeight : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])
  useEffect(() => {
    schedulePreviewScroll()
  }, [running, schedulePreviewScroll, text])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={windowed ? undefined : (
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
      {windowed && !expanded && text.length > 0 && (
        <div
          ref={previewRef}
          className={css.preview}
          data-follow-end={running || undefined}
          style={{ '--reasoning-preview-lines': previewLines } as CSSProperties}
          onClick={() => { setExpanded(value => !value) }}
        >
          {text}
        </div>
      )}
    </div>
  )
}
