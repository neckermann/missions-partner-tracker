import React from "react";
import { Link } from "react-router-dom";

// What a record's page shows when its record can't be loaded because it is gone (404) or
// out of reach (403), instead of "Loading..." forever. A link to a deleted record is the
// usual way in: an old bookmark or tab, or a page left open across a database reset.
//
// `loadErrorStatus(err)` reads the HTTP status off a failed request; pages keep it in state
// and render <RecordUnavailable status={...} /> when it is 404 or 403.
export function loadErrorStatus(err) {
  const status = err?.response?.status;
  return status === 404 || status === 403 ? status : null;
}

export default function RecordUnavailable({ status, what, backTo, backLabel }) {
  return (
    <div className="admin-shell">
      <p role="alert" style={{ marginTop: 0 }}>
        {status === 403
          ? `You don't have access to this ${what}.`
          : `This ${what} wasn't found. It may have been deleted.`}
      </p>
      <Link to={backTo}>← {backLabel}</Link>
    </div>
  );
}
