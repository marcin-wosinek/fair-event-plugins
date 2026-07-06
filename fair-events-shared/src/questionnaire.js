/**
 * Shared frontend logic for `fair-form-*` question blocks.
 *
 * Both the Fair Form block and the Event Signup block nest the same question
 * blocks as inner blocks. Each question self-identifies on the frontend through
 * data attributes emitted by its `render.php`
 * (`data-fair-form-question`, `data-question-key/-text/-type`, `data-required`,
 * `data-max-file-size`, and `data-condition-*` on conditional sections). The
 * helpers here read those attributes, so they work unchanged for any container
 * that renders the question blocks.
 */

import { __ } from '@wordpress/i18n';

/**
 * Read the current value of a question element.
 *
 * @param {HTMLElement} questionEl Question wrapper element.
 * @return {string} The value (JSON-encoded array for multiselect).
 */
export function getQuestionValue(questionEl) {
	const questionType = questionEl.dataset.questionType;

	if (questionType === 'multiselect') {
		const checked = questionEl.querySelectorAll(
			'input[type="checkbox"]:checked'
		);
		return JSON.stringify(Array.from(checked).map((cb) => cb.value));
	}

	if (questionType === 'checkbox') {
		const checkbox = questionEl.querySelector('input[type="checkbox"]');
		return checkbox && checkbox.checked ? '1' : '0';
	}

	const input = questionEl.querySelector(
		'input:checked, select, input, textarea'
	);
	return input ? input.value : '';
}

/**
 * Evaluate a single conditional rule.
 *
 * @param {string} currentValue  The current answer value.
 * @param {string} operator      Comparison operator.
 * @param {string} expectedValue The value to compare against.
 * @return {boolean} Whether the condition is met.
 */
function evaluateCondition(currentValue, operator, expectedValue) {
	switch (operator) {
		case 'equals':
			return currentValue === expectedValue;
		case 'not_equals':
			return currentValue !== expectedValue;
		case 'contains':
			return currentValue.includes(expectedValue);
		case 'not_empty':
			return currentValue.trim() !== '';
		default:
			return false;
	}
}

/**
 * Whether an event ticket option (identified by its short name) is currently
 * checked, across both the main options and the post-signup "add activities"
 * fieldsets.
 *
 * @param {HTMLElement} form      The form (or container) element.
 * @param {string}      shortName The option's short name.
 * @return {boolean} Whether a matching option checkbox is checked.
 */
function isEventOptionSelected(form, shortName) {
	const escaped =
		typeof CSS !== 'undefined' && CSS.escape
			? CSS.escape(shortName)
			: shortName;
	return !!form.querySelector(
		`input[name="ticket_option_ids[]"][data-option-short-name="${escaped}"]:checked,` +
			`input[name="add_option_ids[]"][data-option-short-name="${escaped}"]:checked`
	);
}

/**
 * Resolve whether a conditional section keyed on an event option should show,
 * honoring the selected/not_selected operator and an empty short name.
 *
 * @param {HTMLElement} form    The form (or container) element.
 * @param {HTMLElement} section The conditional section element.
 * @return {boolean} Whether the section's own condition is met.
 */
function evaluateEventOptionCondition(form, section) {
	const shortName = section.dataset.conditionOptionShortName;
	if (!shortName) {
		return false;
	}
	const selected = isEventOptionSelected(form, shortName);
	return section.dataset.conditionOperator === 'not_selected'
		? !selected
		: selected;
}

/**
 * Show/hide conditional sections based on their controlling question's value
 * (the default "question" source) or whether an event option is selected (the
 * "eventOption" source).
 *
 * @param {HTMLElement} form The form (or container) element.
 */
export function evaluateConditionals(form) {
	const conditionals = form.querySelectorAll('[data-fair-form-conditional]');
	conditionals.forEach((section) => {
		if (section.dataset.conditionSource === 'eventOption') {
			// A section nested inside a hidden conditional stays hidden
			// regardless of its own condition.
			const visible =
				isQuestionVisible(section.parentElement) &&
				evaluateEventOptionCondition(form, section);
			section.classList.toggle('fair-form-conditional-visible', visible);
			return;
		}

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

		// If the controlling question is itself inside a hidden conditional,
		// hide this section too.
		if (!isQuestionVisible(questionEl)) {
			section.classList.remove('fair-form-conditional-visible');
			return;
		}

		const currentValue = getQuestionValue(questionEl);
		const visible = evaluateCondition(
			currentValue,
			operator,
			expectedValue
		);
		section.classList.toggle('fair-form-conditional-visible', visible);
	});
}

