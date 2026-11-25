import { useEffect } from "react";

// Warns before the tab closes/reloads while `active`, so an EditableSection draft isn't lost to a
// refresh. Covers only beforeunload, not in-app navigation: react-router's useBlocker needs a data
// router and main.jsx uses plain <BrowserRouter>.
export default function useUnsavedChangesGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
}
