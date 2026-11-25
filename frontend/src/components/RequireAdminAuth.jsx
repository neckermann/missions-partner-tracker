import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { fetchCurrentUser } from "../api/client.js";

export default function RequireAdminAuth({ children, requiredRole }) {
  const [status, setStatus] = useState("checking"); // checking | authed | anon
  const [user, setUser] = useState(null);
  const location = useLocation();

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUser(u);
      setStatus(u ? "authed" : "anon");
    });
  }, []);

  if (status === "checking") return <p style={{ padding: "2rem" }}>Checking session...</p>;
  // A session that expires mid-visit returns the admin to where they were (Login.jsx handles ?next=
  // for cold links). Only this branch carries a destination; the wrong-role branch is already
  // authenticated.
  if (status === "anon") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/admin" replace />;
  return children;
}
