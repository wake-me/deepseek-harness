/** General Settings row for the streaming Think preview window line count. */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReasoningPreviewLines } from '../../chat-settings.ts'
import { REASONING_PREVIEW_LINES_VALUES } from '../../chat-settings.ts'
import css from './PreviewLinesRow.module.css'

/** Registration-side preview preference face. */
export interface PreviewLinesRowInjected {
  hooks: {
    /** Persisted preview preference bound as useReasoningPreviewLines. */
    reasoningPreviewLines: SnapshotStore<ReasoningPreviewLines>
  }
  /** Change the streaming preview window line count. */
  setReasoningPreviewLines: (count: ReasoningPreviewLines) => void
}

/** Full Settings-row props. */
export type PreviewLinesRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<PreviewLinesRowInjected>

/**
 * Render the streaming Think preview line-count selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function PreviewLinesRow({ useReasoningPreviewLines, setReasoningPreviewLines, t }: PreviewLinesRowProps) {
  const count = useReasoningPreviewLines(value => value)
  const [open, setOpen] = useState(false)
  const closeMenu = () => { setOpen(false) }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {count === 1 ? t('settings.preview.original') : t('settings.preview.lines', { count })}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.preview.title')}</div>
        <div className={css.desc}>{t('settings.preview.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={REASONING_PREVIEW_LINES_VALUES.map(value => ({
          id: String(value),
          label: value === 1 ? t('settings.preview.original') : t('settings.preview.lines', { count: value }),
        }))}
        selectedId={String(count)}
        onSelect={(id) => {
          closeMenu()
          setReasoningPreviewLines(Number(id) as ReasoningPreviewLines)
        }}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