/**
 * Determine whether a question is currently visible (not inside a hidden
 * conditional section, accounting for nesting).
 *
 * @param {HTMLElement} el Question wrapper or conditional section element.
 * @return {boolean} Whether the element is visible.
 */
export function isQuestionVisible(el) {
	const conditional = el.closest('[data-fair-form-conditional]');
	if (!conditional) {
		return true;
	}
	if (!conditional.classList.contains('fair-form-conditional-visible')) {
		return false;
	}
	// Check parent conditionals (nested case).
	return isQuestionVisible(conditional.parentElement);
}

/**
 * Collect answers from all visible question blocks within a form.
 *
 * @param {HTMLElement} form The form (or container) element.
 * @return {Array<Object>} Answers ready for the `questionnaire_answers` payload.
 */
export function collectQuestionAnswers(form) {
	const questionElements = form.querySelectorAll('[data-fair-form-question]');
	const answers = [];

	questionElements.forEach((el, index) => {
		// Skip questions inside hidden conditional sections.
		if (!isQuestionVisible(el)) {
			return;
		}

		const questionType = el.dataset.questionType;
		let answerValue = '';

		if (questionType === 'file_upload') {
			// File uploads are handled separately via FormData. Store a
			// placeholder that the server replaces with the attachment ID.
			const fileInput = el.querySelector('input[type="file"]');
			answerValue =
				fileInput && fileInput.files.length > 0
					? '__file_pending__'
					: '';
		} else if (questionType === 'multiselect') {
			// Collect all checked checkboxes and JSON-encode.
			const checked = el.querySelectorAll(
				'input[type="checkbox"]:checked'
			);
			const values = Array.from(checked).map((cb) => cb.value);
			answerValue = JSON.stringify(values);
		} else if (questionType === 'checkbox') {
			const checkbox = el.querySelector('input[type="checkbox"]');
			answerValue = checkbox && checkbox.checked ? '1' : '0';
		} else {
			// For select, radio, text, textarea - get value from first
			// input/select/textarea.
			const input = el.querySelector(
				'input:checked, select, input, textarea'
			);
			if (!input) {
				return;
			}
			answerValue = input.value;
		}

		answers.push({
			question_key: el.dataset.questionKey,
			question_text: el.dataset.questionText,
			question_type: questionType,
			answer_value: answerValue,
			display_order: index,
		});
	});

	return answers;
}

/**
 * Validate the nested question blocks within a form.
 *
 * Checks required questions (respecting conditional visibility), phone format
 * (E.164), and file-upload size limits. The caller is responsible for any
 * non-question fields (name/email).
 *
 * @param {HTMLElement} form The form (or container) element.
 * @return {string|null} An error message, or null when valid.
 */
