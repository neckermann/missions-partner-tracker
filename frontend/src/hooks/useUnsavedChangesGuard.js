import { useEffect } from "react";

// Warns before the browser tab closes/reloads while `active` is true --
// used by EditableSection (components/admin/EditableSection.jsx) so a
// draft mid-edit isn't silently lost to an accidental refresh.
//
// Deliberately covers only the browser-level beforeunload case, not
// in-app route navigation (clicking a sidebar link away from an
// in-progress edit): react-router's own navigation-blocking APIs
// (useBlocker) need a data router (createBrowserRouter/RouterProvider),
// and this app's main.jsx still uses plain <BrowserRouter>. Revisit this
// if that ever changes -- until then, this is the one guard that's
// actually available everywhere EditableSection is used.
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
