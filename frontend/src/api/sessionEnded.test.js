import { describe, it, expect, vi } from "vitest";
import { signInAgainIfSessionEnded } from "./client.js";

// An open admin page whose session stops working (it expired, or the church turned on the
// two-factor requirement for an account that has not enrolled) goes to sign-in, with its place
// remembered; nothing else does.
const err = (status, url) => ({ response: { status }, config: { url } });
const admin = { pathname: "/admin/partners", search: "?filter=1" };

describe("signInAgainIfSessionEnded", () => {
  it("sends an admin page's 401 to sign-in and remembers where they were", () => {
    const redirect = vi.fn();
    signInAgainIfSessionEnded(err(401, "/partners"), admin, redirect);
    expect(redirect).toHaveBeenCalledWith("/login?next=%2Fadmin%2Fpartners%3Ffilter%3D1");
  });

  it("leaves the sign-in calls alone (a wrong password is also a 401)", () => {
    const redirect = vi.fn();
    signInAgainIfSessionEnded(err(401, "/auth/login"), admin, redirect);
    signInAgainIfSessionEnded(err(401, "/auth/me"), admin, redirect);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("leaves other errors and the public site alone", () => {
    const redirect = vi.fn();
    signInAgainIfSessionEnded(err(403, "/partners"), admin, redirect);
    signInAgainIfSessionEnded(err(500, "/partners"), admin, redirect);
    signInAgainIfSessionEnded(err(401, "/public/partners"), { pathname: "/", search: "" }, redirect);
    signInAgainIfSessionEnded(new Error("Network Error"), admin, redirect);
    expect(redirect).not.toHaveBeenCalled();
  });
});
