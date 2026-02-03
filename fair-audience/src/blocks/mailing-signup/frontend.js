import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * Frontend JavaScript for Fair Audience Mailing Signup
 *
 * @package FairAudience
 */

( function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener(
			'DOMContentLoaded',
			initializeMailingSignupForms
		);
	} else {
		initializeMailingSignupForms();
	}

	/**
	 * Initialize all mailing signup forms on the page
	 */
	function initializeMailingSignupForms() {
		const forms = document.querySelectorAll(
			'.fair-audience-mailing-form'
		);

		forms.forEach( function ( form ) {
			setupFormSubmission( form );
		} );
	}

	/**
	 * Setup form submission handling
	 * @param {HTMLElement} form The form element
	 */
	function setupFormSubmission( form ) {
		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			submitSignup( form );
		} );
	}

	/**
	 * Submit signup
	 * @param {HTMLElement} form The form element
	 */
	function submitSignup( form ) {
		const container = form.closest( '.fair-audience-mailing-signup' );
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
		const nameInput = form.querySelector( 'input[name="mailing_name"]' );
		const surnameInput = form.querySelector(
			'input[name="mailing_surname"]'
		);
		const emailInput = form.querySelector( 'input[name="mailing_email"]' );

		// Validate inputs
		if ( ! nameInput || ! nameInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your first name.', 'fair-audience' ),
				'error'
			);
			return;
		}

		if ( ! surnameInput || ! surnameInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your last name.', 'fair-audience' ),
				'error'
			);
			return;
		}

		if ( ! emailInput || ! emailInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your email.', 'fair-audience' ),
				'error'
			);
			return;
		}

		// Build request data
		const requestData = {
			name: nameInput.value.trim(),
			surname: surnameInput.value.trim(),
			email: emailInput.value.trim(),
		};

		// Disable button and show loading state
		submitButton.disabled = true;
		const originalButtonText = submitButton.textContent;
		submitButton.textContent = __( 'Submitting...', 'fair-audience' );

		// Submit to API
		apiFetch( {
			path: '/fair-audience/v1/mailing-signup',
			method: 'POST',
			data: requestData,
		} )
			.then( function ( response ) {
				// Handle different response statuses
				let message = successMessage;

				if ( response.status === 'already_subscribed' ) {
					message = response.message;
					showMessage( messageContainer, message, 'info' );
				} else if ( response.status === 'resent' ) {
					message = response.message;
					showMessage( messageContainer, message, 'info' );
				} else {
					showMessage( messageContainer, message, 'success' );
					// Clear form on new signup
					form.reset();
				}

				// Show notification
				showNotification( message, 'success' );
			} )
			.catch( function ( error ) {
				console.error( 'Mailing signup error:', error );

				let errorMessage = __(
					'Failed to process signup. Please try again.',
					'fair-audience'
				);

				if ( error.message ) {
					errorMessage = error.message;
				} else if ( error.data && error.data.message ) {
					errorMessage = error.data.message;
				}

				showMessage( messageContainer, errorMessage, 'error' );
				showNotification( errorMessage, 'error' );
			} )
			.finally( function () {
				// Re-enable button
				submitButton.disabled = false;
				submitButton.textContent = originalButtonText;
			} );
	}

	/**
	 * Show message in the form
	 * @param {HTMLElement} container Message container
	 * @param {string} message The message
	 * @param {string} type Message type (success, error, info)
	 */
	function showMessage( container, message, type ) {
		container.textContent = message;
		container.className =
			'fair-audience-mailing-message fair-audience-mailing-message-' +
			type;
		container.style.display = 'block';

		// Hide after 8 seconds
		setTimeout( function () {
			container.style.display = 'none';
		}, 8000 );
	}

	/**
	 * Show a toast notification
	 * @param {string} message The message
	 * @param {string} type Notification type (success, error)
	 */
	function showNotification( message, type ) {
		const notification = document.createElement( 'div' );
		notification.className =
			'fair-audience-mailing-notification fair-audience-mailing-notification-' +
			type;
		notification.textContent = message;

		notification.style.cssText =
			'position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 4px; color: white; font-weight: 500; z-index: 9999; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';

		if ( type === 'success' || type === 'info' ) {
			notification.style.backgroundColor = '#00a32a';
		} else {
			notification.style.backgroundColor = '#d63638';
		}

		document.body.appendChild( notification );

		setTimeout( function () {
			if ( notification.parentNode ) {
				notification.parentNode.removeChild( notification );
			}
		}, 5000 );
	}
} )();
