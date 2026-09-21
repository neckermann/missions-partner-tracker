const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { generateSecret, generate, verify } = require("otplib");

// A TOTP code stays valid for its entire 30-second window, so a code seen
// once -- over a shoulder, in a screenshare, phished -- can be used again by
// someone else until it expires. routes/auth.js closes that by remembering
// the last time step it accepted for a user (User.mfaLastTimeStep) and
// handing it back to otplib as `afterTimeStep`.
//
// These pin the library behaviour that mechanism depends on. If an otplib
// upgrade changed the option name or dropped `timeStep` from the result, the
// guard in auth.js would silently stop working -- `afterTimeStep: undefined`
// is not an error, it just accepts everything.

describe("TOTP replay protection", () => {
  test("verify() returns the time step the code belongs to", async () => {
    const secret = await generateSecret();
    const token = await generate({ secret });
    const result = await verify({ secret, token });

    assert.equal(result.valid, true);
    assert.equal(typeof result.timeStep, "number", "auth.js stores this on the user");
  });

  test("a code is rejected when its own time step is already spent", async () => {
    const secret = await generateSecret();
    const token = await generate({ secret });

    const first = await verify({ secret, token });
    assert.equal(first.valid, true);

    const replay = await verify({ secret, token, afterTimeStep: first.timeStep });
    assert.equal(replay.valid, false, "the same code must not work twice");
  });

  test("without the guard the same code verifies again -- the bug this prevents", async () => {
    const secret = await generateSecret();
    const token = await generate({ secret });

    assert.equal((await verify({ secret, token })).valid, true);
    assert.equal((await verify({ secret, token })).valid, true);
  });

  test("a first-time enroller (no stored step) is not blocked", async () => {
    // mfaLastTimeStep is null until the first success, and auth.js passes
    // `?? undefined` -- which must behave as "no restriction", not "reject".
    const secret = await generateSecret();
    const token = await generate({ secret });

    const result = await verify({ secret, token, afterTimeStep: undefined });
    assert.equal(result.valid, true);
  });
});
