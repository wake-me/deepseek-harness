# Agent Note: Source launches default back to link resolution

Status: implemented

English | [中文](2026-09-21-source-launch-link-default.zh.md)

## Problem

v0.1.6-alpha.2 flipped the non-packaged profile resolution default from `link` to `runtime` (upstream 9ddef327a4). Under the tsx source launch the runtime router resolves Loader plugin entries through package exports to `lib/index.js` while the CLI's own module graph projects workspace imports to `src/` through tsconfig paths, so one process loads `dsh-tools` twice. The two `TOOL_RUNTIME_SCHEDULER` symbols do not match, and every tool dispatch dies with `Cannot read properties of undefined (reading 'prepare')` in `tool-calls.ts`. With no built `lib/` present the same mode instead fails startup loudly (`dsh-tools failed to import`). Upstream confirmed the regression in discussion #7273; their gates miss it because the real-API e2e runs built artifacts and the source-launch smoke only asserts the TTY refusal.

## Decision

`apps/cli/src/profile-boot.ts` keeps the packaged default `runtime` but restores `link` as the non-packaged default — the same local patch recommended in #7273. Verified by headless bash smoke: `runtime` default fails on every tool call, `link` default runs clean; a fresh checkout without built `lib/` fails startup under `runtime`.

## Alternatives considered

**Run the compiled entry (`node apps/cli/lib/bin.js web`).** Rejected: the desktop shell source-launches `bin.ts` directly, and this fix keeps that launch vector working.

**Downgrade to v0.1.6-alpha.1.** Rejected: loses the v0.1.6 sync this repository carries.

## Consequences

Source launches resolve as they did through v0.1.5. This line deviates from upstream: drop it when upstream ships the real fix (unified path resolution or cross-instance symbols) referenced in #7273. Sessions aborted by the regression before the fix may keep damaged turn history; start new conversations rather than resuming them.
