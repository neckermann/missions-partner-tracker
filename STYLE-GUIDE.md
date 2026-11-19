# Style guide

**Last verified**: 2026-11-19 · **Owner**: @neckermann

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

The admin UX rebuild (9 phases, tracked in GitHub issues #270/#271)
settled on the set below as the real, current patterns. Several
replace what this doc used to point to (onBlur-autosave, one-off
badges, three independent "add new" shapes, hand-rolled table markup
per page) — those are gone, not alternatives.

- **Lists with filtering**: `Table` + `FilterBar`
  (`frontend/src/components/shared/`), bound together by
  `hooks/useFilterState.js`, which syncs filter values to the URL query
  string. `FilterBar`'s `fields` prop is `{ name, label, type, options?,
  showWhen? }` — the exact contract `backend/src/reports/index.js`'s
  `listReports()` already returns, including its `resolveFields(prisma)`
  hook for dynamic option lists, so a resource's Report version and its
  live admin list can share the same field definitions. `Table` takes
  `columns` (`{ key, label, type?, align?, render?(row) }`),
  `onRowClick`, `renderActions(row)` for a trailing actions column, and
  `expandedRowId`/`renderExpanded(row)` for an inline edit-row-below-
  the-row pattern. It wraps its own `<table>` in `.table-scroll`
  (`overflow-x: auto`) automatically — a wide table scrolls horizontally
  within its own box at a narrow viewport instead of forcing the whole
  page wider; don't add a second wrapper around it.
  **Not every list is a good fit**: a resource whose rows carry
  variable-length content plus independent inline forms (Prayer
  Requests' answer flow, One-Time Needs' decide flow) uses `FilterBar`
  alone, not `Table` — forcing that content into fixed columns means
  truncating it. `AdminPrayerRequests.jsx`/`AdminOneTimeNeeds.jsx` are
  the documented examples; read their own header comments before
  deciding a new resource needs the same exception.
- **Status/kind indicators**: one `<StatusPill color label>`
  (`frontend/src/components/admin/StatusPill.jsx`) — a plain
  color+label pill, nothing else. Every value-specific color/label
  lookup (a trip's lifecycle status, a dispatch's restricted/awaiting-
  review state, etc.) stays in its own small table next to where that
  value is defined; only the pill rendering itself is shared.
- **Multi-step creation**: `Wizard`
  (`frontend/src/components/shared/Wizard.jsx`) — zero resource-specific
  logic, driven entirely by a `steps` array
  (`{ key, label, render({values, setValue}), validate?(values), optional? }`).
  **When to reach for it, not a plain form**: a field-count-driven rule,
  not a blanket "every create flow becomes a wizard." A survey across
  every "+Add X" flow in this app (Phase 6 of the rebuild) found most
  are already short (≤6 fields, one conceptual group) and stayed a
  plain inline-toggle form; `AdminPartnerForm.jsx` (10 fields across 3
  groups: Basics / Details / Visibility & status) was the one genuine
  case. Use the same bar for a new resource: short and single-topic
  stays a form, long and multi-topic becomes a `Wizard`.
- **Confirmations**: `useConfirmDialog` (`frontend/src/hooks/useConfirmDialog.jsx`),
  never `window.confirm`/`prompt`/`alert`. See
  [CONTRIBUTING.md § Code style](CONTRIBUTING.md#code-style) for the
  call shape, `ConfirmMessageBody` for plain one-sentence confirms, and
  the nested-`Modal` Escape-key pitfall it documents. A one-off action
  error (not a confirmation) — a failed delete, a failed inline save —
  goes in a `role="alert"` inline message near the action, same pattern
  as every save-error path below; never `alert()`.
- **Section-level editing**: `EditableSection`
  (`frontend/src/components/admin/EditableSection.jsx`) is the save
  standard for grouped scalar fields — explicit Edit → Save/Cancel,
  draft state kept separate from the saved record (so a failed save
  can't silently revert what someone typed), a brief success
  confirmation on save, and `utils/friendlyError.js`'s plain-language
  mapping for a server validation error instead of a raw Zod message.
  Reuse it for any new editable section rather than wiring another
  onBlur-autosave field — that pattern is retired app-wide (it shipped
  the same silent-failure bug independently in two different files
  before being replaced).
  **The one deliberate exception**: repeating-row CRUD (a trip's budget
  lines, meetings, flight segments, requirements) stays per-field
  `onBlur`, not `EditableSection` — forcing add/remove-a-row behind a
  page-level Edit toggle is worse UX than the autosave risk it would
  guard against, for content that's already one row = one independent
  record. What *does* carry over from `EditableSection`'s standard:
  every one of those handlers gets real `try/catch` with a visible
  inline error — "per-field onBlur" was never license to skip error
  handling, just to skip the Edit/Save toggle. See
  `frontend/src/pages/AdminTripBudget.jsx` for the reference shape
  (`error` state + `mapServerErrorMessage` + an inline `role="alert"`
  paragraph).
- **Photo display**: `PhotoTile` (`frontend/src/components/shared/PhotoTile.jsx`)
  — `{src, alt, shape: "circle"|"rect", size, fluidWidth, className}`.
  Replaces three previously-independent hardcoded `object-fit: cover`
  copies (Directory, Partner Detail, the Map popup). A missing `src`
  renders the same neutral placeholder background every call site
  already fell back to — it has no opinion on restricted-partner
  masking (name→initials, photo→silhouette); that's `maskData.js`'s job
  server-side, upstream of whatever `src` this component is handed.
- **Forms**: `PartnerSelect`, `AddressFields`, `SendingPartySection`,
  `PresetOrCustomSelect`, `AlbumLinkField`, `SourcePicker`/`SourceLink`
  — shared field-group building blocks. For a resource that's both
  embedded on a Partner/Trip detail page *and* has its own consolidated
  admin list (Prayer Requests, One-Time Needs, Monthly Support, Trips),
  extract one shared `*FormFields` component used by both contexts via
  a `mode`/`partnerPicker` prop rather than maintaining two copies —
  `PrayerRequestFormFields.jsx`, `SupportNeedFormFields.jsx`,
  `SupportEntryFormFields.jsx`, `TripFormFields.jsx` are the four
  existing examples and the template to copy for a fifth.
- **New record types**: follow the existing nullable dual-FK +
  CHECK-constraint pattern (`SupportEntry`/`Newsletter`/`Document` in
  `backend/prisma/schema.prisma`) rather than a new join-table shape —
  see [CONTRIBUTING.md § Extending the data model](CONTRIBUTING.md#extending-the-data-model).
- **Admin page shell**: `AdminLayout`/`AdminSidebar` — a collapsible
  grouped sidebar (Partner Care / Trips / Communications / Reports /
  Settings) plus a Home hub (search, recently-viewed, needs-attention
  cards). A settings sub-page under the Settings group uses
  `SettingsPageHeader` (`frontend/src/components/admin/SettingsPageHeader.jsx`)
  for its own back-link + title, matching the "← Back to X" convention
  `TripDetailLayout.jsx` established for a split detail page's
  sub-pages. A page gated by a feature flag uses `RequireAdminFeature`
  client-side as a UX convenience only — the real enforcement is
  backend `requireFeature` (404, not a UI state). See
  [SPEC.md § 3.3](SPEC.md) and § 4 for the feature flag registry.
- **Large detail pages**: once a single detail page outgrows one
  scroll with genuinely separate concerns sharing one record's id (a
  trip's team / meetings / requirements / budget / flight segments),
  split it into real sub-pages under a shared layout component
  (`TripDetailLayout.jsx` is the reference) rather than growing one
  file further or hiding sections behind tabs. Tabs themselves are for
  a genuine, nameable, persistently-browsable *view* switch with real
  tab-bar styling and URL state — never to hide configuration, never as
  a parking lot for one action's missing step.
- **Review/approval flows**: `DispatchReviewModal`,
  `ApproveRestrictedTextConfirmBody` — the pattern to extend for any
  new content needing a human-review step before it reaches someone.

Full inventory of named shared components: [SPEC.md § 3.3](SPEC.md).

## Buttons

One class, three modifiers, no fourth without a real reason:

- `.btn` — primary action. `var(--brand-color)` at rest, `var(--brand-highlight-color)` on hover.
- `.btn.secondary` — `#666`, for a page's non-primary actions (Edit,
  History, Cancel). Not `#999` — that only cleared ~2.85:1 contrast
  against white text, under WCAG AA's 4.5:1 minimum; `#666` clears it
  with margin.
