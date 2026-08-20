import { memo, useMemo } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Registration-side preview preference face. */
export interface AssistantStepInjected {
  hooks: {
    /** Durable preview line-count preference bound as useReasoningPreviewLines. */
    reasoningPreviewLines: SnapshotStore<number>
  }
}

/** Full assistant-step node props including the injected preview preference. */
export type AssistantNodeViewProps =
  ChatNodeViewProps<'assistant-step'>
  & InjectFace<AssistantStepInjected>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, renderMessageImages, fileMentions, useReasoningPreviewLines, t,
}: AssistantNodeViewProps) {
  const data = node.data
  const previewLines = useReasoningPreviewLines(value => value)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      reasoningPreviewLines={previewLines}
      t={t}
    />
  )
})
