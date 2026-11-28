import React from "react";
import { Navigate } from "react-router-dom";
import useCurrentUser from "../hooks/useCurrentUser.js";

// Wraps a page only an admin or editor can use (the server refuses everyone else), so a viewer or guest who
// types its address lands back on the list instead of an empty form that cannot save.
export default function RequireCanWrite({ children, to = "/admin/partners" }) {
  const { loading, canWrite } = useCurrentUser();
  if (loading) return null;
  return canWrite ? children : <Navigate to={to} replace />;
}
