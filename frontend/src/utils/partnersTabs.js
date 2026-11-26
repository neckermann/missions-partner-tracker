// Which tab the Partners page shows for someone on a care team: "All" or "My
// partners" (their own care team partners, longest-quiet first).
//
// - Staff (admin/editor/viewer) land on All; My partners is an option, not the default.
// - A guest (care team, trip, or both) sees one plain list of every reachable partner: no tabs.
//
// `assignedParam` is the `?assigned=` query value (the notification links use "1").
// Returns { showAssigned, showTabs }.
export function partnersTabState({ hasAssignedTab, isGuest, assignedParam }) {
  if (!hasAssignedTab || isGuest) return { showAssigned: false, showTabs: false };
  return { showAssigned: assignedParam === "1", showTabs: true };
}
