import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showMessage,
	setButtonLoading,
	onDomReady,
} from '../shared/form-utils.js';

onDomReady(initializeFairForms);

function initializeFairForms() {
	const forms = document.querySelectorAll('.fair-form-form');
	forms.forEach((form) => setupFormSubmission(form));
}

function setupFormSubmission(form) {
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		submitForm(form);
	});
}

function collectQuestionAnswers(form) {
	const questionElements = form.querySelectorAll('[data-fair-form-question]');
	const answers = [];

	questionElements.forEach((el, index) => {
		const questionType = el.dataset.questionType;
		let answerValue = '';

		if (questionType === 'file_upload') {
			// File uploads are handled separately via FormData.
			// Store a placeholder that will be replaced with attachment ID by the server.
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
		} else {
			// For select, radio, text, textarea - get value from first input/select/textarea.
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

function validateForm(form) {
	const name = form.querySelector('input[name="fair_form_name"]');
	const email = form.querySelector('input[name="fair_form_email"]');

	if (!name || !name.value.trim()) {
		return __('Please enter your first name.', 'fair-audience');
	}

	if (!email || !email.value.trim()) {
		return __('Please enter your email address.', 'fair-audience');
	}

	// Basic email validation.
	const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailPattern.test(email.value.trim())) {
		return __('Please enter a valid email address.', 'fair-audience');
	}

	// Validate required questions.
	const requiredQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-required="1"]'
	);
	for (const el of requiredQuestions) {
		const questionType = el.dataset.questionType;
		let hasValue = false;

		if (questionType === 'file_upload') {
			const fileInput = el.querySelector('input[type="file"]');
			hasValue = fileInput && fileInput.files.length > 0;
		} else if (questionType === 'multiselect') {
			hasValue =
				el.querySelectorAll('input[type="checkbox"]:checked').length >
				0;
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

	// Validate file upload constraints (size and type).
	const fileUploadQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="file_upload"]'
	);
	for (const el of fileUploadQuestions) {
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

function hasFileUploads(form) {
	const fileQuestions = form.querySelectorAll(
		'[data-fair-form-question][data-question-type="file_upload"]'
	);
	for (const el of fileQuestions) {
		const fileInput = el.querySelector('input[type="file"]');
		if (fileInput && fileInput.files.length > 0) {
			return true;
		}
	}
	return false;
}

function submitForm(form) {
	const wrapper = form.closest('.fair-form');
	const messageContainer = form.querySelector('.fair-form-message');
	const submitButton = form.querySelector('.fair-form-submit-button');

	// Validate.
	const validationError = validateForm(form);
	if (validationError) {
		showMessage(messageContainer, validationError, 'error', 'fair-form');
		return;
	}

	const restoreButton = setButtonLoading(
		submitButton,
		__('Submitting...', 'fair-audience')
	);

	const nameValue = form
		.querySelector('input[name="fair_form_name"]')
		.value.trim();
	const surnameValue = (
		form.querySelector('input[name="fair_form_surname"]')?.value || ''
	).trim();
	const emailValue = form
		.querySelector('input[name="fair_form_email"]')
		.value.trim();
	const keepInformed =
		form.querySelector('input[name="fair_form_keep_informed"]')?.checked ||
		false;
	const questionnaireAnswers = collectQuestionAnswers(form);

	const eventDateId = parseInt(wrapper?.dataset.eventDateId, 10) || 0;
	const postId = parseInt(wrapper?.dataset.postId, 10) || 0;

	let fetchOptions;

	if (hasFileUploads(form)) {
		// Use FormData for multipart submission with files.
		const formData = new FormData();
		formData.append('name', nameValue);
		formData.append('surname', surnameValue);
		formData.append('email', emailValue);
		formData.append('keep_informed', keepInformed ? '1' : '0');
		formData.append(
			'questionnaire_answers',
			JSON.stringify(questionnaireAnswers)
		);

		if (eventDateId > 0) {
			formData.append('event_date_id', eventDateId);
		}
		if (postId > 0) {
			formData.append('post_id', postId);
		}

		// Append file inputs.
		const fileQuestions = form.querySelectorAll(
			'[data-fair-form-question][data-question-type="file_upload"]'
		);
		fileQuestions.forEach((el) => {
			const fileInput = el.querySelector('input[type="file"]');
			if (fileInput && fileInput.files.length > 0) {
				formData.append(
					'fair_form_file_' + el.dataset.questionKey,
					fileInput.files[0]
				);
			}
		});

		fetchOptions = {
			path: '/fair-audience/v1/fair-form-submit',
			method: 'POST',
			body: formData,
		};
	} else {
		// Use JSON for submissions without files.
		const requestData = {
			name: nameValue,
			surname: surnameValue,
			email: emailValue,
			keep_informed: keepInformed,
			questionnaire_answers: questionnaireAnswers,
		};

		if (eventDateId > 0) {
			requestData.event_date_id = eventDateId;
		}
		if (postId > 0) {
			requestData.post_id = postId;
		}

		fetchOptions = {
			path: '/fair-audience/v1/fair-form-submit',
			method: 'POST',
			data: requestData,
		};
	}

	apiFetch(fetchOptions)
		.then((response) => {
			const successMessage =
				wrapper?.dataset.successMessage ||
				response.message ||
				__('Thank you for your submission!', 'fair-audience');
			showMessage(
				messageContainer,
				successMessage,
				'success',
				'fair-form'
			);
			form.reset();
		})
		.catch((error) => {
			const msg = extractErrorMessage(
				error,
				__('An error occurred. Please try again.', 'fair-audience')
			);
			showMessage(messageContainer, msg, 'error', 'fair-form');
		})
		.finally(() => {
			restoreButton();
		});
}
