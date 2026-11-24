// Which tab the Partners page shows for someone on a care team: "All" or "My
// partners" (their own care team partners, longest-quiet first).
//
// - Staff (admin/editor/viewer) land on All and can switch to My partners: it is an
//   option, not the default, so nobody who manages the whole list is moved away from it.
// - A care team guest only ever sees the partners they are on the team for, so they get
//   My partners alone: no All tab, no tab bar.
//
// `assignedParam` is the `?assigned=` query value (the notification links use "1").
// Returns { showAssigned, showTabs }.
export function partnersTabState({ hasAssignedTab, isGuest, assignedParam }) {
  if (!hasAssignedTab) return { showAssigned: false, showTabs: false };
  if (isGuest) return { showAssigned: true, showTabs: false };
  return { showAssigned: assignedParam === "1", showTabs: true };
}
