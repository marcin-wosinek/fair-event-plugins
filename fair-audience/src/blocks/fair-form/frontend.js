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
		const input = el.querySelector('input, textarea, select');
		if (!input) {
			return;
		}

		answers.push({
			question_key: el.dataset.questionKey,
			question_text: el.dataset.questionText,
			question_type: el.dataset.questionType,
			answer_value: input.value,
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
		const input = el.querySelector('input, textarea, select');
		if (!input || !input.value.trim()) {
			const questionText = el.dataset.questionText || '';
			return (
				__('Please answer the required question: ', 'fair-audience') +
				questionText
			);
		}
	}

	return null;
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

	const requestData = {
		name: form.querySelector('input[name="fair_form_name"]').value.trim(),
		surname: (
			form.querySelector('input[name="fair_form_surname"]')?.value || ''
		).trim(),
		email: form.querySelector('input[name="fair_form_email"]').value.trim(),
		keep_informed:
			form.querySelector('input[name="fair_form_keep_informed"]')
				?.checked || false,
		questionnaire_answers: collectQuestionAnswers(form),
	};

	// Add optional IDs from wrapper data attributes.
	const eventDateId = parseInt(wrapper?.dataset.eventDateId, 10) || 0;
	if (eventDateId > 0) {
		requestData.event_date_id = eventDateId;
	}

	const postId = parseInt(wrapper?.dataset.postId, 10) || 0;
	if (postId > 0) {
		requestData.post_id = postId;
	}

	apiFetch({
		path: '/fair-audience/v1/fair-form-submit',
		method: 'POST',
		data: requestData,
	})
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
