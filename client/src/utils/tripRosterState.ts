export type TripRosterState = 'loading' | 'solo' | 'collaborative'

/** Classifies a roster without treating an unhydrated empty array as solo. */
export function getTripRosterState(
  membersLoaded: boolean,
  memberCount: number,
): TripRosterState {
  if (!membersLoaded) return 'loading'
  return memberCount > 1 ? 'collaborative' : 'solo'
}

export function rosterHasCompanions(state: TripRosterState): boolean {
  return state === 'collaborative'
}
