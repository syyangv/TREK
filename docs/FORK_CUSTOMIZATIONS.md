# Fork customizations to preserve

See [PWA Icon Design and Release](PWA_ICON_DESIGN_AND_RELEASE.md) for the
approved TREK app-icon direction, asset-generation pipeline, iOS cache-busting
requirements, and deployment verification checklist.

This file is the preservation checklist for `syyangv/TREK`. Review every item
when syncing from upstream. A clean merge is not sufficient evidence that these
behaviors survived.

For the component-by-component replacement decisions, see the
[v4.1.0 upstream compatibility and replacement review](V4_UPSTREAM_COMPATIBILITY_REVIEW.md).

## v4.1.0 sync preservation record

PR [#58](https://github.com/syyangv/TREK/pull/58) integrates upstream v4.1.0
(`c87e6d2f`) in merge commit `fae97028`. The fork tip `e89f7888` remains an
ancestor of that merge, so the fork's custom commits were not rebased away.

The merge resolved 11 textual conflicts manually. It kept the fork release
image and digest gates, appended upstream migration slots after the existing
fork slots, combined the new MCP/admin locale keys, and retained the booking
day-stop, PWA, Vacay/Obsidian, packing, and solo-trip invariants below. The
full build, typechecks, full test suite, strict i18n parity, workflow syntax,
Compose validation, and Helm lint passed for the PR. Production deployment and
private-instance acceptance remain deliberately unchecked until the PR is
merged and released.

## Deployment and release isolation

- Workflows must remain scoped to `syyangv/TREK`, not `liketrek/TREK` or another
  upstream repository.
- Images publish as `thvysy44/trek-fork`, and production deploys an immutable
  digest, never a mutable branch or unverified tag.
- Production is the private Tailscale instance reached through the restricted
  deployment agent. Do not replace this with public hosting or direct SSH.
- The `production` GitHub environment requires manual approval.
- Required order: main CI and Security Scan, multi-architecture image release,
  production approval, deployment-agent rollout, and `/api/health` verification.

See [CI/CD deployment](ci-cd-phase-3-4-deployment.md) and
[Tailscale self-hosting](TAILSCALE_SELF_HOSTING.md).

## Google Places production credential

- Use only `PLACES_API_KEY`; `GOOGLE_MAPS_API_KEY` is obsolete and deliberately
  unsupported.
- Keep the credential in the production Compose project `.env`. Never commit,
  log, or expose its value to the client.
- `docker-compose.yml` must pass `PLACES_API_KEY` into the app container. A key
  present only in `.env` is ineffective unless this mapping survives an
  upstream sync.
- Restrict the Google Cloud key to `places.googleapis.com` and the production
  server's public egress IP. Browser HTTP-referrer restrictions do not work for
  TREK's server-side requests.
- The production IP may change. Treat `API_KEY_IP_ADDRESS_BLOCKED` and loss of
  Google photos, ratings, or opening hours as signals to verify the egress IP
  and update the key restriction.
- After release, verify the variable is set in the container with its value
  redacted, run a minimal Places API probe, and confirm `/api/health` remains
  `{"status":"ok"}`.

## Vacay and Obsidian

- Preserve the Vacay addon and its read-only Obsidian Yearly Glance leave import.
- Actual/past leave is read from each daily note's `假期` frontmatter; planned
  leave is imported directly from the vault's `请假计划.md` Markdown table
  (`Date | Type | Note`). Resolve the daily-note source, folder, and format from
  Yearly Glance's configuration and its Daily Notes/Periodic Notes settings. A
  daily note wins over a plan row for the same date, including an existing note
  with an empty or invalid `假期` value. Treat `Type`/`假期`, never title, color,
  or emoji, as the category authority. Supported values are `PTO`, `病假`, and
  `公共假期`.
- Keep the vault mounted read-only. Reconciliation may update TREK's derived
  Vacay rows, but must never modify `请假计划.md` or any Obsidian note.
- Preserve PTO, sick-leave, and public-holiday mappings and their locale keys.
- For calendar-mode plans, Vacay must default to the current calendar year, not
  the highest configured year. Respect the upstream period model for fiscal and
  anniversary plans.
- When a Vacay year is added, each user's base annual entitlement must inherit
  from the preceding year. The inherited `vacation_days` value is separate from
  `carried_over`; use 30 only when no preceding user-year configuration exists.
- Carry-over recalculation may update `carried_over` on an existing year, but it
  must not overwrite a base entitlement that the user configured for that year.
- Daily-note `假期` is authoritative for actual leave and `请假计划.md` is
  authoritative for planned leave; unrelated Yearly Glance custom events (for
  example flights) are never inferred as leave. Obsidian reconciliation runs
  only through the explicit authenticated sync endpoint, never from a read path.
- Verify imported entries, company holidays, user entitlements, and existing
  persisted data after an upstream sync.

## Simplified Chinese terminology

- Keep the personal packing view label as `个人清单` and the clone action as
  `复制到个人清单` (`packing.viewPersonal` and `packing.cloneToMine`). Do not
  accept an upstream wording change to `我的清单`; the distinction between a
  personal list and the shared list is intentional and covered by
  `shared/src/i18n/i18n-zh-packing-custom.spec.ts`.

## Additional fork-only vertical slices

- **Todo start date**: preserve the `start_date` migration, shared schema,
  server controller/service/MCP path, client model, editor/list behavior,
  translations, and regression tests as one vertical feature.
- **Journey location type**: preserve `location_type` from the database
  migration through shared types, Nest service, client store, editor, and tests.
- **Assignment time slots, reservation times, and day detail**: retain the
  fork's assignment-specific time-slot editor, collision warnings, accessible
  actions, and bounded planned-items entry point on top of upstream's v4
  planner structure. On mobile, `旅行` and `计划` must render the complete
  start/end range. An explicit planned slot wins; when it is absent, a place
  assignment linked to a reservation falls back to that reservation's
  `reservation_time` / `reservation_end_time`.
- **Reservation-linked assignment persistence**: preserve the `assignment_id`
  relationship on reservation create/edit, REST/MCP writes, WebSocket updates,
  offline hydration, and reload. Keep the linked `place_id`, day, and
  assignment synchronized without creating duplicate day stops. This link is
  data, not a display-only association; losing it removes both the reservation
  badge and its time fallback from the mobile itinerary.

### Mobile itinerary time and reservation-link invariants

These are fork-only product decisions that must be reapplied if upstream
rewrites the mobile trip shell, plan timeline, reservation model, or place
assignment projection:

- `MPlanTimelineRows.PlaceRow` displays an assignment's planned slot first. If
  the assignment has no planned start/end, it displays the linked reservation's
  time range instead. Do not render only `place_time` or prefer the booking
  time over an explicit planned slot.
- The row-level clock action opens the shared `TimeSlotModal` in both mobile
  plan modes for users with `day_edit`. Saves go through the assignment-time
  endpoint, not the shared place default, and refresh the day so server-side
  chronological sorting remains authoritative.
- A reservation linked to a place assignment must retain `assignment_id`
  across server responses, client store hydration, WebSocket reconciliation,
  offline cache reads, and reservation edits. The mobile row derives its
  reserved-time fallback from that persisted link.
- REST/MCP reservation updates must preserve omitted-field semantics while
  honoring explicit `assignment_id: null` and `place_id: null` unlink requests;
  explicit unlink must not be immediately reattached by same-day reuse.
- Preserve the regression coverage in
  `client/src/mobile/screens/trip/plan/MPlanTimelineRows.test.tsx` and add
  focused tests whenever the mobile timeline or reservation-linking path is
  replaced.
- **Past-day collapse**: retain the versioned desktop/mobile local-storage
  behavior and do not substitute a new upstream default without focused tests.
- **Dashboard layout**: retain the compact card CSS adjustment without forking
  upstream dashboard structure; visually check it after upstream layout changes.

## Solo trip UI gating and companion visibility

- An empty member roster is a loading state, not proof of a solo trip. Apply
  solo behavior only after the roster resolves to the owner alone.
- When a trip has only the owner (`tripMembers.length <= 1`), sharing controls and
  collaboration elements are hidden:
  - **Packing Lists**: hide the "Shared" and "My list" view pills, per-item
    sharing toggles, contributor/bringer badges, and category assignee controls;
    all items render in the user's personal list.
  - **Collaboration Tab**: conditionally hide the communication/collaboration
    tab (`id: 'collab'`) in `TRIP_TABS`, even if the collab addon is enabled.
  - **Session Tab Invalidation**: if a user previously navigated to `'collab'`,
    evict the active tab to `'plan'` once the member roster resolves as a solo
    trip. Wait for `membersLoaded` so companion trips retain their active tab on
    refresh.

## Booking place link also schedules the day stop

This repairs an upstream gap recorded in [UPSTREAM_ISSUES.md](UPSTREAM_ISSUES.md):
linking a place on a booking previously wrote metadata only, so the place still
appeared as unplanned in Places without telling the user what to do next.

- The booking dialog shows an "Also add this place to {day}" checkbox, checked
  by default, directly under the place picker. It appears when a non-hotel
  booking has a linked place but no assignment, its date (or existing day) maps
  to a trip day, and that place is not already a stop there. This also makes an
  edit of a legacy booking able to repair its missing stop.
- **Both surfaces carry it**: the desktop `ReservationModal` and the phone
  `MReservationSheet`. The mobile version is a tappable toggle row with a check,
  matching that file's idiom.
- The rule for when the offer applies lives once in
  `resolvePendingStopDay` (`client/src/utils/bookingDayStop.ts`), imported by
  both surfaces. Do not re-inline the condition in either one.
- Only an exact booking-date match qualifies; an existing reservation day is used
  only as a legacy fallback. The server's nearest-day clamp is not mirrored, so
  the offer never guesses a day.
- Assignment selection synchronizes `place_id`, the booking date, and the
  reservation-specific location default. Place selection reuses a matching
  same-day assignment when one exists; otherwise the checkbox sends
  `create_assignment: true`. The server creates the day stop inside the existing
  reservation transaction and binds the booking's `assignment_id` to it.
- Creating the extra stop requires `day_edit` as well as `reservation_edit`;
  reservation-only editors cannot use the checkbox to mutate the day plan.
- `create_assignment` is a boolean, never a day or place reference. The server
  uses the day derived from the booking's own date and the trip-validated
  `place_id`, so the flag adds no reference a caller could aim at another trip.
- An explicit `assignment_id` always wins and supplies the canonical `place_id`
  and day; the flag never creates a second stop. A changed place clears a stale
  assignment unless a same-day assignment for the new place can be reused.
- The default is on. A linked place is nearly always meant to be part of that
  day, and leaving it off is precisely what silently files it as unplanned.
- The upgrade migrations repair dated bookings that already had a `place_id` and
  `day_id` but no day stop, rerun that repair for rows created after the original
  backfill, and normalize mismatched assignment/place/day links. They reuse an
  existing same-day stop when possible, otherwise append one and link the booking.
  Undated bookings remain unplanned because they have no safe day to schedule.

Preserve the locale keys `reservations.alsoAddToDay` and
`reservations.alsoAddToDayHint` in every locale.

Tests: `FE-UTIL-BOOKDAY-001` to `012` and `reservationLinks.test.ts` (shared
helpers), `FE-PLANNER-RESMODAL-083` and `089` to `093` (desktop modal),
`FE-MOB-RESSH-010b` and `054` to `058` (mobile sheet), `FE-TP-HOOK-078b`
(planner refresh), and `RESV-004d` to `004e` plus `RESV-015` to `015i`
(server integration, including canonical links, permission, stale-day,
duplicate, and out-of-range protections).

## PWA and offline behavior

- Workbox uses `registerType: 'prompt'` and a user-controlled update banner.
- The update prompt must not obscure offline, failed-sync, or conflict status.
- A failed service-worker activation remains retryable and must not create an
  unhandled promise rejection.
- App-version checks must not unregister service workers, force reloads, or wipe
  the persistent `map-tiles` cache.
- Keep the vector-map prefetch cache `gl-map-offline` and the tile prefetch cache
  `map-tiles` aligned with their respective runtime code; do not collapse them
  into an unbounded or duplicate cache.
- Mobile application layouts use dynamic viewport units where appropriate; fixed
  PDF/print layouts intentionally retain print-safe sizing.

See [PWA implementation handoff](pwa-template-handoff.md).

## CI-specific compatibility

- Keep fork-scoped workflows and environment variables intact when resolving
  upstream workflow conflicts. Upstream's deterministic amd64-first manifest
  ordering is compatible with the fork image namespace and should be retained.
- Run strict locale parity in addition to ordinary shared tests.
- Vitest uses a deterministic test-only alias for the virtual PWA registration
  module; production continues to use the Vite PWA plugin.
- The Docker security scan is a release gate. Fix reported dependencies rather
  than bypassing or weakening it.

## Post-sync acceptance checklist

- [ ] Login and authenticated navigation work.
- [ ] Existing database records and uploads remain present.
- [ ] Vacay opens on the current year and existing entries remain visible.
- [ ] Historical daily-note `假期` rows before the first plan-table row import
  for `PTO`, `病假`, and `公共假期`.
- [ ] A daily note wins over a same-date plan row, and an existing daily note
  with empty/invalid `假期` suppresses that stale plan row.
- [ ] `请假计划.md` future PTO/public-holiday rows import by `Type`, while
  unrelated Yearly Glance events (for example flights) do not become PTO.
- [ ] Obsidian import is triggered explicitly; `getEntries` remains a DB-only
  read, and the vault is never written.
- [ ] PWA installs and an update produce the reload banner.
- [ ] Offline map caches are retained across a PWA update.
- [ ] A booking created with a place picked still offers the day-stop checkbox,
      and accepting it makes the place read as planned.
- [ ] Google Places returns a successful result when `PLACES_API_KEY` is
      configured; an invalid or missing key must not go unnoticed as an
      OpenStreetMap fallback.
- [ ] Main CI, strict i18n parity, Docker smoke, Helm, and security gates pass.
- [ ] The released image matches the intended main commit and immutable digest.
- [ ] The private production `/api/health` returns `{"status":"ok"}`.

Update this document in the same PR whenever a new fork-only behavior is added.
