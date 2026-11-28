import React from "react";
import { Link } from "react-router-dom";
import PublicSiteHeader from "../components/PublicSiteHeader.jsx";

// What an address that matches no page shows, instead of a blank screen. `inAdmin` is for an unknown address under
// /admin, where the menu is already on screen, so it is just the message and a way home.
export default function NotFound({ inAdmin = false }) {
  const message = (
    <>
      <h2>That page wasn't found</h2>
      <p>The address may be mistyped, or the page may have been moved or removed.</p>
      <p>
        <Link to={inAdmin ? "/admin" : "/"}>{inAdmin ? "Go to Home" : "Go to the home page"}</Link>
      </p>
    </>
  );
  if (inAdmin) return <div className="admin-shell">{message}</div>;
  return (
    <div>
      <PublicSiteHeader title="Page not found" />
      <div className="admin-shell" style={{ maxWidth: 560 }}>
        {message}
      </div>
    </div>
  );
}
