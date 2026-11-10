import React from "react";
import { urgentRecipientSummary, reachableUrgentChannels, chatChannelNames } from "../../utils/urgentSend.js";

// The urgent-send confirm dialog's body -- replaces a single window.confirm
// string with a real lead sentence plus a visually distinct safety-rules
// callout (reusing the app's existing .field-warning treatment), and
// names only the audiences this church's settings can actually reach
// (urgentRecipientSummary), instead of a static "GroupMe, admins, and
// public subscribers" that read as a promise to a channel that's off.
export default function UrgentSendConfirmBody({ enabledFeatures, adminCount, publicCount }) {
  const reach = reachableUrgentChannels(enabledFeatures);
  const summary = urgentRecipientSummary(enabledFeatures, { adminCount, publicCount });
  const chatNames = chatChannelNames(reach);

  return (
    <div>
      <p style={{ marginTop: 0 }}>
        This will immediately notify <strong>{summary}</strong>, bypassing everyone's own schedule.
      </p>
      <div className="field-warning">
        Still waits on review if this partner is restricted
        {chatNames.length > 0 && `, and still respects a muted ${chatNames.join("/")} content type`} -- urgent
        only skips the wait, never those safety rules.
      </div>
    </div>
  );
}