export function validateQuestions(form) {
	// Validate required questions (skip those inside hidden conditional sections).
	const requiredQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-required="1"]'
	);
	for (const el of requiredQuestions) {
		if (!isQuestionVisible(el)) {
			continue;
		}

		const questionType = el.dataset.questionType;
		let hasValue = false;

		if (questionType === 'file_upload') {
			const fileInput = el.querySelector('input[type="file"]');
			hasValue = fileInput && fileInput.files.length > 0;
		} else if (questionType === 'multiselect') {
			hasValue =
				el.querySelectorAll('input[type="checkbox"]:checked').length >
				0;
		} else if (questionType === 'checkbox') {
			hasValue = !!el.querySelector('input[type="checkbox"]:checked');
		} else if (el.querySelector('input[type="radio"]')) {
			hasValue = !!el.querySelector('input[type="radio"]:checked');
		} else {
			const input = el.querySelector('input, textarea, select');
			hasValue = input && input.value.trim() !== '';
		}

		if (!hasValue) {
			const questionText = el.dataset.questionText || '';
			return (
				__('Please answer the required question: ', 'fair-audience') +
				questionText
			);
		}
	}

	// Validate phone questions (E.164 format with country code).
	const phoneQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="phone"]'
	);
	for (const el of phoneQuestions) {
		if (!isQuestionVisible(el)) {
			continue;
		}
		const input = el.querySelector('input[type="tel"]');
		const value = input ? input.value.trim() : '';
		if (!value) {
			continue;
		}
		if (!/^\+[1-9]\d{6,14}$/.test(value)) {
			const questionText = el.dataset.questionText || '';
			return (
				__(
					'Please enter a valid phone number with country code (e.g. +49170...): ',
					'fair-audience'
				) + questionText
			);
		}
	}

	// Validate email questions (format check).
	const emailQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="email"]'
	);
	for (const el of emailQuestions) {
		if (!isQuestionVisible(el)) {
			continue;
		}
		const input = el.querySelector('input[type="email"]');
		const value = input ? input.value.trim() : '';
		if (!value) {
			continue;
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
			const questionText = el.dataset.questionText || '';
			return (
				__(
					'Please enter a valid email address for: ',
					'fair-audience'
				) + questionText
			);
		}
	}

	// Validate file upload constraints (size), skip hidden ones.
	const fileUploadQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="file_upload"]'
	);
	for (const el of fileUploadQuestions) {
		if (!isQuestionVisible(el)) {
			continue;
		}
		const fileInput = el.querySelector('input[type="file"]');
		if (!fileInput || fileInput.files.length === 0) {
			continue;
		}

		const file = fileInput.files[0];
		const maxSizeMB = parseInt(el.dataset.maxFileSize, 10) || 5;
		const maxSizeBytes = maxSizeMB * 1024 * 1024;

		if (file.size > maxSizeBytes) {
			const questionText = el.dataset.questionText || '';
			return (
				questionText +
				': ' +
				__('File is too large. Maximum size is ', 'fair-audience') +
				maxSizeMB +
				' MB.'
			);
		}
	}

	return null;
}

/**
 * Whether the form has any pending file uploads in visible questions.
 *
 * @param {HTMLElement} form The form (or container) element.
 * @return {boolean} True when at least one file is selected.
 */
export function hasFileUploads(form) {
	const fileQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="file_upload"]'
	);
	for (const el of fileQuestions) {
		if (!isQuestionVisible(el)) {
			continue;
		}
		const fileInput = el.querySelector('input[type="file"]');
		if (fileInput && fileInput.files.length > 0) {
			return true;
		}
	}
	return false;
}

/**
 * Append selected files from visible file-upload questions to a FormData
 * object, keyed as `fair_form_file_{question_key}` (the convention the server
 * expects).
 *
 * @param {HTMLElement} form     The form (or container) element.
 * @param {FormData}    formData The FormData to append to.
 */
export function appendQuestionFiles(form, formData) {
	const fileQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="file_upload"]'
	);
	fileQuestions.forEach((el) => {
		if (!isQuestionVisible(el)) {
			return;
		}
		const fileInput = el.querySelector('input[type="file"]');
		if (fileInput && fileInput.files.length > 0) {
			formData.append(
				'fair_form_file_' + el.dataset.questionKey,
				fileInput.files[0]
			);
		}
	});
}

/**
 * Render an image preview for a selected file inside its question wrapper.
 *
 * @param {HTMLInputElement} input The file input element.
 */
export function handleFilePreview(input) {
	const wrapper = input.closest('[data-fair-form-question]');
	if (!wrapper) {
		return;
	}
	// Remove existing preview.
	const existing = wrapper.querySelector('.fair-form-file-preview');
	if (existing) {
		existing.remove();
	}

	if (!input.files || input.files.length === 0) {
		return;
	}

	const file = input.files[0];
	if (!file.type.startsWith('image/')) {
		return;
	}

	const preview = document.createElement('div');
	preview.className = 'fair-form-file-preview';

	const img = document.createElement('img');
	img.alt = file.name;
	img.src = URL.createObjectURL(file);
	img.onload = () => URL.revokeObjectURL(img.src);

	preview.appendChild(img);
	wrapper.appendChild(preview);
}

/**
 * Wire up question behavior on a form: file previews and conditional logic.
 *
 * @param {HTMLElement} form The form (or container) element.
 */
export function setupQuestionnaire(form) {
	// Set up file upload previews.
	const fileInputs = form.querySelectorAll(
		'[data-question-type="file_upload"] input[type="file"]'
	);
	fileInputs.forEach((input) => {
		input.addEventListener('change', () => handleFilePreview(input));
	});

	// Evaluate conditionals on load and on any input change.
	evaluateConditionals(form);
	form.addEventListener('input', () => evaluateConditionals(form));
	form.addEventListener('change', () => evaluateConditionals(form));
}
