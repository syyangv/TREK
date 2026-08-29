# Fork customizations to preserve

See [PWA Icon Design and Release](PWA_ICON_DESIGN_AND_RELEASE.md) for the
approved TREK app-icon direction, asset-generation pipeline, iOS cache-busting
requirements, and deployment verification checklist.

This file is the preservation checklist for `syyangv/TREK`. Review every item
when syncing from upstream. A clean merge is not sufficient evidence that these
behaviors survived.

For the v4 component-by-component replacement decisions, see
[v4 upstream compatibility and replacement review](V4_UPSTREAM_COMPATIBILITY_REVIEW.md).

## Deployment and release isolation

- Workflows must remain scoped to `syyangv/TREK`, not `liketrek/TREK` or another
  upstream repository.
- Images publish as `thvysy44/trek-fork` and production deploys an immutable
  digest, never a mutable branch or unverified tag.
- Production is the private Tailscale instance reached through the restricted
  deployment agent. Do not replace this with public hosting or direct SSH.
- The `production` GitHub environment requires manual approval.
- Required order: main CI and security scan, multi-architecture image release,
  production approval, deployment-agent rollout, `/api/health` verification.

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

- Preserve the Vacay addon and its read-only Obsidian Yearly Glance import.
- Planned leave is imported directly from the vault's `请假计划.md` Markdown
  table (`Date | Type | Note`); Yearly Glance renders this source but is not a
  runtime dependency for Vacay. Treat `Type`, never title, color, or emoji, as
  the category authority. Supported values are `PTO`, `病假`, and `公共假期`.
- Keep the vault mounted read-only. Reconciliation may update TREK's derived
  Vacay rows, but must never modify `请假计划.md` or any Obsidian note.
- Preserve PTO, sick-leave, and public-holiday mappings and their locale keys.
- Vacay must default to the current configured calendar year, not the highest
  configured year.
- When a Vacay year is added, each user's base annual entitlement must inherit
  from the preceding year. The inherited `vacation_days` value is separate from
  `carried_over`; use 30 only when no preceding user-year configuration exists.
- Carry-over recalculation may update `carried_over` on an existing year, but it
  must not overwrite a base entitlement that the user configured for that year.
- Verify imported entries, company holidays, user entitlements, and existing
  persisted data after an upstream sync.

## Simplified Chinese terminology

- Keep the personal packing view label as `个人清单` and the clone action as
  `复制到个人清单` (`packing.viewPersonal` and `packing.cloneToMine`). Do not
  accept an upstream wording change to `我的清单`; the distinction between a
  personal list and the shared list is intentional and covered by
  `shared/src/i18n/i18n-zh-packing-custom.spec.ts`.

## Solo trip UI gating & companion visibility

- When a trip has only the owner (`tripMembers.length <= 1`), sharing controls and collaboration elements are hidden:
  - **Packing Lists**: The "Shared" and "My list" view pills, per-item sharing toggles, contributor/bringer badges, and category assignee controls are hidden; all items render in the user's personal list.
  - **Collaboration Tab**: The communication/collaboration tab (`id: 'collab'`) in `TRIP_TABS` is conditionally hidden when `tripMembers.length <= 1`, even if the collab addon is enabled.
  - **Session Tab Invalidation**: If a user previously navigated to `'collab'`, the active tab evicts to `'plan'` once the member roster resolves as a solo trip. Roster hydration waits for `membersLoaded` before evicting so trips with companions retain their active tab on refresh.

## Booking place link also schedules the day stop

Repairs an upstream gap recorded in [UPSTREAM_ISSUES.md](UPSTREAM_ISSUES.md):
linking a place on a booking wrote metadata only, so the place kept reading as
unplanned in Places with nothing in the UI saying a further step was needed.

- The booking dialog shows an "Also add this place to {day}" checkbox, checked
  by default, directly under the place picker. It appears only when the dialog
  is creating a booking, the type is not `hotel`, a place is picked, no
  assignment is linked, and the booking's date matches a trip day exactly on
  which that place is not already a stop.
