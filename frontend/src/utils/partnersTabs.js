// Which tab the Partners page shows for someone on a care team: "All" or "My
// partners" (their own care team partners, longest-quiet first).
//
// - Staff (admin/editor/viewer) land on All and can switch to My partners: it is an
//   option, not the default, so nobody who manages the whole list is moved away from it.
// - A guest, whether on a care team, given a trip or both, sees one plain list of every
//   partner they can reach: no tabs. A trip guest and a care team guest get the same page.
//
// `assignedParam` is the `?assigned=` query value (the notification links use "1").
// Returns { showAssigned, showTabs }.
export function partnersTabState({ hasAssignedTab, isGuest, assignedParam }) {
  if (!hasAssignedTab || isGuest) return { showAssigned: false, showTabs: false };
  return { showAssigned: assignedParam === "1", showTabs: true };
}
