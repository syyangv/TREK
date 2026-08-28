# Upstream issues observed in this fork

Defects and design gaps that originate in `mauriceboe/TREK`, not in the
`syyangv/TREK` customizations. This is a fork-local record. Its purpose is to
keep an upstream sync from presenting an inherited defect as a fork regression,
and to hold the analysis so it does not have to be rediscovered.

Recording an entry here implies nothing about reporting it upstream. Any
upstream-facing action is a separate decision, made explicitly.

Each entry states the observed behavior, the grounded root cause, whether the
fork has diverged in the affected code, and the current disposition. Do not
record a suspicion here; record only findings verified against code or data.

## Booking place link does not schedule the place

Status: patched in this fork. See "Booking place link also schedules the day
stop" in [FORK_CUSTOMIZATIONS.md](FORK_CUSTOMIZATIONS.md); an upstream sync
that touches the booking dialog or the reservation create path must preserve it.
Found: 2026-08-27. Affected code is unmodified by this fork.

A place linked to a booking through the booking dialog's place field still
counts as unplanned in the Places sidebar, with no indication that a further
step is required.

Root cause. For non-hotel bookings, `client/src/components/Planner/
ReservationModal.tsx` renders two independent link controls. The assignment
picker writes `reservations.assignment_id`; the place picker, added later for
"Link an existing trip place/activity to any non-hotel booking" (#1353), writes
`reservations.place_id`. Only the first corresponds to a `day_assignments` row.
`plannedIds` in `client/src/pages/tripPlanner/useTripPlanner.ts` and its mobile
counterpart in `client/src/mobile/screens/trip/places/placesBrowserModel.ts`
derive planned state solely from `day_assignments`, so `place_id` has no effect
on it. The server does not compensate: the insert in `server/src/nest/
reservations/reservations.service.ts` passes through the client's
`assignment_id` and never creates an assignment.

The two controls are reachable in a state where only the wrong one can be used.
`buildAssignmentOptions` is trip-wide and skips days that have no assignments,
so a booking created on a day with no stops yet shows a populated picker
containing only other days' stops, offers no option for the booking's own day,
and provides no affordance to create one. The place picker immediately below
does list the intended place. The correct sequence -- leave the dialog, add the
place to that day in the day plan, reopen the dialog -- is not indicated
anywhere in the UI.

Observed instance. Place 24 (J. P. Murphy Tennis Courts) had zero
`day_assignments` rows while reservation 10 referenced it with
`assignment_id` NULL on day 7. The four other place-linked bookings in the same
trip all carried an `assignment_id`, because in each of those the day stop was
created first and the booking was attached to it afterwards.

Fix taken. An opt-in checkbox in the booking dialog, checked by default, sends
`create_assignment: true`; the server creates the day stop in the same
transaction as the booking and binds `assignment_id` to it. Widening
`plannedIds` to count bookings was considered and rejected -- it would stop the
unplanned filter from being an actionable list of places still needing to be
scheduled.
