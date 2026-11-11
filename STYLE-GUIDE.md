# Style guide

**Last verified**: 2026-11-11 · **Owner**: @neckermann

Design tokens, component patterns, and copy tone for this app. For
contribution process/code-style rules (no linter note, comment
philosophy, migrations), see
[CONTRIBUTING.md § Code style](CONTRIBUTING.md#code-style).

## Design tokens

Branding is entirely church-configurable — never hardcode a value
these tokens cover (see
[CONTRIBUTING.md § The one rule that matters most](CONTRIBUTING.md#the-one-rule-that-matters-most-keep-forks-upgradable)).
Defined as CSS custom properties in `frontend/src/index.css`, each with
a hardcoded fallback for a church that hasn't set one:

| Token | Used for | Fallback |
|---|---|---|
| `--brand-header-color` | Header + admin sidebar background | `#2c2a28` |
| `--brand-color` | Buttons, links, headings, letterhead — the color people associate with the church | `#2a5d3c` |
| `--brand-highlight-color` | Hover/focus/active/selected interaction feedback | `#a6540f` |
| `--brand-font` | Body font | system font stack |

Headings/body text have their own fixed-contrast rule independent of
`--brand-color` (WCAG AA, 4.5:1) — see the comment above the relevant
rule in `index.css` before changing how a brand color is applied to
text.

## Component patterns — reuse before you build

- **Confirmations**: `useConfirmDialog` (`frontend/src/hooks/useConfirmDialog.jsx`),
  never `window.confirm`/`prompt`. See
  [CONTRIBUTING.md § Code style](CONTRIBUTING.md#code-style) for the
  call shape, `ConfirmMessageBody` for plain one-sentence confirms, and
  the nested-`Modal` Escape-key pitfall it documents.
- **Forms**: `PartnerSelect`, `AddressFields`, `SendingPartySection`,
  `PresetOrCustomSelect`, `AlbumLinkField`, `SourcePicker`/`SourceLink`
  — shared building blocks across the partner-detail sections and the
  Trip/Support/Prayer-Request/One-Time-Need pages. Check these before
  writing a new field-group component.
- **New record types**: follow the existing nullable dual-FK +
  CHECK-constraint pattern (`SupportEntry`/`Newsletter`/`Document` in
  `backend/prisma/schema.prisma`) rather than a new join-table shape —
  see [CONTRIBUTING.md § Extending the data model](CONTRIBUTING.md#extending-the-data-model).
- **Admin page shell**: `AdminLayout`/`AdminSidebar`. A page gated by a
  feature flag uses `RequireAdminFeature` client-side as a UX
  convenience only — the real enforcement is backend `requireFeature`
  (404, not a UI state). See [SPEC.md § 3.3](SPEC.md) and § 4 for
  the feature flag registry.
- **Section-level editing**: `EditableSection` — lets one part of a
  detail page save independently rather than one giant form.
- **Review/approval flows**: `NotificationReviewModal`,
  `ApproveRestrictedTextConfirmBody`, `UrgentSendConfirmBody` — the
  pattern to extend for any new content needing a human-review step
  before it reaches someone.

Full inventory of named shared components: [SPEC.md § 3.3](SPEC.md).

## Copy tone

Match the voice already used across `CONTRIBUTING.md`, `SPEC.md`, and
this doc set: plain, direct, explains *why* a decision was made rather
than just describing *what* exists, and states a tradeoff explicitly
instead of hiding it. Avoid marketing language in admin-facing UI copy
and docs — this is software a volunteer admin configures, not a
product being sold to them.

## Accessibility

Covered by an automated axe-core pass in the e2e suite
(`frontend/e2e/`) against the public-facing pages and the admin
dashboard — see [CONTRIBUTING.md § End-to-end tests](CONTRIBUTING.md#end-to-end-tests-frontende2e).
Run it before shipping a new page rather than relying on manual
inspection alone.

## TODO

- [ ] No documented mobile-breakpoint convention was found in the
  codebase (no shared breakpoint constants/mixins located) — confirm
  whether one exists before writing a rule here, or whether responsive
  behavior is handled ad hoc per page today.
