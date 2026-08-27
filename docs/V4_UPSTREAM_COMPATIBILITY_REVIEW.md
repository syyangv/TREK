# v4.0.0 upstream compatibility and replacement review

**Review date:** 2026-08-27
**Fork:** `syyangv/TREK`

This review decides, one behavior at a time, when upstream v4 may replace fork
code and where a documented fork delta must remain. A clean textual merge is
not evidence that a behavioral replacement is safe.

## Review basis

- Upstream release: `v4.0.0` at `a00b84b2`.
- Fork immediately before integration: `a320f8e0`.
- v4 integration merge: `91d833a0`.
- Integration branch after focused coverage fixes: `3730fbe5`.
- Fork `origin/main` reviewed for this changeset: `e2874272` (PR #51 merge).
- Reviewed branch head before these replacements: `b8cdfbc5`.

The review used the post-merge delta against `v4.0.0`, original custom-feature
commits, focused source and test inspection, and code-review graph impact data.

## Classification

- **Upstream replacement:** v4 fully supersedes the custom implementation.
- **Upstream base + fork delta:** keep the v4 structure and reapply only the
  named custom behavior.
- **Conflict — preserve fork policy:** upstream behavior contradicts an
  intentional fork decision and must be resolved case by case.
- **Fork-only:** upstream has no equivalent capability.

## One-by-one decisions

|   # | Component or invariant                                                      | Classification                                   | Replacement decision                                                                                                                                                                                                 |
| --: | --------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Instance-wide Google Places credential                                      | **Upstream replacement — completed**             | Use v4 `PLACES_API_KEY` through `app-config`. Do not restore `GOOGLE_MAPS_API_KEY`; rename the runtime secret before deployment.                                                                                     |
|   2 | Vacay active-year selection                                                 | **Upstream replacement — completed**             | Use v4 `defaultPeriodYear`, which supports calendar, fiscal, and anniversary periods. Remove the unused calendar-only `defaultVacayYear`.                                                                            |
|   3 | Vacay locale mappings (`vacay.pto`, `vacay.sickLeave`, public-holiday keys) | **Upstream base + fork delta**                   | Rebase the 22 locale files on upstream, then preserve the fork keys and run strict i18n parity.                                                                                                                      |
|   4 | Packing list initial view                                                   | **Conflict — preserve fork policy**              | Keep the fork default of `personal`; upstream v4 defaults to `common`. Treat any change as a product decision with focused tests.                                                                                    |
|   5 | Packing template selection and application                                  | **Upstream base + fork delta**                   | Retain the v4 packing-list foundation and the fork's personal/common/category scopes, visibility rules, overwrite confirmation, and accessible UI.                                                                   |
|   6 | Packing template creation and replacement                                   | **Upstream base + fork delta**                   | Preserve the fork's three-tier template flow, category-scoped `409 TEMPLATE_EXISTS`, explicit confirmation, and transactional replacement across schema, API, service, UI, and tests.                                |
|   7 | Solo-trip packing controls                                                  | **Upstream base + fork delta**                   | When the owner is alone, hide sharing-only controls and badges while showing the complete personal list. Do not infer solo state before member hydration.                                                            |
|   8 | Solo-trip Collaboration tab                                                 | **Upstream base + fork delta**                   | Preserve `hasCompanions` gating and the `membersLoaded` guard so companion trips do not temporarily lose their saved tab.                                                                                            |
|   9 | Todo start date and creator default                                         | **Fork-only**                                    | Preserve the complete vertical slice: migration, schema, controller/service/MCP, client model, editor, row, translations, and tests.                                                                                 |
|  10 | Assignment Time Slot editor                                                 | **Upstream base + fork delta**                   | Keep v4 time storage and APIs; retain `TimeSlotFields`, `TimeSlotModal`, collision warnings, and accessible actions. Consolidate duplicated optimistic-save logic before another sync.                               |
|  11 | Day Detail planned-items section                                            | **Upstream base + fork delta**                   | Retain the bounded Plan section and Time Slot entry point; do not maintain a wholesale fork of `DayDetailPanel`.                                                                                                     |
|  12 | Collapse past days by default                                               | **Upstream base + fork delta**                   | Preserve versioned local-storage migration and desktop/mobile synchronization; isolate persistence in a hook when this area is next changed.                                                                         |
|  13 | English-only Places content                                                 | **Conflict — preserve fork policy**              | Upstream is locale-aware; the fork deliberately requests English place labels and details at the API boundary.                                                                                                       |
|  14 | Journey `location_type` persistence                                         | **Fork-only**                                    | Preserve the database column, shared types, Nest service, store, and editor mapping as one end-to-end feature.                                                                                                       |
|  15 | User-controlled PWA updates                                                 | **Conflict — preserve fork policy**              | Keep `registerType: 'prompt'`, `UpdateBanner`, retryable activation, and cache retention. Do not accept v4 automatic update, forced reload, worker unregister, or cache wipe behavior.                               |
|  16 | Vacation-memory PWA identity                                                | **Fork-only**                                    | Preserve the master icon, generated assets, manifest/HTML metadata, theme colors, and documented generation pipeline.                                                                                                |
|  17 | Dynamic viewport units                                                      | **Upstream base + fork delta**                   | Retain `dvh` for application panels and modals; keep print/PDF sizing fixed and audit new upstream mobile layouts individually.                                                                                      |
|  18 | Compact v4 dashboard cards                                                  | **Upstream base + thin fork delta**              | Keep the compact CSS override without forking dashboard JSX; require visual smoke coverage after upstream layout changes.                                                                                            |
|  19 | Simplified Chinese `个人清单` terminology                                   | **Conflict — preserve fork policy**              | Preserve `packing.viewPersonal` and `packing.cloneToMine`, plus the focused terminology test. Do not replace them with upstream `我的清单`.                                                                          |
|  20 | Vacay entitlement inheritance and carry-over                                | **Upstream base + behavior-critical fork delta** | Inherit the preceding year's configured `vacation_days`; calculate `carried_over` independently and never overwrite the new year's base entitlement.                                                                 |
|  21 | Obsidian Vacay import                                                       | **Fork-only — redesign required**                | Preserve read-only integration intent, but resolve the authority and read-path conflicts below before expanding or declaring it compliant.                                                                           |
|  22 | CI, release, promotion, and Tailscale deployment                            | **Conflict / fork-only security boundary**       | Never wholesale-replace workflows. Preserve repository identity, `thvysy44/trek-fork`, immutable digests, environment approval, signed promotion, restricted deploy agent, poller verification, and health evidence. |

## Completed upstream replacements

### Maps credential surface

v4 resolves the operator key through `server/src/app-config/env.schema.ts` and
`server/src/app-config/derive.ts`. `server/.env.example` now documents
`PLACES_API_KEY`, and the derive tests cover canonical mapping, absence of a
key, and rejection of the legacy name. There is deliberately no fallback.
Never commit an actual credential value.

### Vacay active-year selection

The runtime already uses `defaultPeriodYear` from
`client/src/vacay/yearWindow.ts`. The removed helper was referenced only by its
own tests. Surviving coverage includes calendar, fiscal, anniversary, closest
configured period, and empty-plan behavior.

## Highest-priority conflicts

### P0 — Obsidian authority contradicts the preservation contract

`FORK_CUSTOMIZATIONS.md` defines `请假计划.md` rows (`Date | Type | Note`) as
the planned-leave source. The current integration also reads Yearly Glance and
Daily/Periodic Notes configuration and can infer leave from event text. That
creates competing authorities. Make `请假计划.md` authoritative, or explicitly
document precedence and add conflict tests before retaining the broader import.

### P0 — Obsidian reconciliation performs writes on a read path

`VacayService.getEntries()` can trigger synchronous filesystem traversal and
non-transactional delete/reinsert reconciliation. Move this work to an explicit
background or cached adapter, make `getEntries()` database-read-only, and wrap
reconciliation writes in a transaction.

### P0 — Runtime Maps secret migration

A deployment supplying only `GOOGLE_MAPS_API_KEY` will silently lose its
operator Places credential. Rename it to `PLACES_API_KEY` before release. The
repository root `.env` contained neither name during this review and was not
edited or printed.

### P1 — Integration hotspots

Before the next major upstream sync:

1. Extract a shared Assignment Time Slot editing hook.
2. Represent roster state as loading, solo, or collaborative.
3. Isolate past-day expansion persistence from `DayPlanSidebar`.
4. Isolate Obsidian filesystem access from Vacay domain reads.

## Rules for future upstream syncs

1. Start with the upstream component and reapply only documented fork deltas.
2. Replace vertical data features only as complete migration/schema/API/UI/test units.
3. Never resolve deployment or PWA policy conflicts by accepting all upstream.
4. Update this review and `FORK_CUSTOMIZATIONS.md` when adding an invariant.

## Verification

Focused verification completed for the two upstream replacements:

```text
npm run test --workspace=server -- tests/unit/app-config/derive.test.ts
Result: 30 passed

npm run test --workspace=client -- src/store/vacayStore.test.ts src/vacay/yearWindow.test.ts
Result: 42 passed

npm run typecheck --workspace=server
Result: passed

npm run typecheck --workspace=client
Result: passed

npm run test --workspace=shared -- src/i18n/i18n-zh-packing-custom.spec.ts
Result: 1 passed
```

Release preflight on 2026-08-27 also completed:

```text
npm run build
Result: passed

npm run lint
Result: passed (the auto-fix script changed unrelated files locally; those edits
were not included in this changeset)

npm test
Result: passed outside the sandbox; the first sandboxed attempt failed only
because server tests could not bind local sockets (`listen EPERM`)
```

Production acceptance additionally requires green CI and Security Scan for the
merged SHA, a non-draft stable release with provenance, signed immutable-digest
promotion, poller agreement, and `/api/health` returning `{"status":"ok"}`.
