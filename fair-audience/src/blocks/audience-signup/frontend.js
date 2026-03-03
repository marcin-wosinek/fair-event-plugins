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

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		// Submit to API
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
					form.reset();
				} else {
					showMessage(
						messageContainer,
						message,
						'success',
						CSS_PREFIX
					);
					form.reset();
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
