# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through GitHub's
[Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability),
not a public issue. On this repo's
**[Security tab](https://github.com/neckermann/missions-partner-tracker/security/advisories/new)**,
choose **Report a vulnerability** to open a private draft advisory —
visible only to the maintainer until it's resolved, with no account or
published address needed on your end.

Include what you'd include in any good bug report: the affected route or
component, the steps to reproduce, and what you were able to see or do
that you shouldn't have been able to. A proof-of-concept against your own
local instance is welcome; no exploitation of a live deployment you don't
control.

There's no bounty program and no guaranteed response time — this is a
project maintained in spare time, not a funded product — but every report
gets a response and a fix where one is warranted.

## Why not a published email address

An email address in this file would be the maintainer's personal inbox
exposed in a public repository forever. Private Vulnerability Reporting
gives the same private channel without that trade-off, and keeps the
whole conversation (and the eventual advisory, if one's warranted)
attached to the repo and its commit history.

## If you run your own fork

This app is built for churches to fork and self-host (see
[CONTRIBUTING.md](CONTRIBUTING.md)), so a vulnerability fixed here doesn't
reach your deployment until you pull the fix into your fork and redeploy
— see [UPGRADING.md](UPGRADING.md). Watching this repo (or at least its
releases) is the only way to learn a fix landed; nothing pushes that
information to you otherwise.

If you find a vulnerability specific to something *you* changed in your
own fork — not present here — that's a question for your own church's
technical contact, not this repo's security process.
