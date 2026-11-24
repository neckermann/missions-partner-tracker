// Which tab the Partners page shows for someone on a care team: "All" or "My
// partners" (their own care team partners, longest-quiet first).
//
// - Staff (admin/editor/viewer) land on All and can switch to My partners: it is an
//   option, not the default, so nobody who manages the whole list is moved away from it.
// - A care team guest only ever sees the partners they are on the team for (plus a
//   trip's partner), so All would mostly repeat My partners. They land on My partners,
//   and All is hidden altogether when it would show nothing more.
//
// `assignedParam` is the `?assigned=` query value (the notification links use "1"; a
// guest who picks All gets "0"). Returns { showAssigned, showTabs }.
export function partnersTabState({ hasAssignedTab, isGuest, assignedParam, reachableIds, seatIds }) {
  if (!hasAssignedTab) return { showAssigned: false, showTabs: false };
  if (!isGuest) return { showAssigned: assignedParam === "1", showTabs: true };
  const seats = new Set(seatIds);
  const allIsMine = reachableIds.length > 0 && reachableIds.every((id) => seats.has(id));
  return {
    showAssigned: allIsMine || assignedParam !== "0",
    showTabs: !allIsMine,
  };
}
