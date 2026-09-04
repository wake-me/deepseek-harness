# Agent Note: Reasoning preview window height and settled summary fixes

Status: implemented

English | [中文](2026-09-04-reasoning-preview-display-fixes.zh.md)

## Problem

Two display defects shipped with the ui-chat port of the configurable preview window (ea929237a2). First, the streaming window always showed exactly one line no matter which count was configured — the symptom was independent of the value, because the root height calc fell back to its `1` literal for every count. Second, the settled inline summary rendered blank whenever reasoning opened with newlines; Qwen3.8 served through omlx emits every reasoning block with a leading `\n`, so for that model every settled Think row lost its summary.

## Decision

The window line count is now declared once, on the row root: `--reasoning-preview-lines` rides the root's inline style, gated on the same `windowed` condition as `data-preview`. Both consumers resolve it there — the root's `[data-preview]:not([data-expanded])` height calc reads its own inline declaration, and the window's `max-height` reads it through inheritance. The porting bug was declaring the property on the window element itself: custom properties inherit downward only, so the root height calc that reserves the window's lines could never see a value set on the window, and the contained root clipped the window to one line. A regression test pins the placement — the root must carry the variable and the window must not — because JSDOM executes no CSS calc or inheritance and cannot observe the height link itself.

`firstLine` now `trimStart`s the text before slicing the first line, so the settled summary shows the first non-blank line. This deviates from the upstream `firstLine`, which slices at the first newline and returns an empty string for leading newlines; keep the `trimStart` across future syncs unless upstream starts skipping leading whitespace itself. `latestLine` stays untouched: trailing blanks are already covered by its `trimEnd`, and leading newlines fall out of its `lastIndexOf` slice.

## Alternatives considered

**Compute the window geometry in JS.** Rejected: the port's design is a zero-JS tail-follow — a flex column with `justify-content: flex-end` clips from the top and keeps the newest lines visible; the only defect was where the count variable was declared.

**Declare the variable on the window and repeat the count in the root's style attribute.** Rejected: one declaration on the root serves both consumers; duplicating the value invites drift between the height reservation and the window cap.

**Normalize leading whitespace at the render boundary or in the stream projection.** Rejected in the rc.8-era deferral and still rejected: both change the meaning of the stored reasoning text for a presentation-only problem that `firstLine` owns.

## Consequences

Configured counts of 2–8 lines now show that many streaming lines, and settled rows show the first non-blank line for models that open reasoning with newlines. Rows configured at one line and unconfigured deployments render exactly the upstream posture. The CSS-variable placement is guarded by unit assertions; the actual height link required browser verification because JSDOM performs no layout.
