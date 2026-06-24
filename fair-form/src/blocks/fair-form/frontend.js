import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showMessage,
	setButtonLoading,
	onDomReady,
} from 'fair-events-shared';
import {
	collectQuestionAnswers,
	validateQuestions,
	hasFileUploads,
	appendQuestionFiles,
	setupQuestionnaire,
} from 'fair-events-shared';

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

	// Wire up file previews and conditional logic for nested questions.
	setupQuestionnaire(form);
}

function submitForm(form) {
	const wrapper = form.closest('.fair-form');
	const messageContainer = form.querySelector('.fair-form-message');
	const submitButton = form.querySelector('.fair-form-submit-button');

	// Validate all question blocks (required, phone format, file sizes, email format).
	const validationError = validateQuestions(form);
	if (validationError) {
		showMessage(messageContainer, validationError, 'error', 'fair-form');
		return;
	}

	const restoreButton = setButtonLoading(
		submitButton,
		__('Submitting...', 'fair-audience')
	);

	const mailingSignup =
		form.querySelector('input[name="fair_form_mailing_signup"]')?.checked ||
		false;
	const mailingCategories = mailingSignup
		? Array.from(
				form.querySelectorAll(
					'input[name="fair_form_mailing_categories[]"]:checked'
				)
		  ).map((cb) => parseInt(cb.value, 10))
		: [];
	const questionnaireAnswers = collectQuestionAnswers(form);

	const eventDateId = parseInt(wrapper?.dataset.eventDateId, 10) || 0;
	const postId = parseInt(wrapper?.dataset.postId, 10) || 0;
	const notificationEmail = wrapper?.dataset.notificationEmail || '';
	const blockFormId = wrapper?.dataset.formId || '';
	const blockFormTitle = wrapper?.dataset.formTitle || '';

	let fetchOptions;

	if (hasFileUploads(form)) {
		// Use FormData for multipart submission with files.
		const formData = new FormData();
		formData.append('mailing_signup', mailingSignup ? '1' : '0');
		formData.append(
			'mailing_category_ids',
			JSON.stringify(mailingCategories)
		);
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
		if (notificationEmail) {
			formData.append('notification_email', notificationEmail);
		}
		if (blockFormId) {
			formData.append('form_id', blockFormId);
		}
		if (blockFormTitle) {
			formData.append('form_title', blockFormTitle);
		}

		// Append selected files (skip hidden questions).
		appendQuestionFiles(form, formData);

		fetchOptions = {
			path: '/fair-form/v1/fair-form-submit',
			method: 'POST',
			body: formData,
		};
	} else {
		// Use JSON for submissions without files.
		const requestData = {
			mailing_signup: mailingSignup,
			mailing_category_ids: mailingCategories,
			questionnaire_answers: questionnaireAnswers,
		};

		if (eventDateId > 0) {
			requestData.event_date_id = eventDateId;
		}
		if (postId > 0) {
			requestData.post_id = postId;
		}
		if (notificationEmail) {
			requestData.notification_email = notificationEmail;
		}
		if (blockFormId) {
			requestData.form_id = blockFormId;
		}
		if (blockFormTitle) {
			requestData.form_title = blockFormTitle;
		}

		fetchOptions = {
			path: '/fair-form/v1/fair-form-submit',
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
			form.querySelectorAll('.fair-form-file-preview').forEach((el) =>
				el.remove()
			);
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
