# TODO: Fair Form - Nested Blocks for Questionnaire Forms

Composable form builder using WordPress InnerBlocks. Parent block (`fair-audience/fair-form`) wraps child question blocks + core blocks (headings, paragraphs, lists). Submissions go to existing `questionnaire_submissions`/`questionnaire_answers` tables.

## Phase 1: Parent block + text questions

Goal: working end-to-end form with InnerBlocks architecture.

- [x] Create parent block `fair-audience/fair-form`
  - [x] `src/blocks/fair-form/block.json` - InnerBlocks parent, attributes: submitButtonText, successMessage, showKeepInformed, eventDateId
  - [x] `src/blocks/fair-form/editor.js` - `useInnerBlocksProps` with allowedBlocks (core/heading, core/paragraph, core/list + child question blocks), InspectorControls for form settings
  - [x] `src/blocks/fair-form/render.php` - `<form>` wrapper with name/email fields, keep-informed checkbox (optional), submit button, message container. Passes config via data attributes. Renders `$content` (inner blocks) inside
  - [x] `src/blocks/fair-form/frontend.js` - form submission handler: collects all `[data-fair-form-question]` values, validates required fields, POSTs to `/fair-audience/v1/fair-form-submit`
  - [x] `src/blocks/fair-form/style.css` + `editor.css`
- [x] Create child block `fair-audience/fair-form-short-text`
  - [x] `src/blocks/fair-form-short-text/block.json` - `parent: ["fair-audience/fair-form"]`, attributes: questionText, questionKey, required, placeholder
  - [x] `src/blocks/fair-form-short-text/editor.js` - text input preview + InspectorControls
  - [x] `src/blocks/fair-form-short-text/render.php` - `<input type="text">` with data-attribute convention (`data-fair-form-question`, `data-question-key`, `data-question-text`, `data-question-type="short_text"`, `data-required`)
  - [x] `src/blocks/fair-form-short-text/style.css`
- [x] Create child block `fair-audience/fair-form-long-text`
  - [x] Same pattern as short-text but with `<textarea>` and `data-question-type="long_text"`
- [x] Create `src/API/FairFormController.php`
  - [x] `POST /fair-audience/v1/fair-form-submit` - accepts name, email, surname, keep_informed, event_date_id, post_id, questionnaire_answers[]
  - [x] Creates/finds participant, creates QuestionnaireSubmission, saves QuestionnaireAnswers
  - [x] Permission: `__return_true` (public form, same as audience-signup)
- [x] Create `src/blocks/shared/question-utils.js` - `generateQuestionKey()` to auto-derive key from question text
- [x] Add block transforms between short-text and long-text (both directions)
- [x] Register blocks in `src/Hooks/BlockHooks.php`
- [x] Register controller in `src/Core/Plugin.php`
- [ ] Test: add fair-form block in editor, add headings + short-text + long-text questions, submit on frontend, verify data in DB

## Phase 2: Select-one + multiselect question blocks

Goal: option-based question types.

- [x] DB migration: add `multiselect` to `question_type` ENUM
  - [x] Update `src/Database/Schema.php` ENUM definition
  - [x] Add migration v1.25.0 in `fair-audience.php`
  - [x] Update `VALID_QUESTION_TYPES` in `src/Models/QuestionnaireAnswer.php`
  - [x] Update `enum` in `src/API/FairFormController.php`
- [x] Create child block `fair-audience/fair-form-select-one`
  - [x] `block.json` - attributes: questionText, questionKey, required, options (array of strings), displayAs (select|radio)
  - [x] `editor.js` - option list builder in InspectorControls, preview of select/radio
  - [x] `render.php` - `<select>` or radio fieldset based on displayAs attribute, with data-attribute convention
  - [x] `style.css`
- [x] Create child block `fair-audience/fair-form-multiselect`
  - [x] `block.json` - attributes: questionText, questionKey, required, options (array of strings)
  - [x] `editor.js` - option list builder, checkbox group preview
  - [x] `render.php` - checkbox fieldset, `data-question-type="multiselect"`
  - [x] `style.css`
- [x] Create `src/blocks/shared/OptionsEditor.js` - reusable options list editor component
- [x] Update parent `frontend.js` - handle multiselect (collect checked checkboxes, JSON-encode values) + radio validation
- [x] Update parent `editor.js` - add new blocks to ALLOWED_BLOCKS array
- [x] Add block transforms between select-one and multiselect (both directions)
- [x] Use `generateQuestionKey()` from `shared/question-utils.js` for auto-key derivation
- [x] Register new blocks in `BlockHooks.php`
- [x] Fix child block.json `style` field to reference `style-editor.css` (no viewScript means no `style-frontend.css`)
- [ ] Test: add select-one and multiselect questions, submit, verify answers stored correctly

## Phase 3: File upload question block

Goal: image/file upload capability.

- [ ] DB migration: add `file_upload` to `question_type` ENUM (v1.26.0)
- [ ] Create child block `fair-audience/fair-form-file-upload`
  - [ ] `block.json` - attributes: questionText, questionKey, required, acceptedTypes (default "image/*"), maxFileSize (default 5MB)
  - [ ] `editor.js` - upload area preview with settings
  - [ ] `render.php` - `<input type="file">` with data attributes, client-side validation attributes
  - [ ] `style.css`
- [ ] Update `FairFormController.php` for multipart/form-data handling
  - [ ] Detect file uploads in request
  - [ ] Use `wp_handle_upload()` to process files into WP media library
  - [ ] Store attachment ID in answer_value
- [ ] Update parent `frontend.js` - build FormData when file inputs are present, switch from JSON to multipart submission
- [ ] Update parent `editor.js` - add file-upload to ALLOWED_BLOCKS array
- [ ] Use `generateQuestionKey()` from `shared/question-utils.js` for auto-key derivation
- [ ] Register block in `BlockHooks.php`
- [ ] Test: upload image via form, verify attachment created and answer stored

## Architecture Notes

### DOM contract between parent and child blocks

Each child question block's `render.php` outputs:
```html
<div class="fair-form-question" data-fair-form-question
     data-question-key="favorite_color" data-question-text="What is your favorite color?"
     data-question-type="short_text" data-required="1">
    <label>What is your favorite color? <span class="required">*</span></label>
    <input type="text" name="fair_form_q_favorite_color" />
</div>
```

Parent's `frontend.js` collects all `[data-fair-form-question]` elements to build the submission payload.

### Shared utilities

- `src/blocks/shared/form-utils.js` - extractErrorMessage, showMessage, setButtonLoading, onDomReady
- `src/blocks/shared/question-utils.js` - generateQuestionKey (auto-derive snake_case key from question text)

### Existing code reused

- `src/Database/QuestionnaireSubmissionRepository.php` + `QuestionnaireAnswerRepository.php`
- `src/Models/QuestionnaireSubmission.php` + `QuestionnaireAnswer.php`
- `src/API/AudienceSignupController.php` - reference for participant creation flow

### Editor patterns

- Question blocks use inline editing: editable `<input>` for question text (styled as label), disabled input/textarea as answer preview
- Question key auto-derives from question text until manually edited in sidebar
- Blocks with compatible attributes support transforms between each other
- Allowed blocks list lives in parent's `editor.js` (ALLOWED_BLOCKS constant), not in block.json
