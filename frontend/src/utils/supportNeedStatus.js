// Derives a one-time need's status pill. A need that has been met says so whatever was decided; otherwise the
// funding decision reads from approved vs. requested amount (same labels/thresholds as supportNeedOutcomeLabel
// in backend/src/utils/groupmeChannel.js, which can't share this file (Node vs browser): keep them in sync by
// hand). An undecided need that someone has taken on reads "Someone's on it" rather than "Pending Decision".
export function supportNeedStatus(need) {
  if (need.metDate) return { label: "Met", tone: "good" };
  if (need.approvedAmount == null && need.handledBy) {
    return { label: `Someone's on it: ${need.handledBy}`, tone: "neutral" };
  }
  if (need.approvedAmount == null) return { label: "Pending Decision", tone: "warn" };
  if (need.approvedAmount === 0) return { label: "Declined", tone: "warn" };
  if (need.approvedAmount < need.requestedAmount) return { label: "Partially Funded", tone: "good" };
  return { label: "Fully Funded", tone: "good" };
}
