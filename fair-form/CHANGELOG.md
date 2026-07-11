# Changelog

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
