import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showNotification,
	showMessage,
	setButtonLoading,
	onDomReady,
} from '../shared/form-utils.js';

/**
 * Frontend JavaScript for Fair Audience Audience Signup
 *
 * @package FairAudience
 */

const CSS_PREFIX = 'fair-audience-audience';

(function () {
	'use strict';

	onDomReady(initializeAudienceSignupForms);

	/**
	 * Initialize all audience signup forms on the page
	 */
	function initializeAudienceSignupForms() {
		const forms = document.querySelectorAll('.fair-audience-audience-form');

		forms.forEach(function (form) {
			setupFormSubmission(form);
		});
	}

	/**
	 * Setup form submission handling
	 * @param {HTMLElement} form The form element
	 */
	function setupFormSubmission(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			submitSignup(form);
		});
	}

	/**
	 * Parse questions config from data attribute
	 * @param {HTMLElement} container The block wrapper element
	 * @return {Array} Questions config array
	 */
	function getQuestionsConfig(container) {
		const raw = container.dataset.questions;
		if (!raw) return [];
		try {
			return JSON.parse(raw);
		} catch {
			return [];
		}
	}

	/**
	 * Validate required questionnaire fields
	 * @param {HTMLElement} form The form element
	 * @param {Array} questionsConfig Questions configuration
	 * @param {HTMLElement} messageContainer Message container element
	 * @return {boolean} True if valid
	 */
	function validateQuestionnaireFields(
		form,
		questionsConfig,
		messageContainer
	) {
		for (const question of questionsConfig) {
			if (!question.required) continue;

			const { key, type, text } = question;
			let hasValue = false;

			if (type === 'checkbox') {
				const checked = form.querySelectorAll(
					`input[name="questionnaire[${key}][]"]:checked`
				);
				hasValue = checked.length > 0;
			} else if (type === 'radio') {
				const checked = form.querySelector(
					`input[name="questionnaire[${key}]"]:checked`
				);
				hasValue = !!checked;
			} else {
				const input = form.querySelector(
					`[name="questionnaire[${key}]"]`
				);
				hasValue = input && input.value.trim() !== '';
			}

			if (!hasValue) {
				showMessage(
					messageContainer,
					/* translators: %s: question text */
					__('Please answer: ', 'fair-audience') + text,
					'error',
					CSS_PREFIX
				);
				return false;
			}
		}
		return true;
	}

	/**
	 * Collect questionnaire answers from form
	 * @param {HTMLElement} form The form element
	 * @param {Array} questionsConfig Questions configuration
	 * @return {Array} Answers array
	 */
	function collectQuestionnaireAnswers(form, questionsConfig) {
		const answers = [];

		questionsConfig.forEach(function (question, index) {
			const { key, type, text } = question;
			let answerValue = '';

			if (type === 'checkbox') {
				const checked = form.querySelectorAll(
					`input[name="questionnaire[${key}][]"]:checked`
				);
				const values = Array.from(checked).map((el) => el.value);
				answerValue = JSON.stringify(values);
			} else if (type === 'radio') {
				const checked = form.querySelector(
					`input[name="questionnaire[${key}]"]:checked`
				);
				answerValue = checked ? checked.value : '';
			} else {
				const input = form.querySelector(
					`[name="questionnaire[${key}]"]`
				);
				answerValue = input ? input.value.trim() : '';
			}

			if (answerValue !== '' && answerValue !== '[]') {
				answers.push({
					question_key: key,
					question_text: text,
					question_type: type,
					answer_value: answerValue,
					display_order: index,
				});
			}
		});

		return answers;
	}

	/**
	 * Submit signup
	 * @param {HTMLElement} form The form element
	 */
	function submitSignup(form) {
		const container = form.closest('.fair-audience-audience-signup');
		const submitButton = form.querySelector(
			'.fair-audience-audience-submit-button'
		);
		const messageContainer = form.querySelector(
			'.fair-audience-audience-message'
		);
		const successMessage =
			container.dataset.successMessage ||
			__('You have been registered successfully!', 'fair-audience');

		// Get questions config
		const questionsConfig = getQuestionsConfig(container);

		// Get form data
		const nameInput = form.querySelector('input[name="audience_name"]');
		const surnameInput = form.querySelector(
			'input[name="audience_surname"]'
		);
		const emailInput = form.querySelector('input[name="audience_email"]');
		const instagramInput = form.querySelector(
			'input[name="audience_instagram"]'
		);
		const keepInformedInput = form.querySelector(
			'input[name="audience_keep_informed"]'
		);

		// Validate inputs
		if (!nameInput || !nameInput.value.trim()) {
			showMessage(
				messageContainer,
				__('Please enter your first name.', 'fair-audience'),
				'error',
				CSS_PREFIX
			);
			return;
		}

		if (!emailInput || !emailInput.value.trim()) {
			showMessage(
				messageContainer,
				__('Please enter your email.', 'fair-audience'),
				'error',
				CSS_PREFIX
			);
			return;
		}

		// Validate required questionnaire fields
		if (
			!validateQuestionnaireFields(
				form,
				questionsConfig,
				messageContainer
			)
		) {
			return;
		}

		// Build request data
		const requestData = {
			name: nameInput.value.trim(),
			surname: surnameInput ? surnameInput.value.trim() : '',
			email: emailInput.value.trim(),
		};

		if (instagramInput && instagramInput.value.trim()) {
			requestData.instagram = instagramInput.value.trim();
		}

		if (keepInformedInput) {
			requestData.keep_informed = keepInformedInput.checked;
		}

		// Include event_date_id if linked to an event
		const eventDateId = container.dataset.eventDateId
			? parseInt(container.dataset.eventDateId, 10)
			: null;
		if (eventDateId) {
			requestData.event_date_id = eventDateId;
		}

		// Include post_id for answer emails
		const postId = container.dataset.postId
			? parseInt(container.dataset.postId, 10)
			: null;
		if (postId) {
			requestData.post_id = postId;
		}

		// Collect questionnaire answers
		const answers = collectQuestionnaireAnswers(form, questionsConfig);
		if (answers.length > 0) {
			requestData.questionnaire_answers = answers;
		}

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		// Submit to API
		const isEditMode = container.dataset.editMode === '1';

		apiFetch({
			path: '/fair-audience/v1/audience-signup',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				let message = response.message || successMessage;

				if (response.status === 'already_registered') {
					showMessage(messageContainer, message, 'info', CSS_PREFIX);
				} else if (response.status === 'pending') {
					showMessage(messageContainer, message, 'info', CSS_PREFIX);
				} else {
					showMessage(
						messageContainer,
						message,
						'success',
						CSS_PREFIX
					);
				}

				form.reset();
				submitButton.disabled = true;

				// In edit mode, clean the URL to remove the token
				if (isEditMode) {
					const url = new URL(window.location);
					url.searchParams.delete('edit_audience_signup');
					window.history.replaceState({}, '', url);
				}

				// Show notification
				showNotification(message, 'success');
			})
			.catch(function (error) {
				console.error('Audience signup error:', error);

				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to process signup. Please try again.',
						'fair-audience'
					)
				);

				showMessage(
					messageContainer,
					errorMessage,
					'error',
					CSS_PREFIX
				);
				showNotification(errorMessage, 'error');
			})
			.finally(function () {
				restoreButton();
			});
	}
})();
