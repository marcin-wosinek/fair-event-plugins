import './frontend.css';
import apiFetch from '@wordpress/api-fetch';

/**
 * Frontend JavaScript for Fair Registration forms
 *
 * @package FairRegistration
 */

(function () {
	'use strict';

	// Initialize when DOM is ready
	document.addEventListener('DOMContentLoaded', function () {
		initializeRegistrationForms();
	});

	/**
	 * Initialize all registration forms on the page
	 */
	function initializeRegistrationForms() {
		const forms = document.querySelectorAll(
			'.fair-registration-form-element'
		);

		forms.forEach(function (form) {
			setupFormButtons(form);
			setupFormSubmission(form);
		});
	}

	/**
	 * Setup button behaviors for a form
	 * @param {HTMLElement} form The form element
	 */
	function setupFormButtons(form) {
		const buttons = form.querySelectorAll(
			'[data-registration-button-type]'
		);

		buttons.forEach(function (button) {
			const buttonType = button.getAttribute(
				'data-registration-button-type'
			);

			switch (buttonType) {
				case 'submit':
					button.addEventListener('click', function (e) {
						e.preventDefault();
						submitForm(form, button);
					});
					break;

				case 'reset':
					button.addEventListener('click', function (e) {
						e.preventDefault();
						resetForm(form);
					});
					break;

				case 'cancel':
					button.addEventListener('click', function (e) {
						e.preventDefault();
						cancelForm(form);
					});
					break;

				default:
					// Custom buttons - no default behavior
					break;
			}
		});
	}

	/**
	 * Setup form submission handling
	 * @param {HTMLElement} form The form element
	 */
	function setupFormSubmission(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();
			submitForm(form);
		});
	}

	/**
	 * Submit a registration form
	 * @param {HTMLElement} form The form element
	 * @param {HTMLElement} button The button that triggered submission
	 */
	function submitForm(form, button = null) {
		if (button) {
			button.disabled = true;
			button.textContent = 'Submitting...';
		}

		// Basic form validation
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
			showError('Please fill in all required fields');
			if (button) {
				button.disabled = false;
				button.textContent = 'Submit';
			}
			return;
		}

		// Get form data
		const formData = new FormData(form);
		const registrationData = [];

		// Convert FormData to API format
		for (const [name, value] of formData.entries()) {
			if (name !== 'fair_registration_nonce') {
				registrationData.push({
					name: name,
					value: value,
				});
			}
		}

		// Get form ID from form's data attribute or from URL
		const formId = form.getAttribute('data-form-id') || getPostId();

		if (!formId) {
			showError('Unable to determine form ID');
			if (button) {
				button.disabled = false;
				button.textContent = 'Submit';
			}
			return;
		}

		// Submit to API using WordPress apiFetch
		apiFetch({
			path: '/fair-registration/v1/registrations',
			method: 'POST',
			data: {
				form_id: parseInt(formId),
				url: window.location.href,
				registration_data: registrationData,
			},
		})
			.then(function (data) {
				showSuccess('Registration submitted successfully!');
				form.reset();
			})
			.catch(function (error) {
				console.error('Registration error:', error);
				let errorMessage = 'Registration failed. Please try again.';

				// Try to get more specific error message
				if (error.message) {
					errorMessage = error.message;
				} else if (error.data && error.data.message) {
					errorMessage = error.data.message;
				}

				showError(errorMessage);
			})
			.finally(function () {
				if (button) {
					button.disabled = false;
					button.textContent = 'Submit';
				}
			});
	}

	/**
	 * Reset a form
	 * @param {HTMLElement} form The form element
	 */
	function resetForm(form) {
		form.reset();
		showInfo('Form has been reset');
	}

	/**
	 * Cancel form (could redirect or just reset)
	 * @param {HTMLElement} form The form element
	 */
	function cancelForm(form) {
		if (
			confirm(
				'Are you sure you want to cancel? All entered data will be lost.'
			)
		) {
			form.reset();
			// Could redirect to another page if needed
			// window.location.href = '/';
		}
	}

	/**
	 * Get the current post/page ID
	 * @returns {string|null} The post ID
	 */
	function getPostId() {
		// Try to get from body class
		const bodyClasses = document.body.className;
		const postIdMatch = bodyClasses.match(/postid-(\d+)/);
		if (postIdMatch) {
			return postIdMatch[1];
		}

		// Try to get from URL (for pages)
		const pageIdMatch = bodyClasses.match(/page-id-(\d+)/);
		if (pageIdMatch) {
			return pageIdMatch[1];
		}

		return null;
	}

	/**
	 * Show success message
	 * @param {string} message The message to show
	 */
	function showSuccess(message) {
		showNotification(message, 'success');
	}

	/**
	 * Show error message
	 * @param {string} message The message to show
	 */
	function showError(message) {
		showNotification(message, 'error');
	}

	/**
	 * Show info message
	 * @param {string} message The message to show
	 */
	function showInfo(message) {
		showNotification(message, 'info');
	}

	/**
	 * Show a notification message
	 * @param {string} message The message to show
	 * @param {string} type The type of notification (success, error, info)
	 */
	function showNotification(message, type) {
		// Create notification element
		const notification = document.createElement('div');
		notification.className = `fair-registration-notification fair-registration-${type}`;
		notification.textContent = message;

		// Style the notification
		notification.style.cssText = `
			position: fixed;
			top: 20px;
			right: 20px;
			padding: 15px 20px;
			border-radius: 4px;
			color: white;
			font-weight: 500;
			z-index: 9999;
			max-width: 400px;
			box-shadow: 0 4px 12px rgba(0,0,0,0.15);
		`;

		// Set background color based on type
		switch (type) {
			case 'success':
				notification.style.backgroundColor = '#00a32a';
				break;
			case 'error':
				notification.style.backgroundColor = '#d63638';
				break;
			case 'info':
			default:
				notification.style.backgroundColor = '#0073aa';
				break;
		}

		// Add to page
		document.body.appendChild(notification);

		// Remove after 5 seconds
		setTimeout(function () {
			if (notification.parentNode) {
				notification.parentNode.removeChild(notification);
			}
		}, 5000);
	}
})();
