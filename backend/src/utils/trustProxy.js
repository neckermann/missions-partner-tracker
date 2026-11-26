// How many reverse proxies sit between a visitor and this process, for Express's "trust proxy" setting.
// The sign-in rate limits key on the visitor's address, which behind a proxy is only in X-Forwarded-For.
// Trust too few hops and every visitor shares the proxy's address (one bucket for the whole site); trust
// too many and a visitor can write their own address into the header and never hit a limit.
//
// Render and most single-proxy hosts (nginx or a load balancer in front) are exactly 1, which is the
// default. Set TRUST_PROXY to 0 if this process is reached directly with nothing in front of it, or to 2
// if there are two (for example Cloudflare in front of Render). Never "true": that trusts the whole header.
function readTrustProxy(env = process.env) {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw === "") return { hops: 1, explicit: false };
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 10) return { hops: n, explicit: true };
  return { hops: 1, explicit: false, invalid: raw };
}

// The value to hand to app.set("trust proxy", ...): false for none, otherwise the hop count.
function trustProxySetting({ hops }) {
  return hops === 0 ? false : hops;
}

// One plain line for the start-up log, so a wrong guess is visible rather than silent.
function describeTrustProxy({ hops, explicit, invalid }) {
  if (invalid !== undefined) {
    return `TRUST_PROXY="${invalid}" is not a number from 0 to 10, so one proxy hop is assumed.`;
  }
  const where =
    hops === 0
      ? "none (this process is reached directly)"
      : `${hops} proxy hop${hops === 1 ? "" : "s"} in front of this process`;
  return (
    `Sign-in rate limits read the visitor's address assuming ${where}${explicit ? "" : " (the default)"}. ` +
    `If that is wrong, set TRUST_PROXY: 0 for nothing in front, 2 for two proxies. ` +
    `With the wrong number, visitors share one limit or can dodge it.`
  );
}

module.exports = { readTrustProxy, trustProxySetting, describeTrustProxy };
