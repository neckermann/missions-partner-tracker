import React from "react";

// The last line of defence: a render error below this shows a card instead of a blank page. Two
// real triggers: a non-string error body reaching a component (React throws "Objects are not valid
// as a React child"), and a stale index.html after a deploy, where a lazy-loaded admin chunk no
// longer exists and Suspense doesn't handle the failure (the Reload button fixes it). A class
// component because there is no hook equivalent of componentDidCatch.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No error-reporting service by design (nothing phones home): the console is the record, and the
    // component stack makes it diagnosable from a screenshot.
    console.error("Unhandled render error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="admin-shell" role="alert">
        <div className="admin-section" style={{ maxWidth: "36rem" }}>
          <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
          <p style={{ color: "var(--muted)" }}>
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
          {/* Collapsed, not hidden: a volunteer never opens it, but whoever gets the screenshot sees the message. */}
          <details style={{ marginTop: "1.5rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>Technical details</summary>
            <pre
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "var(--surface-2)",
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