- `.btn.danger` — `#b91c1c`, for a destructive action (Delete). Pair
  with `useConfirmDialog`'s `danger: true`, not just the red color
  alone.
- `.btn.small` — tighter padding/font-size, for a button inside a table
  row or a dense action row. Stacks with `.secondary`/`.danger`
  (`className="btn secondary small"` is the most common combination in
  the codebase).

## Responsive / mobile width

**The one real breakpoint**: `@media (max-width: 800px)`
(`frontend/src/index.css`), which stacks the admin sidebar above the
main content instead of beside it. If you add a second breakpoint,
match this value rather than inventing a new one — there's no shared
breakpoint constant/mixin today, just this one media query, duplicated
at its one other use (the public map's side-by-side-to-stacked
layout).

**A real gotcha that cost a full afternoon of admin pages their mobile
layout, worth knowing before you touch this media query again**:
`.admin-layout`'s `align-items: flex-start` is correct for the default
row layout (keeps the sidebar and main content from being stretched to
equal heights), but `align-items` swaps which axis it governs when
`flex-direction` changes — the mobile media query flips to `column`
without this, and the *same* `flex-start` then means "don't stretch
width" instead, letting `.admin-main` render at its own content's
natural width (900px+) and silently force the entire page to scroll
horizontally. Fixed with an explicit `align-items: stretch` inside the
media query, scoped to the column layout only. If a future admin page
starts overflowing sideways at mobile width again, check this
interaction before assuming the page's own markup is at fault — it's
easy to reintroduce by refactoring the media query without reading
this comment.

