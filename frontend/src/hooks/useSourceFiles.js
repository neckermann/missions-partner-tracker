import { useRef, useState } from "react";
import { fetchNewsletters, fetchDocuments } from "../api/client.js";

// Loads a partner's newsletters/documents on demand, for the Source
// (optional) dropdown on a Prayer Request/One-Time Need add/edit form --
// re-fetched per selection rather than loading every partner's files up
// front, since these pages span every partner (unlike
// PrayerRequestSection.jsx's per-partner version, which already has its
// one partner's files loaded).
//
// Copy-pasted identically (function + race-guard ref both) in
// AdminOneTimeNeeds.jsx and AdminPrayerRequests.jsx (see #135) -- same
// hoisting reasoning as useLoadMore.js.
export default function useSourceFiles() {
  const [sourceFiles, setSourceFiles] = useState({ newsletters: [], documents: [] });
  // Switching the selected partner in the Add form, or clicking Edit on a
  // different row, before a slower loadSourceFiles() call for the
  // previous partner resolves, would otherwise let a previous partner's
  // newsletters/documents land in the SourcePicker after the current
  // partner's already did. Tracks which partner the most recent call was
  // actually for, checked when it resolves.
  const sourceFilesForRef = useRef(null);

  function loadSourceFiles(partnerId) {
    sourceFilesForRef.current = partnerId || null;
    if (!partnerId) {
      setSourceFiles({ newsletters: [], documents: [] });
      return;
    }
    Promise.all([fetchNewsletters({ partnerId }), fetchDocuments({ partnerId })])
      .then(([newsletters, documents]) => {
        if (sourceFilesForRef.current === partnerId) setSourceFiles({ newsletters, documents });
      })
      .catch(console.error);
  }

  return { sourceFiles, loadSourceFiles };
}
