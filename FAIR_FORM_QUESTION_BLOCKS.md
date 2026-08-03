# Fair Form Question Blocks

Checklist for adding a new question type to Fair Form (e.g. the phone, email,
and url questions). A question block is a small block (`fair-audience/fair-form-{type}`)
that can be nested inside three different parent blocks, and whose answers
flow through one shared validation/storage pipeline. Missing any one of the
steps below leaves the block registered but unusable somewhere.

## 1. The block itself

Mirror the closest existing sibling under `fair-form/src/blocks/fair-form-{type}/`:

-   `block.json` — same `questionText`/`questionKey`/`required`/`placeholder`
    attributes as the other question blocks. Set `ancestor` to name every
    parent context the question should be available in:
    -   `fair-audience/fair-form`
    -   `fair-audience/event-signup`
    -   `fair-events/event-signup`

    Omit a context only when the question type genuinely shouldn't appear
    there (e.g. file-upload is left out of both event-signup blocks because
    there's no vetted anonymous-upload path).
-   `editor.js` — the block's own editor UI (question text, key, required
    toggle, placeholder, disabled preview input).
-   `render.php` — frontend markup, via `get_block_wrapper_attributes()` with
    a `data-question-type` attribute so the shared frontend JS (step 3) can
    find it.

## 2. Block registration (`fair-form/src/Hooks/BlockHooks.php`)

-   `register_block_type( FAIR_FORM_DIR . 'build/blocks/fair-form-{type}' )`
-   `wp_set_script_translations( 'fair-form-fair-form-{type}-editor-script', 'fair-audience', $translations_path )`

## 3. The step that's easy to miss: parent `ALLOWED_BLOCKS`

`ancestor` in `block.json` is necessary but **not sufficient** — each parent
block also keeps its own hardcoded allow-list passed to
`useInnerBlocksProps`/`InnerBlocks`, and the inserter only offers a question
block where it appears in **both** places:

-   `fair-form/src/blocks/fair-form/editor.js` — `ALLOWED_BLOCKS`
-   `fair-audience/src/blocks/event-signup/editor.js` — `ALLOWED_BLOCKS`
-   `fair-events/src/blocks/event-signup/editor.js` — `FAIR_FORM_ALLOWED_BLOCKS`

Add `'fair-audience/fair-form-{type}'` to every array named in the new
block's `ancestor` list. A block with a correct `ancestor` array and no entry
here will register cleanly, pass review, and simply never show up in the
inserter.

## 4. Answer validation (shared across every submission path)

-   `fair-events-shared/src/questionnaire.js` — `validateQuestions()`: add a
    block keyed on `[data-question-type="{type}"]`, mirroring the existing
    phone/email/url blocks. Used by fair-form, and both event-signup
    frontend.js files, so one change covers all three.
-   `fair-form/src/Services/QuestionnaireService.php`:
    -   add `'{type}'` to `VALID_TYPES`
    -   add a `'{type}' === $question_type` branch in `sanitize_answers()`
        that normalizes and validates the value, rejecting with a
        `WP_Error` naming the question (matching the `invalid_email`/
        `invalid_phone`/`invalid_url` shape)
-   `FairForm\Models\QuestionnaireAnswer::VALID_QUESTION_TYPES` — mirror the
    same addition; the model's own `save()` guard re-checks this list
    independently of the service.

## 5. Schema

`question_type` is a MySQL `ENUM` (`fair-form/src/Database/Schema.php`).
`dbDelta()` for this table only runs on activation, so it won't reach
already-active installs:

-   Bump the ENUM literal in `Schema::get_questionnaire_answers_table_sql()`
    so fresh installs get the new type via `dbDelta()`.
-   Add a versioned step in `fair_form_maybe_upgrade_db()`
    (`fair-form.php`, hooked on `plugins_loaded`, versioned via the
    `fair_form_db_version` option) running a guarded
    `ALTER TABLE ... MODIFY question_type ENUM(...)` for already-active
    installs.

## 6. Admin rendering

-   `fair-form/src/Admin/submission-detail/SubmissionDetail.js` —
    `AnswerDisplay()`: add a branch for the new type if it needs special
    rendering (e.g. url renders as a link).
-   `fair-form/src/Admin/questionnaire-responses/QuestionnaireResponses.js` —
    the dynamic per-question `dynamicFields` (built from `questionColumns`):
    extend `questionColumns` to carry the question's `type`, and add a
    `render` for types that need it.

## 7. Tests

-   Component: `src/blocks/fair-form-{type}/__tests__/editor.test.jsx`.
-   API: `src/API/__tests__/FairForm{Type}Answers.api.spec.js` — accept/reject
    cases through `QuestionnaireService`.
-   E2E: `e2e/user-flows/`, modeled on the existing phone/url signup specs,
    with a matching seed block variant in the e2e fixtures.

## Verifying step 3 didn't get skipped

After wiring everything else, insert the new question block from all three
parent contexts (a Fair Form block, a fair-audience Event Signup block, and a
fair-events Event Signup block) and confirm it appears in the inserter in
each. This is the one step that produces no error and no test failure when
skipped — the block just doesn't show up.
