# v4.1.0 upstream compatibility and replacement review

**Review date:** 2026-08-29
**Fork:** `syyangv/TREK`
**Current integration:** [PR #58](https://github.com/syyangv/TREK/pull/58), merge
commit `fae97028`

The post-merge follow-up audit after `fdc451a4` covers explicit Obsidian
reconciliation, reservation-link unlink semantics, mobile reservation-time
fallbacks, complete mobile time ranges, and roster-loading protection.

This review decides, one behavior at a time, when upstream v4 may replace fork
code and where a documented fork delta must remain. A clean textual merge is
not evidence that a behavioral replacement is safe. This revision records the
v4.1.0 sync as well as the earlier v4.0.0 replacement work.

## Review basis

- Historical upstream baseline: v4.0.0 at `a00b84b2`.
- Current upstream release: v4.1.0 at `c87e6d2f` (tag `v4.1.0`).
- Fork immediately before the current sync: `e89f7888`.
- Current integration merge: `fae97028` (PR #58).
- The two tips shared `a00b84b2`; the fork carried 121 fork-only commits and
  upstream carried 782 commits not present in the fork at sync time.
- The current merge had 11 textual conflict files; all were resolved manually.

The review used the post-merge delta, the original custom-feature commits,
`FORK_CUSTOMIZATIONS.md`, focused source and test inspection, and code-review
graph impact data.

## Classification

- **Upstream replacement:** v4 fully supersedes the custom implementation.
- **Upstream base + fork delta:** keep the v4 structure and reapply only the
  named custom behavior.
- **Conflict — preserve fork policy:** upstream behavior contradicts an
  intentional fork decision and must be resolved case by case.
- **Fork-only:** upstream has no equivalent capability.

## One-by-one decisions

| # | Component or invariant | Classification | Replacement decision |
| --: | --- | --- | --- |
| 1 | Instance-wide Google Places credential | **Upstream replacement — completed** | Use `PLACES_API_KEY` through `app-config`. Do not restore `GOOGLE_MAPS_API_KEY`; rename the runtime secret before deployment. |
| 2 | Vacay active-year selection | **Upstream replacement — completed** | Use `defaultPeriodYear`, which supports calendar, fiscal, and anniversary periods. Remove the unused calendar-only helper. |
| 3 | Vacay locale mappings | **Upstream base + fork delta** | Rebase the 22 locale files on upstream, preserve the fork keys, and run strict i18n parity. |
| 4 | Packing list initial view | **Conflict — preserve fork policy** | Keep the fork default of `personal`; upstream v4 defaults to `common`. Treat any change as a product decision with focused tests. |
| 5 | Packing template selection and application | **Upstream base + fork delta** | Retain the v4 packing foundation and the fork's personal/common/category scopes, visibility rules, overwrite confirmation, and accessible UI. |
| 6 | Packing template creation and replacement | **Upstream base + fork delta** | Preserve the fork's three-tier template flow, category-scoped `409 TEMPLATE_EXISTS`, explicit confirmation, and transactional replacement across schema, API, service, UI, and tests. |
| 7 | Solo-trip packing controls | **Upstream base + fork delta** | When the owner is alone, hide sharing-only controls and badges while showing the complete personal list. Do not infer solo state before member hydration. |
| 8 | Solo-trip Collaboration tab | **Upstream base + fork delta** | Preserve `hasCompanions` gating and the `membersLoaded` guard so companion trips do not temporarily lose their saved tab. |
| 9 | Todo start date and creator default | **Fork-only** | Preserve the complete vertical slice: migration, schema, controller/service/MCP, client model, editor, row, translations, and tests. |
| 10 | Assignment Time Slot editor | **Upstream base + fork delta** | Keep v4 time storage and APIs; retain `TimeSlotFields`, `TimeSlotModal`, collision warnings, and accessible actions. |
| 11 | Day Detail planned-items section | **Upstream base + fork delta** | Retain the bounded Plan section and Time Slot entry point; do not maintain a wholesale fork of `DayDetailPanel`. |
| 12 | Collapse past days by default | **Upstream base + fork delta** | Preserve versioned local-storage migration and desktop/mobile synchronization; isolate persistence in a hook when this area changes again. |
| 13 | English-only Places content | **Conflict — preserve fork policy** | Upstream is locale-aware; the fork deliberately requests English place labels and details at the API boundary. |
| 14 | Journey `location_type` persistence | **Fork-only** | Preserve the database column, shared types, Nest service, store, editor, and tests as one end-to-end feature. |
| 15 | User-controlled PWA updates | **Conflict — preserve fork policy** | Keep `registerType: 'prompt'`, `UpdateBanner`, retryable activation, and cache retention. Do not accept automatic update, forced reload, worker unregister, or cache wipe behavior. |
| 16 | Vacation-memory PWA identity | **Fork-only** | Preserve the master icon, generated assets, manifest/HTML metadata, theme colors, and documented generation pipeline. |
| 17 | Dynamic viewport units | **Upstream base + fork delta** | Retain `dvh` for application panels and modals; keep print/PDF sizing fixed and audit new upstream mobile layouts individually. |
| 18 | Compact v4 dashboard cards | **Upstream base + thin fork delta** | Keep the compact CSS override without forking dashboard JSX; require visual smoke coverage after upstream layout changes. |
| 19 | Simplified Chinese `个人清单` terminology | **Conflict — preserve fork policy** | Preserve `packing.viewPersonal` and `packing.cloneToMine`, plus the focused terminology test. Do not replace them with upstream `我的清单`. |
| 20 | Vacay entitlement inheritance and carry-over | **Upstream base + behavior-critical fork delta** | Inherit the preceding year's configured `vacation_days`; calculate `carried_over` independently and never overwrite the new year's base entitlement. |
| 21 | Obsidian Vacay import | **Fork-only — follow-up fixed** | `请假计划.md` is authoritative; reconciliation is transactional and explicit, while Vacay reads remain database-only. |
| 22 | CI, release, promotion, and Tailscale deployment | **Conflict / fork-only security boundary** | Never wholesale-replace workflows. Preserve repository identity, `thvysy44/trek-fork`, immutable digests, environment approval, signed promotion, restricted deploy agent, poller verification, and health evidence. |

## v4.1.0 sync outcome

PR #58 adopts the upstream v4.1.0 product surface, including the MapLibre
vector basemap, public API and OAuth scopes, expanded MCP tools, storage
administration, school-holiday support, datetime normalization, and the new
book/map schema limits. These are upstream capabilities; they do not replace
the fork policies listed in the table above.

The following preservation decisions were made during the merge:

- Both Docker workflows retain the fork's repository guards, image namespace,
  candidate manifest, and immutable-digest release gates. Upstream's
  deterministic amd64-first manifest ordering was adopted without changing the
  fork image coordinates.
- The three existing fork migration slots remain before upstream's two new
  tail slots (`reservations.ingest_state` and `mcp_tokens.kind`). This keeps
  both a fork-upgraded database and an upstream-upgraded database able to run
  the missing idempotent steps.
- The booking place/day-stop flow remains in the desktop and mobile clients, the
  reservation controller/service/RPC path, its migration, and its regression
  tests. The user-controlled PWA update path, offline caches, Vacay rules,
  Obsidian read-only boundary, solo-trip controls, and Simplified Chinese
  packing terminology remain documented fork invariants.
- Upstream MCP/admin locale keys were added to every locale, including `zh` and
  `zh-TW`, without replacing the fork's existing translations.

## Completed upstream replacements retained from v4.0.0

### Maps credential surface

v4 resolves the operator key through `server/src/app-config/env.schema.ts` and
`server/src/app-config/derive.ts`. `server/.env.example` documents
`PLACES_API_KEY`, and the derive tests cover canonical mapping, absence of a
key, and rejection of the legacy name. There is deliberately no fallback.
`docker-compose.yml` also passes the variable into the app container; keeping
it only in the Compose project `.env` is not sufficient without that mapping.
Never commit an actual credential value.

### Vacay active-year selection

The runtime uses `defaultPeriodYear` from `client/src/vacay/yearWindow.ts`.
Surviving coverage includes calendar, fiscal, anniversary, closest configured
period, and empty-plan behavior.

## Highest-priority conflicts

### Resolved — Obsidian authority follows the preservation contract

`请假计划.md` rows (`Date | Type | Note`) are now the sole planned-leave
source. Yearly Glance custom events and Daily/Periodic Notes are ignored for
leave classification. The explicit
`POST /api/addons/vacay/entries/sync-obsidian/:year` path performs the import.

### Resolved — Obsidian reconciliation is isolated from reads

`VacayService.getEntries()` is database-read-only. The explicit reconciliation
operation wraps its delete/reinsert work in a transaction, and client entry
loads trigger it best-effort before the normal read.

### Resolved — Runtime Maps credential and Compose wiring

Production stores `PLACES_API_KEY` in the Compose project `.env`, passes it
through `docker-compose.yml`, and uses a Google Cloud key restricted to
`places.googleapis.com` and the production server's public egress IP. The key
value is never committed or printed. A post-release Google Places probe returned
HTTP 200, and production `/api/health` remained healthy on v4.0.4.

The public egress IP may change. If Google returns an IP-address restriction
error, update the key restriction before treating the OpenStreetMap fallback as
normal behavior. Browser-referrer restrictions are incompatible with the
server-side Places request path.

### P1 — Integration hotspots that remain open

1. Extract a shared Assignment Time Slot editing hook.
2. Finish propagating loading/solo/collaborative roster state to every
   companion-dependent surface; packing now protects the initial loading state.
3. Isolate past-day expansion persistence from `DayPlanSidebar`.

## Rules for future upstream syncs

1. Start with the upstream component and reapply only documented fork deltas.
2. Replace vertical data features only as complete migration/schema/API/UI/test
   units.
3. Never resolve deployment or PWA policy conflicts by accepting all upstream.
4. Update this review and `FORK_CUSTOMIZATIONS.md` when adding an invariant.

## Verification

PR #58 passed the following local checks:

```text
npm run build
Result: passed

npm run typecheck --workspace=shared
npm run typecheck --workspace=server
npm run typecheck:tests --workspace=server
npm run typecheck --workspace=client
Result: all passed

npm test
Result: passed; server integration tests ran with local socket access

npm run i18n:parity:strict --workspace=shared
Result: File parity: OK; Key parity: OK

npm run lint --workspace=shared
npm run lint:check --workspace=server
npm run lint:check --workspace=client
Result: passed

actionlint -ignore 'SC[0-9]+' .github/workflows/docker-dev.yml .github/workflows/docker.yml
Result: passed; unfiltered actionlint still reports existing ShellCheck diagnostics

docker compose config --quiet
Result: passed

helm lint charts/trek
Result: passed; informational icon recommendation only
```

Focused regression suites covered booking day stops, desktop and mobile
reservation surfaces, migrations, storage administration, Vacay, PWA behavior,
book schemas, packing terminology, and shared locale changes.

The post-merge preservation follow-up passed the focused Vacay/Obsidian,
reservation-link, mobile itinerary, packing, client store, and full client test
suites, plus build, typecheck, lint, strict i18n parity, and diff checks. The
full server suite still has two unrelated collaboration failures:
`tests/e2e/collab.e2e.test.ts` receives 404 instead of the expected 429, and
`tests/integration/collab.test.ts` fails in `COLLAB-011` while reading an
undefined poll id. They are outside this preservation fix.

Production acceptance is not part of this local review. After the PR merges,
the protected release process must still provide green CI and Security Scan, a
stable release with provenance, a signed immutable-digest promotion, poller
agreement, and `/api/health` returning `{"status":"ok"}`.