- **Both surfaces carry it**: the desktop `ReservationModal` and the phone
  `MReservationSheet` (the mobile shell takes over below 768px, so a
  desktop-only fix would leave the bug intact on phones). The mobile version
  renders as a tappable toggle row with a check, matching that file's idiom.
- The rule for when the offer applies lives once, in
  `resolvePendingStopDay` (`client/src/utils/bookingDayStop.ts`), and is
  imported by both surfaces. Do not re-inline the condition in either one — the
  two surfaces must not be able to drift apart.
- Only an exact date match qualifies. The server's nearest-day clamp is
  deliberately not mirrored, so the offer never guesses a day.
- The checkbox sends `create_assignment: true`. The server creates the day stop
  inside the existing create transaction and binds the booking's
  `assignment_id` to it, so the booking and the place agree or neither changes.
- Creating that extra stop requires `day_edit` as well as `reservation_edit`;
  reservation-only editors cannot use the checkbox to mutate the day plan.
- `create_assignment` is a boolean, never a day or place reference. The server
  uses the day it already derived from the booking's own date and the already
  trip-validated `place_id`, so the flag adds no reference a caller could aim
  at another trip.
- An explicit `assignment_id` always wins; the flag never creates a second stop.
- The default is on. The linked place is nearly always meant to be part of that
  day, and leaving it off is precisely what silently files it as unplanned.
- The upgrade migration also repairs older dated bookings that already had a
  `place_id` and `day_id` but no day stop: it reuses an existing same-day stop
  when possible, otherwise appends one and links the booking. Undated bookings
  remain unplanned because they still have no safe day to schedule.

Preserve the locale keys `reservations.alsoAddToDay` and
`reservations.alsoAddToDayHint` in every locale.

Tests: `FE-UTIL-BOOKDAY-001` to `011` (shared helper),
`FE-PLANNER-RESMODAL-089` to `093` (desktop modal),
`FE-MOB-RESSH-054` to `058` (mobile sheet), and `RESV-015` to `015i`
(server integration, including permission, stale-day, duplicate, and
out-of-range protections).

## PWA and offline behavior

- Workbox uses `registerType: 'prompt'` and a user-controlled update banner.
- The update prompt must not obscure offline, failed-sync, or conflict status.
- A failed service-worker activation remains retryable and must not create an
  unhandled promise rejection.
- App-version checks must not unregister service workers, force reloads, or wipe
  the persistent `map-tiles` cache.
- Mobile application layouts use dynamic viewport units where appropriate;
  fixed PDF/print layouts intentionally retain print-safe sizing.

See [PWA implementation handoff](pwa-template-handoff.md).

## CI-specific compatibility

- Keep fork-scoped workflows and environment variables intact when resolving
  upstream workflow conflicts.
- Run strict locale parity in addition to ordinary shared tests.
- Vitest uses a deterministic test-only alias for the virtual PWA registration
  module; production continues to use the Vite PWA plugin.
- The Docker security scan is a release gate. Fix reported dependencies rather
  than bypassing or weakening it.

## Post-sync acceptance checklist

- [ ] Login and authenticated navigation work.
- [ ] Existing database records and uploads remain present.
- [ ] Vacay opens on the current year and existing entries remain visible.
- [ ] `请假计划.md` future PTO and holiday rows import by `Type`, while
      unrelated Yearly Glance events such as flights do not become PTO.
- [ ] Obsidian/Yearly Glance data imports without destructive writes.
- [ ] PWA installs and an update produces the reload banner.
- [ ] Offline map cache is retained across a PWA update.
- [ ] A booking created with a place picked still offers the day-stop
      checkbox, and accepting it makes the place read as planned.
- [ ] Google Places returns a successful result when `PLACES_API_KEY` is
      configured; an invalid or missing key must not go unnoticed as an
      OpenStreetMap fallback.
- [ ] Main CI, strict i18n parity, Docker smoke, Helm, and security gates pass.
- [ ] Released image matches the intended main commit and immutable digest.
- [ ] Private production `/api/health` returns `{"status":"ok"}`.

Update this document in the same PR whenever a new fork-only behavior is added.
