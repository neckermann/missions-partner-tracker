import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { fetchCurrentUser } from "../api/client.js";

export default function RequireAdminAuth({ children, role }) {
  const [status, setStatus] = useState("checking"); // checking | authed | anon
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUser(u);
      setStatus(u ? "authed" : "anon");
    });
  }, []);

  if (status === "checking") return <p style={{ padding: "2rem" }}>Checking session...</p>;
  if (status === "anon") return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/admin" replace />;
  return children;
}
