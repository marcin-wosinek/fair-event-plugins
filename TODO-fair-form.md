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

## Phase 2: Option-based question blocks (select-one, multiselect, radio)

Goal: option-based question types with draggable option inner blocks.

- [x] DB migration: add `multiselect` to `question_type` ENUM
  - [x] Update `src/Database/Schema.php` ENUM definition
  - [x] Add migration v1.25.0 in `fair-audience.php`
  - [x] Update `VALID_QUESTION_TYPES` in `src/Models/QuestionnaireAnswer.php`
  - [x] Update `enum` in `src/API/FairFormController.php`
- [x] Create child block `fair-audience/fair-form-option` - reusable option block for all option-based questions
  - [x] `parent: ["fair-audience/fair-form-select-one", "fair-audience/fair-form-multiselect", "fair-audience/fair-form-radio"]`
  - [x] Single `value` attribute, inline editable input
  - [x] `render.php` returns empty - parent blocks iterate `$block->inner_blocks` to render
- [x] Create child block `fair-audience/fair-form-select-one` - dropdown question
  - [x] Uses InnerBlocks with `fair-form-option` children
  - [x] `render.php` renders `<select>` from inner block values
- [x] Create child block `fair-audience/fair-form-multiselect` - checkbox group question
  - [x] Uses InnerBlocks with `fair-form-option` children
  - [x] `render.php` renders checkbox fieldset, `data-question-type="multiselect"`
- [x] Create child block `fair-audience/fair-form-radio` - radio button question (all options visible)
  - [x] Uses InnerBlocks with `fair-form-option` children
  - [x] `render.php` renders radio fieldset, `data-question-type="radio"`
- [x] Update parent `frontend.js` - handle multiselect (collect checked checkboxes, JSON-encode values) + radio validation
- [x] Update parent `editor.js` - add new blocks to ALLOWED_BLOCKS array
- [x] Add block transforms between select-one, multiselect, and radio (all directions, preserving inner blocks)
- [x] Use `generateQuestionKey()` from `shared/question-utils.js` for auto-key derivation
- [x] Register all new blocks in `BlockHooks.php`
- [x] Fix child block.json `style` field to reference `style-editor.css` (no viewScript means no `style-frontend.css`)
- [ ] Test: add select-one, multiselect, and radio questions, submit, verify answers stored correctly

## Phase 3: File upload question block

Goal: image/file upload capability.

- [x] DB migration: add `file_upload` to `question_type` ENUM (v1.26.0)
- [x] Create child block `fair-audience/fair-form-file-upload`
  - [x] `block.json` - attributes: questionText, questionKey, required, acceptedTypes (default "image/*"), maxFileSize (default 5MB)
  - [x] `editor.js` - upload area preview with settings
  - [x] `render.php` - `<input type="file">` with data attributes, client-side validation attributes
  - [x] `style.css`
- [x] Update `FairFormController.php` for multipart/form-data handling
  - [x] Detect file uploads in request
  - [x] Use `wp_handle_upload()` to process files into WP media library
  - [x] Store attachment ID in answer_value
- [x] Update parent `frontend.js` - build FormData when file inputs are present, switch from JSON to multipart submission
- [x] Update parent `editor.js` - add file-upload to ALLOWED_BLOCKS array
- [x] Use `generateQuestionKey()` from `shared/question-utils.js` for auto-key derivation
- [x] Register block in `BlockHooks.php`
- [ ] Test: upload image via form, verify attachment created and answer stored

## Phase 4: Conditional sections

Goal: show/hide groups of fields based on answers to previous questions.

- [x] Create block `fair-audience/fair-form-conditional`
  - [x] `block.json` - attributes: `conditionQuestionKey` (string, which question to watch), `conditionOperator` (string: `equals`, `not_equals`, `contains`, `not_empty`), `conditionValue` (string, the value to match against)
  - [x] `parent: ["fair-audience/fair-form"]` - can only be placed inside the main form
  - [x] Uses InnerBlocks - can contain any of the same blocks the fair-form allows (question blocks, core/heading, core/paragraph, core/list) plus other conditional sections (nesting)
  - [x] `editor.js` - InnerBlocks container with InspectorControls for condition settings. Show a dropdown of available question keys (populated from sibling blocks via `useSelect` + `getBlocks`). Visual indicator showing the condition rule
  - [x] `render.php` - wraps `$content` in a `<div>` with data attributes: `data-fair-form-conditional`, `data-condition-question-key`, `data-condition-operator`, `data-condition-value`. Hidden by default via CSS (`display: none`)
  - [x] `style.css` - default hidden state, visible state when `.fair-form-conditional-visible`
  - [x] `editor.css` - always visible in editor with a visual border/label showing the condition
- [x] Update parent `frontend.js`
  - [x] On form load and on input change, evaluate all `[data-fair-form-conditional]` elements
  - [x] For each conditional section, find the question element matching `data-condition-question-key`, read its current value, apply the operator, toggle `.fair-form-conditional-visible` class
  - [x] Listen to `change` and `input` events on all form inputs to re-evaluate conditions
  - [x] When collecting answers, skip questions inside hidden conditional sections (not visible = not submitted)
  - [x] When validating required fields, skip those inside hidden conditional sections
- [x] Update parent `editor.js` - add `fair-audience/fair-form-conditional` to ALLOWED_BLOCKS
- [x] Register block in `BlockHooks.php`
- [ ] Test: create form with a radio/select question, add conditional section that shows only when a specific option is selected, verify show/hide on frontend, verify hidden answers are not submitted

### Condition operators

| Operator | Description | Use case |
|---|---|---|
| `equals` | Exact match against `conditionValue` | Show section when "Yes" is selected |
| `not_equals` | Does not match `conditionValue` | Show section when anything except "No" is selected |
| `contains` | Value contains `conditionValue` (for multiselect JSON) | Show section when "Other" is among checked options |
| `not_empty` | Any non-empty value (ignores `conditionValue`) | Show section when any answer is provided |

### Example frontend logic

```javascript
function evaluateConditionals(form) {
    const conditionals = form.querySelectorAll('[data-fair-form-conditional]');
    conditionals.forEach((section) => {
        const questionKey = section.dataset.conditionQuestionKey;
        const operator = section.dataset.conditionOperator;
        const expectedValue = section.dataset.conditionValue;

        const questionEl = form.querySelector(
            `[data-fair-form-question][data-question-key="${questionKey}"]`
        );
        if (!questionEl) {
            section.classList.remove('fair-form-conditional-visible');
            return;
        }

        const currentValue = getQuestionValue(questionEl);
        const visible = evaluateCondition(currentValue, operator, expectedValue);
        section.classList.toggle('fair-form-conditional-visible', visible);
    });
}
```

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
- Blocks with compatible attributes support transforms between each other (including inner blocks)
- Allowed blocks list lives in parent's `editor.js` (ALLOWED_BLOCKS constant), not in block.json

### Option blocks architecture

- `fair-form-option` is a shared child block used by select-one, multiselect, and radio
- Options are draggable/reorderable via WordPress InnerBlocks
- Parent blocks iterate `$block->inner_blocks` in render.php to build HTML (option block's own render.php returns empty)
- Transforms between option-based blocks preserve inner blocks
