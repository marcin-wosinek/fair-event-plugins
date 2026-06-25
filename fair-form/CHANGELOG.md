# Changelog

## 1.0.0

### Major Changes

-   178d4b5: Make fair-form an empty canvas: remove hardcoded First Name / Last Name / Email / Keep Informed fields from the block; add fair-form-email field block with built-in validation; decouple submissions from fair-audience (participant_id is now nullable, submissions succeed without fair-audience active).

### Minor Changes

-   c60efeb: Add grouped answer navigation: a new Answers Overview admin page with a grouping selector (by page / event / form) backed by a `GET /fair-form/v1/questionnaire-responses/grouped` endpoint. Each row links to the filtered responses list. The Fair Form top-level menu now lands on the overview; the flat "All Answers" list moves to a submenu. Event picking in Form Answers and Submission Detail now uses grouped-by-event data instead of the fair-audience soft-dependency.
-   fd01f40: Initial scaffold: plugin bootstrap, PSR-4 autoloading (`FairForm` namespace), feature-flag registry, and build pipeline wired up in the monorepo.
-   a4ad331: Add stable `formId` UUID and `formTitle` attributes to the Fair Form block. The UUID is minted on first insert and regenerated on paste/duplicate collision. Both values are persisted in a new `form_id` / `form_title` column on the submissions table, enabling "by form" grouping in a future release. Existing submissions land in a legacy bucket (NULL form_id).
-   5043462: Move fair-form blocks and questionnaire data layer from fair-audience into fair-form. Block names (fair-audience/fair-form*) and table names (fair*audience_questionnaire**) are unchanged for backward compatibility. fair-audience degrades gracefully when fair-form is absent via class_exists guards.
-   44dd064: Move form answer admin pages (Form Answers, Questionnaire Responses, Submission Detail) from fair-audience into fair-form. The pages now appear under a new Fair Form admin menu. Cross-plugin links to fair-audience (participant detail, by-event back-link, event picker) are preserved as soft dependencies pending Phase 2.

## 0.1.0

### Minor Changes

-   Initial scaffold: plugin bootstrap, PSR-4 autoloading, build pipeline.
