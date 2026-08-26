# Client

The Client context presents TREK's travel-planning experience and defines the user-facing language for interactive views.

## Language

**Shared Packing List**:
The trip-level packing pool shared by trip participants.
_Avoid_: Common List, Group Pool

**My Packing List**:
The current user's packing view, containing their private items and items shared specifically with them.
_Avoid_: Personal Tier, Private List

**Packing Category Template**:
An admin can save one category from the active Shared/My Packing List view. Applying it creates unchecked copies without linking trips.
Saving again with the same name asks for confirmation, then replaces the template contents while preserving the template identity.

**Day Plan Item**:
Anything appearing on a day's timeline in the 计划 tab.
_Avoid_: Event, Entry

**Assignment**:
A Day Plan Item that is a Place pinned to a Day — a *planned* item, as opposed to a booked one.
_Avoid_: Planned Event, Day Place

**Reservation**:
A Day Plan Item that is a booking, carrying its own booked times. Distinct from an Assignment; a Reservation may be linked to one.
_Avoid_: Booking

**Time Slot**:
The start/end pair scheduling an Assignment within its Day. Stored as an Assignment-level override over the Place's own default time; a Place assigned to two Days holds a different Time Slot on each.
_Avoid_: Time Range, Schedule
