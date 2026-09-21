import React from "react";

// The last line of defence: a render error anywhere below this shows a card
// instead of a blank page.
//
// This is not hypothetical. Until the backend started guaranteeing that an
// error body is a string, a validation failure put Zod's array of issue
// objects into component state, and rendering that threw "Objects are not
// valid as a React child" -- with nothing to catch it, React unmounted the
// entire app and the user was left staring at white. The backend fix removed
// that particular cause; this removes the *class* of outcome.
//
// The other realistic trigger is a stale index.html after a deploy: the admin
// pages are lazy-loaded (see main.jsx), and a chunk that no longer exists
// rejects its dynamic import. Suspense handles the pending state, not the
// failure, so without this a returning user clicking any admin link gets a
// white screen until they hard-refresh -- which is exactly what the Reload
// button here does for them.
//
// Class component because there is still no hook equivalent of
// componentDidCatch.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No error-reporting service here by design (nothing in this app phones
    // home), so the console is the record. Keep the component stack -- it's
    // what makes one of these diagnosable from a screenshot.
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="admin-shell" role="alert">
        <div className="admin-section" style={{ maxWidth: "36rem" }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
          <p style={{ color: "#666" }}>
            This is a bug, not something you did. Reloading usually fixes it — and always does if the app was
            updated while this tab was open.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            {this.props.homeHref && (
              <a className="btn secondary" href={this.props.homeHref}>
                Back to {this.props.homeLabel || "start"}
              </a>
            )}
          </div>
          {/* Collapsed rather than hidden: a volunteer never opens it, and
              whoever they forward the screenshot to gets the message. */}
          <details style={{ marginTop: "1.5rem" }}>
            <summary style={{ cursor: "pointer", color: "#666" }}>Technical details</summary>
            <pre
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "#f6f6f6",
                borderRadius: "4px",
                fontSize: "0.8rem",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
