=== Fair Form ===
Contributors: marcinwosinek
Tags: form, events, fair
Requires at least: 6.7
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 1.4.1
License: Private
License URI: https://fair-event-plugins.com

Form blocks and answer data layer for Fair Event Plugins.

== Description ==

Fair Form provides the form block family (`fair-form*`) and the questionnaire answer storage layer for Fair Event Plugins.

== Changelog ==

## 1.4.1

### Patch Changes

-   abaa3be: Give questionnaire responses' Markdown export a readable submission heading, a long-format "Submission date" label, and blank lines between every field, instead of a raw timestamp mixed in with the answers.

## 1.4.0

### Minor Changes

-   4b9d893: Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
-   4ec1056: Add a URL question block (mirrors the email question) that renders a mobile-friendly text input on the frontend, normalizes bare domains to `https://`, and rejects non-web values server-side. Stored answers render as links in the submission-detail and questionnaire-responses admin views. Also fixes the url and email questions never appearing in the block inserter inside Event Signup (fair-audience and fair-events), and extracts the question-block allow-list into fair-events-shared so fair-form-conditional stays in sync.
-   7932bb2: Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is looked up as soon as the visitor leaves the field, and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is shown live in an info bubble beneath the field, marked as read from the page. Nothing is stored — an unreachable page, a non-HTML response, or a page with no usable data simply shows no bubble. The fetch/parse logic that powers this also moves into a shared `AbstractUrlLookupController` (fair-events-shared) that fair-events' own admin lookup now extends instead of duplicating.

### Patch Changes

-   Updated dependencies [4b9d893]
-   Updated dependencies [4ec1056]
-   Updated dependencies [49f2e0a]
-   Updated dependencies [aeda159]
-   Updated dependencies [f64745d]
-   Updated dependencies [7932bb2]
    -   fair-events-shared@0.6.0

## 1.3.0

### Minor Changes

-   3e696d0: Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.
-   84cfda0: The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).

### Patch Changes

-   183d8a2: Fix the Fair Form block's "Notification Email" so it fires on every submission, not just ones where the form collects the submitter's email address and the audience-tracking plugin is active. The notification now has its own mail path in fair-form and no longer depends on fair-audience being installed.

    Note: the recipient is now resolved from the block's attributes in the page's own content. A Fair Form block placed outside a page/post's content — for example in a full-site-editing template or template part, a widget area, or a non-synced pattern used that way — will not receive notifications. Previously this worked because the recipient was carried on the rendered block markup. If you rely on a Fair Form block in a template or template part, move it into page/post content until this is addressed in a follow-up.

-   8d196d7: Fix the Fair Form block failing to assign a form id on plain-HTTP sites (common for self-hosted staging), where `crypto.randomUUID()` is unavailable outside a secure context. The block now falls back to `crypto.getRandomValues()` when generating its id.
-   22a339f: Fix question fields (short text, phone, consent, conditional section, etc.) not being insertable into the Event Signup block's Form content area.
-   1f9fcc1: Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.
-   afa93d5: Derive the phone question's placeholder example from the site's timezone instead of always showing a German example — a Madrid-configured site now shows a Spanish example, a Brussels one a Belgian example, and so on across eleven countries, falling back to the German example on unmapped timezones. An explicit placeholder set on the block still always wins.
-   Updated dependencies [7281a45]
-   Updated dependencies [84cfda0]
-   Updated dependencies [8d196d7]
-   Updated dependencies [9ae94d2]
-   Updated dependencies [1f9fcc1]
    -   fair-events-shared@0.5.0

## 1.2.0

### Minor Changes

-   a7c09e1: Standardize the Fair Form block's button on core Button block styles so it inherits the active theme like other blocks.

    Focus the per-form Questionnaire Responses table on standalone forms: participant columns, the "Add participants to group" button, and the export column picker now only appear when a loaded response actually carries a participant link, and the submission date is a clickable primary column that opens the submission detail page.

### Patch Changes

-   Updated dependencies [a7c09e1]
    -   fair-events-shared@0.4.0

## 1.1.0

### Minor Changes

-   4bc27cb: Add a consent checkbox question block so form authors can require visitors to accept terms and conditions before submitting.

### Patch Changes

-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   0858018: Expand the question label field in form question blocks into a full-width, resizable textarea so long or multiline questions no longer get cropped in the editor.
-   612b9b0: Fix the consent checkbox block being registered but not insertable: add it to the allowed-blocks lists of fair-form, fair-form-conditional, and fair-audience's event-signup block.
-   612b9b0: Fix long-text answer textareas overflowing their container due to content-box sizing, and make them auto-expand to fit longer answers instead of requiring manual resizing.
-   b5f328b: Fix the Answers Overview admin page rendering blank. It imported `ToggleGroupControl`/`ToggleGroupControlOption` from `@wordpress/components` under their stable names, which some WordPress versions only expose under the experimental aliases, crashing the whole React tree. The DataViews table also needed its columns listed explicitly via `view.fields`, which is required in the installed `@wordpress/dataviews` version.
-   99fd4ff: Replace the separate "Export CSV" and "Copy Markdown" buttons on the Questionnaire Responses admin page with a single "Export" button that opens a popup letting you choose columns (all or handpicked) and format (Markdown, CSV, or one line per person) before copying to clipboard or downloading the CSV.
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.0.0

### Major Changes

-   178d4b5: Make fair-form an empty canvas: remove hardcoded First Name / Last Name / Email / Keep Informed fields from the block; add fair-form-email field block with built-in validation; decouple submissions from fair-audience (participant_id is now nullable, submissions succeed without fair-audience active).

### Minor Changes

-   c60efeb: Add grouped answer navigation: a new Answers Overview admin page with a grouping selector (by page / event / form) backed by a `GET /fair-form/v1/questionnaire-responses/grouped` endpoint. Each row links to the filtered responses list. The Fair Form top-level menu now lands on the overview; the flat "All Answers" list moves to a submenu. Event picking in Form Answers and Submission Detail now uses grouped-by-event data instead of the fair-audience soft-dependency.
-   fd01f40: Initial scaffold: plugin bootstrap, PSR-4 autoloading (`FairForm` namespace), feature-flag registry, and build pipeline wired up in the monorepo.
-   a4ad331: Add stable `formId` UUID and `formTitle` attributes to the Fair Form block. The UUID is minted on first insert and regenerated on paste/duplicate collision. Both values are persisted in a new `form_id` / `form_title` column on the submissions table, enabling "by form" grouping in a future release. Existing submissions land in a legacy bucket (NULL form_id).
-   5043462: Move fair-form blocks and questionnaire data layer from fair-audience into fair-form. Block names (fair-audience/fair-form*) and table names (fair*audience_questionnaire\*\*) are unchanged for backward compatibility. fair-audience degrades gracefully when fair-form is absent via class_exists guards.
-   44dd064: Move form answer admin pages (Form Answers, Questionnaire Responses, Submission Detail) from fair-audience into fair-form. The pages now appear under a new Fair Form admin menu. Cross-plugin links to fair-audience (participant detail, by-event back-link, event picker) are preserved as soft dependencies pending Phase 2.

## 0.1.0

### Minor Changes

-   Initial scaffold: plugin bootstrap, PSR-4 autoloading, build pipeline.
