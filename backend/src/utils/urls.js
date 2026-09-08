// This backend serves the frontend directly (see server.js's static file
// serving), so this is always this app's own public base URL — needed
// only to build an absolute redirect_uri for the OIDC spec (external
// identity providers require one; a relative path doesn't work there
// since it's sent to a third party, not used in a same-origin redirect).
//
// Falls back to RENDER_EXTERNAL_URL, which Render sets automatically on
// every web service (https://your-app.onrender.com, no configuration
// needed) — so SSO works out of the box there with nothing to fill in.
// A church using a custom domain still needs to set APP_BASE_URL
// explicitly, since RENDER_EXTERNAL_URL always reflects the onrender.com
// URL, never a custom domain. Elsewhere (not Render), both are unset and
// this returns undefined, same as before.
function appBaseUrl() {
  return process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL;
}

module.exports = { appBaseUrl };
