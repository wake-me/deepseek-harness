/** General Settings row for the streaming Think preview window's line count. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { MAX_REASONING_PREVIEW_LINES, MIN_REASONING_PREVIEW_LINES } from '../../conversation-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface PreviewLinesRowInjected {
  hooks: {
    /** Persisted preview line-count preference bound as usePreviewLines. */
    previewLines: SnapshotStore<number>
  }
  /** Change the streaming preview window's line count. */
  setPreviewLines: (count: number) => void
}

/** Full Settings-row props. */
export type PreviewLinesRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<PreviewLinesRowInjected>

const OPTIONS: readonly {
  id: number
  label: ConversationKey
  count?: number
}[] = [
  { id: 1, label: 'settings.preview.original' },
  ...Array.from(
    { length: MAX_REASONING_PREVIEW_LINES - 1 },
    (_, index): { id: number; label: ConversationKey; count: number } => {
      const count = index + 2
      return { id: count, label: 'settings.preview.lines', count }
    },
  ),
]

/**
 * Render the streaming Think preview window's line-count selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function PreviewLinesRow({ usePreviewLines, setPreviewLines, t }: PreviewLinesRowProps) {
  const count = usePreviewLines(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.preview.title')}</div>
        <div className={css.desc}>{t('settings.preview.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({
          id: String(option.id),
          label: option.count === undefined ? t(option.label) : t(option.label, { count: option.count }),
        }))}
        selectedId={String(count)}
        onSelect={(id) => {
          setOpen(false)
          const next = Number(id)
          if (next >= MIN_REASONING_PREVIEW_LINES && next <= MAX_REASONING_PREVIEW_LINES) setPreviewLines(next)
        }}
        align="end"
        portal
        anchor={(
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
        )}
      />
    </div>
  )
}
