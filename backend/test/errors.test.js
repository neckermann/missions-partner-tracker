const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const multer = require("multer");
const { z } = require("zod");
const { classify, formatZodIssues, errorHandler } = require("../src/middleware/errors");

// Produce a real ZodError rather than a hand-built fake, so these tests keep
// working across Zod versions instead of asserting against a shape we made up.
// (Zod 4 renamed ZodError.errors to .issues -- exactly the kind of drift that
// broke this once already.)
function zodErrorFrom(schema, value) {
  try {
    schema.parse(value);
  } catch (err) {
    return err;
  }
  throw new Error("expected the schema to reject that value");
}

describe("formatZodIssues", () => {
  test("names the field, not just the message", () => {
    const err = zodErrorFrom(z.object({ displayName: z.string() }), {});
    assert.match(formatZodIssues(err.issues), /displayName/);
  });

  test("joins a nested path with dots", () => {
    const schema = z.object({ addresses: z.object({ physical: z.object({ gpsLat: z.number() }) }) });
    const err = zodErrorFrom(schema, { addresses: { physical: { gpsLat: "north" } } });
    assert.match(formatZodIssues(err.issues), /addresses\.physical\.gpsLat/);
  });

  test("shows at most three problems and counts the rest", () => {
    const schema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() });
    const message = formatZodIssues(zodErrorFrom(schema, {}).issues);
    assert.match(message, /\(\+2 more\)/);
    assert.equal(message.split(";").length, 3);
  });

  test("never returns an empty string", () => {
    assert.ok(formatZodIssues([]).length > 0);
  });
});

describe("classify", () => {
  test("a ZodError is a 400 with a string message", () => {
    const { status, message } = classify(zodErrorFrom(z.object({ name: z.string() }), {}));
    assert.equal(status, 400);
    assert.equal(typeof message, "string");
  });

  test("a status the route set on purpose wins", () => {
    // utils/extraction.js signals 422 this way.
    assert.deepEqual(classify({ status: 422, message: "Couldn't read that file" }), {
      status: 422,
      message: "Couldn't read that file",
    });
  });

  test("a status of 500 or above is not trusted as a message", () => {
    const { status, message } = classify({ status: 500, message: "connect ECONNREFUSED 10.0.0.4:5432" });
    assert.equal(status, 500);
    assert.equal(message, "Server error");
  });

  test("malformed JSON is a 400, not a 500", () => {
    assert.equal(classify({ type: "entity.parse.failed" }).status, 400);
  });

  describe("uploads", () => {
    test("an oversized file is a 413", () => {
      const { status, message } = classify(new multer.MulterError("LIMIT_FILE_SIZE"));
      assert.equal(status, 413);
      assert.match(message, /too large/i);
    });

    test("any other multer problem is a 400", () => {
      assert.equal(classify(new multer.MulterError("LIMIT_UNEXPECTED_FILE")).status, 400);
    });
  });

  describe("Prisma codes", () => {
    test("P2025 (no such row) is a 404", () => {
      assert.deepEqual(classify({ code: "P2025" }), { status: 404, message: "Not found" });
    });

    test("P2002 (unique collision) is a 409 naming the column", () => {
      const { status, message } = classify({ code: "P2002", meta: { target: ["email"] } });
      assert.equal(status, 409);
      assert.match(message, /email/);
    });

    test("P2002 without usable metadata still returns a sentence", () => {
      const { message } = classify({ code: "P2002" });
      assert.equal(typeof message, "string");
      assert.ok(message.length > 0);
    });

    // Same Prisma code, opposite explanations: deleting a row something else
    // points at, vs. writing a row that points at a parent which isn't there.
    test("P2003 on a DELETE is a 409 about the thing referencing it", () => {
      const { status, message } = classify({ code: "P2003" }, { method: "DELETE" });
      assert.equal(status, 409);
      assert.match(message, /still references/);
    });

    test("P2003 on a write is a 400 about the bad reference", () => {
      const { status, message } = classify({ code: "P2003" }, { method: "POST" });
      assert.equal(status, 400);
      assert.match(message, /doesn't exist/);
    });

    test("P2000 (value too long) is a 400", () => {
      assert.equal(classify({ code: "P2000" }).status, 400);
    });
  });

  test("a bad or expired token is a 401", () => {
    assert.equal(classify({ name: "JsonWebTokenError" }).status, 401);
    assert.equal(classify({ name: "TokenExpiredError" }).status, 401);
  });

  describe("anything unexpected", () => {
    // The point of the generic message: a raw Prisma or JS error can name
    // schema internals, and the public API is unauthenticated.
    const leaky = {
      "a raw Error": new Error("Invalid `prisma.user.findUnique()` — column User.mfaSecret"),
      "a null": null,
      "a string": "kaboom",
      "an unknown Prisma code": { code: "P9999", message: "column Partner.gpsLat" },
    };

    for (const [label, err] of Object.entries(leaky)) {
      test(`${label} becomes a bare 500`, () => {
        assert.deepEqual(classify(err), { status: 500, message: "Server error" });
      });
    }
  });
});

describe("errorHandler", () => {
  const fakeRes = ({ headersSent = false } = {}) => {
    const sent = {};
    return {
      headersSent,
      status(code) {
        sent.status = code;
        return this;
      },
      json(body) {
        sent.body = body;
        return this;
      },
      sent,
    };
  };

  test("the error body is always a string, never Zod's array", () => {
    const res = fakeRes();
    errorHandler(zodErrorFrom(z.object({ name: z.string() }), {}), { method: "POST" }, res, () => {});
    assert.equal(res.sent.status, 400);
    assert.equal(typeof res.sent.body.error, "string");
  });

  // Blob routes stream their response; res.status() after headers are flushed
  // throws inside the handler itself.
  test("a failure mid-stream is handed to Express instead of re-sending", () => {
    const res = fakeRes({ headersSent: true });
    let forwarded = null;
    errorHandler(new Error("socket hang up"), { method: "GET" }, res, (err) => {
      forwarded = err;
    });
    assert.ok(forwarded instanceof Error);
    assert.equal(res.sent.status, undefined, "must not try to write a second response");
  });
});
