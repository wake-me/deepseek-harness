# Agent Note: Configurable Think preview line count

Status: implemented

English | [中文](2026-08-17-configurable-reasoning-preview-lines.zh.md)

## Problem

The collapsed Think row showed exactly one line of reasoning: `ReasoningRow` extracted `firstLine`/`latestLine` from the block, CSS forced `white-space: nowrap`, and a horizontal `scrollLeft` follower chased the streaming tail ([why the follower tracks real deltas](2026-08-02-web-thinking-tail-scroll.md)). Single-line output makes long reasoning unreadable in the collapsed posture, and no setting existed to widen it. The `DisclosureRow` primitive's header row is a fixed 24px strip, so a multi-line preview cannot live inside the header.

## Decision

**The count is a durable `ui-conversation` preference with two edit paths over one value.** `conversation-settings.ts` (renamed from `submission-settings.ts`, which the file had outgrown) gains `reasoningPreviewLines`: integer 1–8, default 1, validated by the same Host schema that owns `busyEnter`. A `ReasoningPreviewPolicy` mirrors the section into a `SnapshotStore` exactly the way `ComposerSubmissionPolicy` does — `setLines` additionally writes the durable field through the scope (optimistic live publish, then `host.set`), mirroring `setBusyEnter`. Apply passes the policy's store into the `assistant-step` node registration's `inject` `hooks` compartment, and `AssistantNodeView` reads it as `useReasoningPreviewLines` and threads the count down through `AssistantMarkdown` as a plain prop. The General settings section carries a `PreviewLinesRow` selector (registered beside the Composer Enter row, sharing its row CSS module) that reads the policy's store and writes through `setLines`, so `settings.yaml` editing and the UI row stay consistent through the settings scope's revision fencing.

**Count 1 (and the missing-field default) renders the original inline posture unchanged.** The summary stays inside the `DisclosureRow` header next to the title — the settled `firstLine`, or the latest non-blank line while streaming — chased horizontally by its one-line scrollport. Nothing about the header's geometry or the follower differs from the pre-setting row, so an unconfigured deployment keeps the upstream look.

**Counts 2–8 mount a preview window only while the block streams; settlement always returns to the inline posture.** The window posture is gated on `running` as well as the count: while the reasoning block is the streaming tail, `ReasoningRow` renders the `DisclosureRow` header (icon, title, chevron, click/keyboard toggle unchanged) followed by a preview `<div>` that exists only while collapsed and the text is non-empty, carrying the complete streamed text under `max-height: calc(var(--reasoning-preview-lines) * 24px)` with `overflow: hidden`; the frame-throttled follower sets `scrollTop` to the tail (the same overflow-hidden programmatic scrolling the horizontal version uses, rotated vertically). Clicking the window toggles like the header, preserving the old expand-from-summary affordance. On settlement the window unmounts and the row renders the inline first-line summary every settled row already uses — the multi-line posture exists exactly when watching the model think has value, and long transcripts keep one-line Think rows regardless of the setting. The judgment is a pure function of existing props (`running` from the durable turn status, `previewLines` from the settings mirror); no component state, listener, or effect is added, and memoized historical rows never re-render for it.

## Alternatives considered

**Keep the summary inside the `DisclosureRow` header for every count.** Rejected: the header row's fixed 24px height is the primitive's contract with every other flow row; growing it per-state would reshape Tool and context rows too. Putting the title and a multi-line preview on one line would also shrink the preview's width to the remainder after the title and make its scroll window wrap inconsistently with the lines below.

**Make the multi-line window the default.** Rejected: it changes the collapsed geometry for every user without an opt-in and maximizes divergence from upstream in this fork; the wider window is a preference users ask for by writing the field.

**Clamp the settled window to the head lines instead of returning to the inline posture.** Rejected: the multi-line posture only pays for itself while output is moving; once settled it occupies vertical space in every historical row without a watching need, and the settled first-line summary already serves revisits. The clamp CSS died with this rejection — the window exists solely while running.

**Clamp to the head only, dropping the streaming tail-follow.** Rejected: the tail-follow is what makes throughput legible while a model works; it is the only reason the window posture exists.

**A per-session store or component-local state for the count.** Rejected: the preference is cross-session and durable, so the settings scope plus an inject-bound observable (the established `busyEnter` pattern) is the owning channel; anything else would create a second source of truth.

**Ship a Settings UI row now.** Initially deferred while no consumer asked; the deployment's own usage asked, so a General-section selector row (`PreviewLinesRow`, order after the Composer Enter row) now ships. The heavyweight rc.7 plugin-configuration cards were considered and rejected for this field: their staging/discard/save form exists for Host plugin configuration surfaces, not a single validated integer in a section this package already owns through a live scope.

## Consequences

An unconfigured deployment renders the original single-line Think row, and with any configuration every settled row renders that same inline posture — only the streaming tail may mount a multi-line window whose geometry comes from one CSS variable, so a future Settings row only needs to write the durable field. Streaming tail-following survives in both postures — horizontal `scrollLeft` pinning inline, vertical `scrollTop` pinning in the window — keeping the real-delta cadence signal. The window lives outside the `DisclosureRow` header and only while streaming, so other disclosure rows (Tool, context) and every settled row are untouched; the settle transition is one render of the streaming row itself (window unmount, inline span mount) with no effect on memoized siblings. Settled rows keep their full text in the inline summary's parent block and expand to the complete reasoning. The `submission-settings.ts` module is now `conversation-settings.ts`; imports renamed in the same change with no compatibility surface (pre-release stance).

## Testing

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` pins both postures: the default inline summary without a preview element, the inline horizontal tail-follow (`scrollLeft = scrollWidth - clientWidth` after throttled frames) with settlement reset, expansion from both the header and the inline summary, the windowed vertical tail-follow (`scrollTop = scrollHeight - clientHeight`) with settlement unmounting the window back to the inline first line, window collapse restoring the window while still running, the configured line count reaching the CSS variable, and the empty-text guard. `tests/reasoning-preview-policy.client.spec.ts` covers scope adoption, change-following, absent-section retention, `setLines` writing through the scope with identical-write skipping and a process-local fallback, and no write-back from adoption; `tests/preview-lines-row.client.spec.tsx` pins the General-section row's copy, selection write-through, and external-change follow; `tests/host.client.spec.ts` extends the durable-section contract to the new field including 0, 9, and fractional rejections.


## Port to ui-chat (2026-09-03, dsh v0.1.2-rc.1)

The 0.1.2 restructure split `ui-conversation` and moved the chat layer to
`ui-chat`; the feature was retired from the old paths during the rc.1 sync
and re-landed inside `ui-chat`, self-contained:

- `reasoningPreviewLines` joins `transcriptView` in the `ui-chat` Host
  settings section (`chat-settings.ts`), persisted beside it.
- `ReasoningPreviewPolicy` mirrors `TranscriptViewPolicy` (adopt-only reads,
  explicit writes), and the line count reaches `ReasoningRow` as owner
  currency (`useReasoningPreviewLines` on `ChatNodeOwnerProps`) instead of a
  ui-conversation-scoped store.
- The streaming window keeps the same shape (exists only while running,
  replaces the inline summary, unmounts on settlement), but tail-following is
  now pure CSS: the window is a flex column aligned to the block end, so
  overflow clips from the top and the newest lines stay visible without JS
  scrolling. The row grows via `data-preview` instead of the old JS height.
- The Settings row registers as `reasoning-preview-lines` (order 13, beside
  transcript-view) with copy moved into the `chat` locale namespace.
