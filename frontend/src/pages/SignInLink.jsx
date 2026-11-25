import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { redeemSignInLink } from "../api/client.js";

// #386 Layer 2: where the emailed sign-in link lands. It spends the link, then hands the result
// (a second step, enrolment to finish, or an open session) to the sign-in page, which already
// knows what to do with each.
export default function SignInLink() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  // A link works once; React's dev double-invoke of effects must not spend it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get("token");
    if (!token) {
      setError("This link is missing its code. Ask for a new one.");
      return;
    }
    redeemSignInLink(token)
      .then((result) => navigate("/login", { replace: true, state: { resume: result } }))
      .catch((err) =>
        setError(
          err.response?.data?.error || "This link didn't work. Ask for a new one from the sign-in page."
        )
      );
  }, [params, navigate]);

  return (
    <div className="admin-shell" style={{ maxWidth: 400 }}>
      <h2>Signing you in</h2>
      {error ? (
        <>
          <p role="alert" style={{ color: "var(--danger)" }}>
            {error}
          </p>
          <Link to="/login">Back to sign in</Link>
        </>
      ) : (
        <p>One moment...</p>
      )}
    </div>
  );
}
