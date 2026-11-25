# Template packs

Starting points a church can import instead of building from scratch: survey questions, a support
menu, trip requirement documents, trip application questions, and email update wording. The app
ships **no** church content in its code; everything here is a plain JSON file you can read, edit and
share.

## Using one

1. Download a `.json` file from this folder (or write your own).
2. In the admin area, open the page for that kind and choose its **Import…** button:
   - **Settings → Surveys → Import a survey…** (`survey-*.json`)
   - **Settings → Support Preferences → Import a menu…** (`support-menu-*.json`)
   - **Settings → Trips → Trip Requirements → Import requirements…** (`trip-requirements-*.json`)
   - **Settings → Trips → Application Form → Import questions…** (`trip-application-questions-*.json`)
   - **Settings → Dispatch Settings → Import wording…** (`dispatch-wording-*.json`)
3. Choose the file (or paste its text), press **Check this pack** to see what it would do, then **Import**.

Importing only **adds**: your existing options, questions and requirements are never deleted, and an
item with the same name (group and label, or label) as one you already have is skipped, so importing
the same pack twice does nothing the second time. A survey becomes a new **draft** survey. The one
exception is **email update wording**, which replaces the subject line, sign-off and layout it
contains (and says so in the preview); anything the pack leaves out is kept.

Every **Import** page also has an **Export** button (or, for surveys, on the survey's own page) that
saves what you have as a pack, so a church can share its own with another.

## Format

```json
{
  "format": "missions-partner-tracker-pack",
  "version": 1,
  "kind": "survey",
  "title": "A name shown in the preview",
  "description": "One or two sentences about what this is for.",
  "data": { }
}
```

`kind` is one of `survey`, `supportMenu`, `applicationQuestions`, `tripRequirements`,
`dispatchWording`; `data` depends on the kind (look at the example of that kind).

| Kind | `data` |
|---|---|
| `survey` | `{ "survey": { "title", "intro", "questions": [ { "kind": "text" \| "yesno" \| "single" \| "multiple" \| "photo", "label", "choices"?, "allowOther"?, "required"?, "field"? } ] } }`. `field` links a question to a part of the partner's record (see the survey docs) so an answer can be approved onto it. |
| `supportMenu` | `{ "options": [ { "group", "label", "kind"?: "offer" \| "single" \| "multiple" \| "text", "choices"?, "allowOther"?, "staffOnly"? } ] }` |
| `applicationQuestions` | `{ "tripApplicationTemplate": [ question ], "tripQuestionLibrary": [ question ] }` where a question is `{ "label", "type"?: "text" \| "textarea" \| "select" \| "checkboxes" ..., "required"?, "options"? }` |
| `tripRequirements` | `{ "tripRequirementTemplate": [ item ], "tripRequirementLibrary": [ item ] }` where an item is `{ "label", "kind"?, "bodyText"?, "reminderLeadDays"?, "minorsOnly"? }` |
| `dispatchWording` | `{ "emailDispatchSubjectTemplate"?, "emailDispatchSignature"?, "emailDispatchLayout"?: "classic" \| "snapshot" }` |

A pack is checked strictly on import and refused, with the reason, if anything is wrong. Keep wording
neutral ("we", "your church") rather than naming one church, so a pack works for anyone.

## The examples here

| File | What it is |
|---|---|
| `survey-care-check-in.json` | A gentle regular check-in |
| `survey-annual-update.json` | Contact details, emergency contact, a photo and a short update (linked to the record) |
| `survey-getting-to-know-you.json` | A fuller partnership survey for restarting a relationship |
| `survey-furlough-planning.json` | Plan a time home and visits |
| `support-menu-example.json` | Ways a church and care team can support a partner |
| `trip-requirements-starter.json` | A liability release and a minor travel release (not legal advice: have your counsel review) |
| `trip-application-questions-starter.json` | Questions every trip application asks, plus a library |
| `dispatch-wording-example.json` | An email update subject line and sign-off |

The public demo imports these on every reset so it shows everything.
