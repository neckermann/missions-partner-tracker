// The "passwords don't match" comparison shared by Setup.jsx and AccountSettings.jsx. Each page
// keeps its own error message and extra rules (e.g. minimum length).
export function passwordsMatch(password, confirmPassword) {
  return password === confirmPassword;
}
