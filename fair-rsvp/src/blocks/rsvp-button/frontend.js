import './frontend.css';
import apiFetch from '@wordpress/api-fetch';

/**
 * Frontend JavaScript for Fair RSVP button
 *
 * @package FairRsvp
 */

(function () {
	'use strict';

	// Initialize when DOM is ready
	document.addEventListener('DOMContentLoaded', function () {
		initializeRsvpForms();
	});

	/**
	 * Initialize all RSVP forms on the page
	 */
	function initializeRsvpForms() {
		const forms = document.querySelectorAll('.fair-rsvp-form');

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
			submitRsvp(form);
		});
	}

	/**
	 * Submit RSVP
	 * @param {HTMLElement} form The form element
	 */
	function submitRsvp(form) {
		const container = form.closest('.fair-rsvp-form-container');
		const eventId = container.getAttribute('data-event-id');
		const submitButton = form.querySelector('.fair-rsvp-submit-button');
		const messageContainer = form.querySelector('.fair-rsvp-message');
		const statusDisplay = container.querySelector(
			'.fair-rsvp-current-status'
		);

		// Get selected RSVP status
		const selectedRadio = form.querySelector(
			'input[name="rsvp_status"]:checked'
		);

		if (!selectedRadio) {
			showMessage(
				messageContainer,
				'Please select an RSVP option.',
				'error'
			);
			return;
		}

		const rsvpStatus = selectedRadio.value;

		// Disable button and show loading state
		submitButton.disabled = true;
		submitButton.textContent = 'Submitting...';

		// Submit to API
		apiFetch({
			path: '/fair-rsvp/v1/rsvp',
			method: 'POST',
			data: {
				event_id: parseInt(eventId),
				rsvp_status: rsvpStatus,
			},
		})
			.then(function (response) {
				// Success!
				showMessage(
					messageContainer,
					'Your RSVP has been updated successfully!',
					'success'
				);

				// Update status display
				if (statusDisplay) {
					statusDisplay.innerHTML =
						'Your current RSVP: <strong>' +
						capitalizeFirstLetter(rsvpStatus) +
						'</strong>';
				} else {
					// Create status display if it doesn't exist
					const newStatus = document.createElement('p');
					newStatus.className = 'fair-rsvp-current-status';
					newStatus.innerHTML =
						'Your current RSVP: <strong>' +
						capitalizeFirstLetter(rsvpStatus) +
						'</strong>';
					container.appendChild(newStatus);
				}

				// Show notification
				showNotification('RSVP updated successfully!', 'success');
			})
			.catch(function (error) {
				console.error('RSVP error:', error);

				let errorMessage = 'Failed to update RSVP. Please try again.';

				if (error.message) {
					errorMessage = error.message;
				} else if (error.data && error.data.message) {
					errorMessage = error.data.message;
				}

				showMessage(messageContainer, errorMessage, 'error');
				showNotification(errorMessage, 'error');
			})
			.finally(function () {
				// Re-enable button
				submitButton.disabled = false;
				submitButton.textContent = 'Update RSVP';
			});
	}

	/**
	 * Show message in the form
	 * @param {HTMLElement} container Message container
	 * @param {string} message The message
	 * @param {string} type Message type (success, error)
	 */
	function showMessage(container, message, type) {
		container.textContent = message;
		container.className = 'fair-rsvp-message fair-rsvp-message-' + type;
		container.style.display = 'block';

		// Hide after 5 seconds
		setTimeout(function () {
			container.style.display = 'none';
		}, 5000);
	}

	/**
	 * Show a toast notification
	 * @param {string} message The message
	 * @param {string} type Notification type (success, error)
	 */
	function showNotification(message, type) {
		const notification = document.createElement('div');
		notification.className =
			'fair-rsvp-notification fair-rsvp-notification-' + type;
		notification.textContent = message;

		notification.style.cssText =
			'position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 4px; color: white; font-weight: 500; z-index: 9999; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';

		if (type === 'success') {
			notification.style.backgroundColor = '#00a32a';
		} else {
			notification.style.backgroundColor = '#d63638';
		}

		document.body.appendChild(notification);

		setTimeout(function () {
			if (notification.parentNode) {
				notification.parentNode.removeChild(notification);
			}
		}, 5000);
	}

	/**
	 * Capitalize first letter of string
	 * @param {string} str The string
	 * @returns {string} Capitalized string
	 */
	function capitalizeFirstLetter(str) {
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
})();
