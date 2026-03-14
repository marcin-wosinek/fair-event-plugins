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
 * Frontend JavaScript for Fair Audience Mailing Signup
 *
 * @package FairAudience
 */

const CSS_PREFIX = 'fair-audience-mailing';

(function () {
	'use strict';

	onDomReady(initializeMailingSignupForms);

	/**
	 * Initialize all mailing signup forms on the page
	 */
	function initializeMailingSignupForms() {
		const forms = document.querySelectorAll('.fair-audience-mailing-form');

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
	 * Submit signup
	 * @param {HTMLElement} form The form element
	 */
	function submitSignup(form) {
		const container = form.closest('.fair-audience-mailing-signup');
		const submitButton = form.querySelector(
			'.fair-audience-mailing-submit-button'
		);
		const messageContainer = form.querySelector(
			'.fair-audience-mailing-message'
		);
		const successMessage =
			container.dataset.successMessage ||
			__(
				'Please check your email to confirm your subscription.',
				'fair-audience'
			);

		// Get form data
		const nameInput = form.querySelector('input[name="mailing_name"]');
		const surnameInput = form.querySelector(
			'input[name="mailing_surname"]'
		);
		const emailInput = form.querySelector('input[name="mailing_email"]');

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

		if (!surnameInput || !surnameInput.value.trim()) {
			showMessage(
				messageContainer,
				__('Please enter your last name.', 'fair-audience'),
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

		// Collect selected category IDs
		const categoryCheckboxes = form.querySelectorAll(
			'input[name="mailing_categories[]"]:checked'
		);
		const categoryIds = Array.from(categoryCheckboxes).map((cb) =>
			parseInt(cb.value, 10)
		);

		// Build request data
		const requestData = {
			name: nameInput.value.trim(),
			surname: surnameInput.value.trim(),
			email: emailInput.value.trim(),
			category_ids: categoryIds,
		};

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		// Submit to API
		apiFetch({
			path: '/fair-audience/v1/mailing-signup',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				// Handle different response statuses
				let message = successMessage;

				if (response.status === 'already_subscribed') {
					message = response.message;
					showMessage(messageContainer, message, 'info', CSS_PREFIX);
				} else if (response.status === 'resent') {
					message = response.message;
					showMessage(messageContainer, message, 'info', CSS_PREFIX);
				} else {
					showMessage(
						messageContainer,
						message,
						'success',
						CSS_PREFIX
					);
					// Clear form on new signup
					form.reset();
				}

				// Show notification
				showNotification(message, 'success');
			})
			.catch(function (error) {
				console.error('Mailing signup error:', error);

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