**Check any new/changed page at a real narrow viewport (≈390px) before
calling it done** — `document.documentElement.scrollWidth >
document.documentElement.clientWidth` is a fast way to catch this class
of bug in a script; `public-directory.spec.js`'s mobile-viewport test
is the one e2e spec that already asserts this for a public page today.

## Copy tone

Match the voice already used across `CONTRIBUTING.md`, `SPEC.md`, and
this doc set: plain, direct, explains *why* a decision was made rather
than just describing *what* exists, and states a tradeoff explicitly
instead of hiding it. Avoid marketing language in admin-facing UI copy
and docs — this is software a volunteer admin configures, not a
product being sold to them.

**Participant/public-facing copy is a separate audience from
admin-facing copy — don't reuse an admin label verbatim.** A real
example caught late in the UX rebuild: the public Trip Participant page
showed "Trip-wide documents," copied straight from the admin's own
internal label distinguishing per-trip vs. per-participant files — a
distinction that matters to an admin managing many trips' files at
once, meaningless to the one participant looking at documents for
their own trip. It's now "Documents for this trip" there. When you
reuse an admin-built data shape on a public/participant page, give it
its own label written for that reader, even if the admin-facing label
feels obvious enough to not need translating.

## Accessibility

Covered by an automated axe-core pass in the e2e suite
(`frontend/e2e/`) against the public-facing pages and the admin
dashboard — see [CONTRIBUTING.md § End-to-end tests](CONTRIBUTING.md#end-to-end-tests-frontende2e).
Run it before shipping a new page rather than relying on manual
inspection alone.
