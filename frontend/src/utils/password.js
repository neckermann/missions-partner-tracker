// Shared predicate behind the "passwords don't match" check duplicated in
// Setup.jsx (account creation) and AccountSettings.jsx (change-password) --
// see #135. Each page keeps its own error message and any extra rules
// (AccountSettings.jsx also enforces a minimum length); this is only the
// comparison itself.
export function passwordsMatch(password, confirmPassword) {
  return password === confirmPassword;
}
