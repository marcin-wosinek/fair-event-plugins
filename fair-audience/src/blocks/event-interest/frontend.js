import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showMessage,
	setButtonLoading,
	onDomReady,
	wireNotYouButton,
} from '../shared/form-utils.js';

// Use the shared signup CSS prefix so messages render with the same look as
// the event-signup block. The message container in render.php carries the
// matching class.
const CSS_PREFIX = 'fair-audience-signup';

(function () {
	'use strict';

	onDomReady(initializeForms);

	function initializeForms() {
		const forms = document.querySelectorAll(
			'.fair-audience-event-interest-form'
		);
		forms.forEach(setupForm);
	}

	function setupForm(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			submitForm(form);
		});
		wireNotYouButton(form.querySelector('.fair-audience-not-you'));
	}

	function submitForm(form) {
		const container = form.closest('.fair-audience-event-interest');
		const submitButton = form.querySelector(
			'.fair-audience-event-interest-submit-button'
		);
		const messageContainer = form.querySelector(
			'.fair-audience-event-interest-message'
		);

		const eventId = parseInt(container.dataset.eventId, 10);
		const successMessage =
			container.dataset.successMessage ||
			__('Thanks! Check your inbox for confirmation.', 'fair-audience');

		const emailInput = form.querySelector('input[name="interest_email"]');
		const nameInput = form.querySelector('input[name="interest_name"]');
		const honeypotInput = form.querySelector(
			'input[name="interest_website"]'
		);

		if (!emailInput || !emailInput.value.trim()) {
			showMessage(
				messageContainer,
				__('Please enter your email.', 'fair-audience'),
				'error',
				CSS_PREFIX
			);
			return;
		}

		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		apiFetch({
			path: '/fair-audience/v1/event-interest',
			method: 'POST',
			data: {
				event_id: eventId,
				email: emailInput.value.trim(),
				name: nameInput ? nameInput.value.trim() : '',
				honeypot: honeypotInput ? honeypotInput.value : '',
			},
		})
			.then(function () {
				showMessage(
					messageContainer,
					successMessage,
					'success',
					CSS_PREFIX
				);
				form.reset();
			})
			.catch(function (error) {
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to register your interest. Please try again.',
						'fair-audience'
					)
				);
				showMessage(
					messageContainer,
					errorMessage,
					'error',
					CSS_PREFIX
				);
			})
			.finally(function () {
				restoreButton();
			});
	}
})();
