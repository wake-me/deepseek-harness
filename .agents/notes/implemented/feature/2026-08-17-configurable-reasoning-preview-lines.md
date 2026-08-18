# Agent Note: Configurable Think preview line count

Status: implemented

English | [中文](2026-08-17-configurable-reasoning-preview-lines.zh.md)

## Problem

The collapsed Think row showed exactly one line of reasoning: `ReasoningRow` extracted `firstLine`/`latestLine` from the block, CSS forced `white-space: nowrap`, and a horizontal `scrollLeft` follower chased the streaming tail ([why the follower tracks real deltas](2026-08-02-web-thinking-tail-scroll.md)). Single-line output makes long reasoning unreadable in the collapsed posture, and no setting existed to widen it. The `DisclosureRow` primitive's header row is a fixed 24px strip, so a multi-line preview cannot live inside the header.

## Decision

**The count is a durable `ui-conversation` preference with the single-line posture as its default.** `conversation-settings.ts` (renamed from `submission-settings.ts`, which the file had outgrown) gains `reasoningPreviewLines`: integer 1–8, default 1, validated by the same Host schema that owns `busyEnter`. A `ReasoningPreviewPolicy` mirrors the section into a `SnapshotStore` exactly the way `ComposerSubmissionPolicy` does; apply passes the policy's store into the `assistant-step` node registration's `inject` `hooks` compartment, and `AssistantNodeView` reads it as `useReasoningPreviewLines` and threads the count down through `AssistantMarkdown` as a plain prop. No Settings row ships yet — the count is edited in `settings.yaml`, matching how the deployment already manages this namespace.

**Count 1 (and the missing-field default) renders the original inline posture unchanged.** The summary stays inside the `DisclosureRow` header next to the title — the settled `firstLine`, or the latest non-blank line while streaming — chased horizontally by its one-line scrollport. Nothing about the header's geometry or the follower differs from the pre-setting row, so an unconfigured deployment keeps the upstream look.

**Counts 2–8 swap the inline summary for a preview block under the header.** `ReasoningRow` renders the `DisclosureRow` header (icon, title, chevron, click/keyboard toggle unchanged) followed by a preview `<div>` that exists only while collapsed and the text is non-empty. Clicking the preview toggles like the header, preserving the old expand-from-summary affordance. While running, the block carries the complete streamed text under `max-height: calc(var(--reasoning-preview-lines) * 24px)` with `overflow: hidden`, and the frame-throttled follower sets `scrollTop` to the tail (the same overflow-hidden programmatic scrolling the horizontal version uses, rotated vertically). On settlement the same element clamps to the head lines through `-webkit-line-clamp: var(--reasoning-preview-lines)` with an ellipsis on the last visible line. CSS does all window line accounting, so wrapped lines count as lines.

## Alternatives considered

**Keep the summary inside the `DisclosureRow` header for every count.** Rejected: the header row's fixed 24px height is the primitive's contract with every other flow row; growing it per-state would reshape Tool and context rows too. Putting the title and a multi-line preview on one line would also shrink the preview's width to the remainder after the title and make its scroll window wrap inconsistently with the lines below.

**Make the multi-line window the default.** Rejected: it changes the collapsed geometry for every user without an opt-in and maximizes divergence from upstream in this fork; the wider window is a preference users ask for by writing the field.

**Clamp to the head only, dropping the streaming tail-follow.** Rejected: the tail-follow is what makes throughput legible while a model works; only the settled state benefits from head clamping, so the two states keep their own CSS modes over one element.

**A per-session store or component-local state for the count.** Rejected: the preference is cross-session and durable, so the settings scope plus an inject-bound observable (the established `busyEnter` pattern) is the owning channel; anything else would create a second source of truth.

**Ship a Settings UI row now.** Deferred: the deployment editing `settings.yaml` already configures this namespace; a selector row adds copy, locale, and surface area without a requesting consumer.

## Consequences

An unconfigured deployment renders the original single-line Think row; writing `reasoningPreviewLines: 2–8` opts into a multi-line window whose geometry comes from one CSS variable, so a future Settings row only needs to write the durable field. Streaming tail-following survives in both postures — horizontal `scrollLeft` pinning inline, vertical `scrollTop` pinning in the window — keeping the real-delta cadence signal. The windowed preview lives outside the `DisclosureRow` header, so other disclosure rows (Tool, context) are untouched. Settled windows keep their full DOM text and clamp visually, so expansion reveals the complete block and assistive technology reads the same text. The `submission-settings.ts` module is now `conversation-settings.ts`; imports renamed in the same change with no compatibility surface (pre-release stance).

## Testing

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` pins both postures: the default inline summary without a preview element, the inline horizontal tail-follow (`scrollLeft = scrollWidth - clientWidth` after throttled frames) with settlement reset, expansion from both the header and the inline summary, the windowed vertical tail-follow (`scrollTop = scrollHeight - clientHeight`), the settlement reset to a clamped head preview, expansion from both the header and the preview, the configured line count reaching the CSS variable, and the empty-text guard. `tests/reasoning-preview-policy.client.spec.ts` covers scope adoption, change-following, absent-section retention, and no write-back; `tests/host.client.spec.ts` extends the durable-section contract to the new field including 0, 9, and fractional rejections.
