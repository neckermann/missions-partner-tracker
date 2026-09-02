// This backend serves the frontend directly (see server.js's static file
// serving), so this is always this app's own public base URL — needed
// only to build an absolute redirect_uri for the OIDC spec (external
// identity providers require one; a relative path doesn't work there
// since it's sent to a third party, not used in a same-origin redirect).
function appBaseUrl() {
  return process.env.APP_BASE_URL;
}

module.exports = { appBaseUrl };
