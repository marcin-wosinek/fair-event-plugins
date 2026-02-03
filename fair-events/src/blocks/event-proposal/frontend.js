/**
 * Event Proposal Form - Frontend JavaScript
 *
 * @package FairEvents
 */

import apiFetch from '@wordpress/api-fetch';
import './frontend.css';

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializeForms);
	} else {
		initializeForms();
	}

	/**
	 * Initialize all proposal forms on the page
	 */
	function initializeForms() {
		const forms = document.querySelectorAll('.proposal-form');
		forms.forEach(setupFormSubmission);
	}

	/**
	 * Setup form submission handling
	 *
	 * @param {HTMLFormElement} form The form element
	 */
	function setupFormSubmission(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();

			// Validate form
			if (!validateForm(form)) {
				return;
			}

			// Check rate limit
			if (!checkRateLimit()) {
				const messageContainer =
					form.querySelector('.message-container');
				showMessage(
					messageContainer,
					'Please wait a few minutes before submitting another proposal.',
					'error'
				);
				return;
			}

			// Collect form data
			const data = collectFormData(form);

			// Submit proposal
			submitProposal(form, data);
		});
	}

	/**
	 * Validate form fields
	 *
	 * @param {HTMLFormElement} form The form element
	 * @return {boolean} True if form is valid
	 */
	function validateForm(form) {
		// Check all required fields
		const requiredFields = form.querySelectorAll('[required]');
		let isValid = true;

		requiredFields.forEach(function (field) {
			if (!field.value.trim()) {
				isValid = false;
				field.classList.add('error');
			} else {
				field.classList.remove('error');
			}
		});

		if (!isValid) {
			const messageContainer = form.querySelector('.message-container');
			showMessage(
				messageContainer,
				'Please fill in all required fields.',
				'error'
			);
			return false;
		}

		// Validate email format (if present)
		const emailField = form.querySelector('input[type="email"]');
		if (emailField && emailField.value) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(emailField.value)) {
				showMessage(
					form.querySelector('.message-container'),
					'Please enter a valid email address.',
					'error'
				);
				emailField.classList.add('error');
				return false;
			}
		}

		// Validate date is in the future
		const datetimeField = form.querySelector(
			'input[name="start_datetime"]'
		);
		if (datetimeField && datetimeField.value) {
			const selectedDate = new Date(datetimeField.value);
			const now = new Date();

			if (selectedDate <= now) {
				showMessage(
					form.querySelector('.message-container'),
					'Event start date must be in the future.',
					'error'
				);
				datetimeField.classList.add('error');
				return false;
			}
		}

		return true;
	}

	/**
	 * Check rate limiting via cookie
	 *
	 * @return {boolean} True if not rate limited
	 */
	function checkRateLimit() {
		const cookieName = 'fair_events_proposal_limit';
		const cookie = getCookie(cookieName);

		if (cookie) {
			const lastSubmission = parseInt(cookie, 10);
			const now = Math.floor(Date.now() / 1000);
			const timeElapsed = now - lastSubmission;

			// Rate limit: 5 minutes (300 seconds)
			if (timeElapsed < 300) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Collect form data and convert to API format
	 *
	 * @param {HTMLFormElement} form The form element
	 * @return {Object} Form data object
	 */
	function collectFormData(form) {
		const formData = new FormData(form);
		const data = {};

		// Collect simple fields
		const simpleFields = [
			'title',
			'start_datetime',
			'duration_minutes',
			'location',
			'description',
			'submitter_name',
			'submitter_email',
			'_honeypot',
		];

		simpleFields.forEach(function (field) {
			const value = formData.get(field);
			if (value !== null) {
				if (field === 'duration_minutes') {
					data[field] = parseInt(value, 10);
				} else {
					data[field] = value;
				}
			}
		});

		// Collect category IDs (checkboxes)
		const categoryIds = [];
		formData.getAll('category_ids[]').forEach(function (id) {
			categoryIds.push(parseInt(id, 10));
		});
		if (categoryIds.length > 0) {
			data.category_ids = categoryIds;
		}

		// Convert datetime-local to ISO 8601 format
		if (data.start_datetime) {
			// datetime-local returns format: "2026-01-15T14:30"
			// We need to ensure it's in ISO 8601: "2026-01-15T14:30:00"
			if (
				!data.start_datetime.includes(
					':00',
					data.start_datetime.length - 3
				)
			) {
				data.start_datetime += ':00';
			}
		}

		return data;
	}

	/**
	 * Submit proposal via REST API
	 *
	 * @param {HTMLFormElement} form The form element
	 * @param {Object} data Form data
	 */
	function submitProposal(form, data) {
		const messageContainer = form.querySelector('.message-container');
		const submitButton = form.querySelector('button[type="submit"]');

		// Disable submit button and show loading state
		submitButton.disabled = true;
		const originalButtonText = submitButton.textContent;
		submitButton.textContent = 'Submitting...';

		// Clear previous messages
		messageContainer.textContent = '';
		messageContainer.className = 'message-container';

		// Submit via apiFetch
		apiFetch({
			path: '/fair-events/v1/event-proposals',
			method: 'POST',
			data: data,
		})
			.then(function (response) {
				// Success
				showMessage(
					messageContainer,
					response.message ||
						'Thank you! Your event proposal has been submitted.',
					'success'
				);

				// Clear form
				form.reset();

				// Set rate limit cookie
				setRateLimit();

				// Re-enable button
				submitButton.disabled = false;
				submitButton.textContent = originalButtonText;
			})
			.catch(function (error) {
				// Error
				console.error('Proposal submission error:', error);

				let errorMessage =
					'Failed to submit proposal. Please try again.';

				// Extract error message from response
				if (error.message) {
					errorMessage = error.message;
				} else if (error.data && error.data.message) {
					errorMessage = error.data.message;
				}

				showMessage(messageContainer, errorMessage, 'error');

				// Re-enable button
				submitButton.disabled = false;
				submitButton.textContent = originalButtonText;
			});
	}

	/**
	 * Show message to user
	 *
	 * @param {HTMLElement} container Message container element
	 * @param {string} message Message text
	 * @param {string} type Message type (success or error)
	 */
	function showMessage(container, message, type) {
		container.textContent = message;
		container.className = 'message-container message-' + type;
	}

	/**
	 * Set rate limit cookie
	 */
	function setRateLimit() {
		const cookieName = 'fair_events_proposal_limit';
		const now = Math.floor(Date.now() / 1000);
		const expiry = new Date();
		expiry.setTime(expiry.getTime() + 5 * 60 * 1000); // 5 minutes

		document.cookie =
			cookieName +
			'=' +
			now +
			';expires=' +
			expiry.toUTCString() +
			';path=/;SameSite=Lax';
	}

	/**
	 * Get cookie value by name
	 *
	 * @param {string} name Cookie name
	 * @return {string|null} Cookie value or null if not found
	 */
	function getCookie(name) {
		const value = '; ' + document.cookie;
		const parts = value.split('; ' + name + '=');
		if (parts.length === 2) {
			return parts.pop().split(';').shift();
		}
		return null;
	}
})();
