import { useRef, useState } from "react";
import { fetchPartnerFiles } from "../api/client.js";

// Loads a partner's files on demand for the Source dropdown on a Prayer Request/One-Time Need
// form. Fetched per selection because these pages span every partner.
export default function useSourceFiles() {
  const [sourceFiles, setSourceFiles] = useState([]);
  // Guards a slow earlier load for a previous partner from landing after the current partner's.
  const sourceFilesForRef = useRef(null);

  function loadSourceFiles(partnerId) {
    sourceFilesForRef.current = partnerId || null;
    if (!partnerId) {
      setSourceFiles([]);
      return;
    }
    fetchPartnerFiles({ partnerId })
      .then((files) => {
        if (sourceFilesForRef.current === partnerId) setSourceFiles(files);
      })
      .catch(console.error);
  }

  return { sourceFiles, loadSourceFiles };
}
