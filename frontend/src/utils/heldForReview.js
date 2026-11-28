// What a care team member who isn't staff is told after saving a prayer request: it has not gone anywhere
// public, it has gone to the church's missions team (ChurchSettings.ownerGroupName) to look over first.
export function sentForReviewNote(ownerGroupName) {
  const group = ownerGroupName?.trim() || "Missions team";
  return `Your request has gone to the ${group} for review.`;
}
