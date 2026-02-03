import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

/**
 * Frontend JavaScript for Fair Audience Event Signup
 *
 * @package FairAudience
 */

( function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', initializeEventSignup );
	} else {
		initializeEventSignup();
	}

	/**
	 * Initialize all event signup blocks on the page
	 */
	function initializeEventSignup() {
		const blocks = document.querySelectorAll(
			'.fair-audience-event-signup'
		);

		blocks.forEach( function ( block ) {
			initializeBlock( block );
		} );
	}

	/**
	 * Initialize a single event signup block
	 * @param {HTMLElement} block The block element
	 */
	function initializeBlock( block ) {
		const state = block.dataset.state;
		const isSignedUp = block.dataset.isSignedUp === 'true';

		// Skip if already signed up
		if ( isSignedUp ) {
			return;
		}

		// Initialize based on state
		if ( state === 'anonymous' ) {
			initializeAnonymousBlock( block );
		} else if ( state === 'with_token' || state === 'linked' ) {
			initializeAuthenticatedBlock( block );
		}
	}

	/**
	 * Initialize anonymous block with tabs and forms
	 * @param {HTMLElement} block The block element
	 */
	function initializeAnonymousBlock( block ) {
		// Setup tab switching
		const tabs = block.querySelectorAll( '.fair-audience-signup-tab' );
		const tabContents = block.querySelectorAll( '[data-tab-content]' );

		tabs.forEach( function ( tab ) {
			tab.addEventListener( 'click', function () {
				const targetTab = this.dataset.tab;

				// Update active tab
				tabs.forEach( ( t ) => t.classList.remove( 'active' ) );
				this.classList.add( 'active' );

				// Show/hide content
				tabContents.forEach( function ( content ) {
					if ( content.dataset.tabContent === targetTab ) {
						content.style.display = 'block';
					} else {
						content.style.display = 'none';
					}
				} );
			} );
		} );

		// Setup registration form
		const registerForm = block.querySelector(
			'.fair-audience-signup-register'
		);
		if ( registerForm ) {
			registerForm.addEventListener( 'submit', function ( e ) {
				e.preventDefault();
				submitRegistration( block, registerForm );
			} );
		}

		// Setup request link form
		const requestLinkForm = block.querySelector(
			'.fair-audience-signup-request-link'
		);
		if ( requestLinkForm ) {
			requestLinkForm.addEventListener( 'submit', function ( e ) {
				e.preventDefault();
				submitRequestLink( block, requestLinkForm );
			} );
		}
	}

	/**
	 * Initialize authenticated block (token or linked user)
	 * @param {HTMLElement} block The block element
	 */
	function initializeAuthenticatedBlock( block ) {
		const signupButton = block.querySelector(
			'.fair-audience-signup-button'
		);

		if ( signupButton ) {
			signupButton.addEventListener( 'click', function () {
				submitSignup( block, this );
			} );
		}
	}

	/**
	 * Submit registration form (new participant)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} form The form element
	 */
	function submitRegistration( block, form ) {
		const eventId = parseInt( block.dataset.eventId, 10 );
		const messageContainer = form.querySelector(
			'.fair-audience-signup-message'
		);
		const submitButton = form.querySelector(
			'.fair-audience-signup-submit-button'
		);
		const successMessage =
			block.dataset.successMessage ||
			__(
				'You have successfully signed up for the event!',
				'fair-audience'
			);

		// Get form data
		const nameInput = form.querySelector( 'input[name="signup_name"]' );
		const surnameInput = form.querySelector(
			'input[name="signup_surname"]'
		);
		const emailInput = form.querySelector( 'input[name="signup_email"]' );
		const keepInformedInput = form.querySelector(
			'input[name="signup_keep_informed"]'
		);

		// Validate
		if ( ! nameInput || ! nameInput.value.trim() ) {
			showMessage(
				messageContainer,
				__( 'Please enter your first name.', 'fair-audience' ),
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
			event_id: eventId,
			name: nameInput.value.trim(),
			surname: surnameInput ? surnameInput.value.trim() : '',
			email: emailInput.value.trim(),
			keep_informed: keepInformedInput
				? keepInformedInput.checked
				: false,
		};

		// Disable button and show loading state
		submitButton.disabled = true;
		const originalButtonText = submitButton.textContent;
		submitButton.textContent = __( 'Submitting...', 'fair-audience' );

		// Submit to API
		apiFetch( {
			path: '/fair-audience/v1/event-signup/register',
			method: 'POST',
			data: requestData,
		} )
			.then( function ( response ) {
				if ( response.success ) {
					showMessage(
						messageContainer,
						response.message || successMessage,
						'success'
					);
					showNotification(
						response.message || successMessage,
						'success'
					);

					// Hide form and show success state
					form.style.display = 'none';
					const tabs = block.querySelector(
						'.fair-audience-signup-tabs'
					);
					if ( tabs ) {
						tabs.style.display = 'none';
					}

					// Create success element
					const successEl = document.createElement( 'div' );
					successEl.className =
						'fair-audience-signup-status fair-audience-signup-status-success';
					successEl.innerHTML =
						'<p>' +
						__(
							'You are signed up for this event!',
							'fair-audience'
						) +
						'</p>';
					block
						.querySelector( '.fair-audience-signup-anonymous' )
						.appendChild( successEl );
				}
			} )
			.catch( function ( error ) {
				console.error( 'Event signup error:', error );
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to sign up. Please try again.',
						'fair-audience'
					)
				);
				showMessage( messageContainer, errorMessage, 'error' );
				showNotification( errorMessage, 'error' );
			} )
			.finally( function () {
				submitButton.disabled = false;
				submitButton.textContent = originalButtonText;
			} );
	}

	/**
	 * Submit request link form (existing participant)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} form The form element
	 */
	function submitRequestLink( block, form ) {
		const eventId = parseInt( block.dataset.eventId, 10 );
		const messageContainer = form.querySelector(
			'.fair-audience-signup-message'
		);
		const submitButton = form.querySelector(
			'.fair-audience-signup-submit-button'
		);

		// Get email
		const emailInput = form.querySelector( 'input[name="link_email"]' );

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
			event_id: eventId,
			email: emailInput.value.trim(),
		};

		// Disable button and show loading state
		submitButton.disabled = true;
		const originalButtonText = submitButton.textContent;
		submitButton.textContent = __( 'Sending...', 'fair-audience' );

		// Submit to API
		apiFetch( {
			path: '/fair-audience/v1/event-signup/request-link',
			method: 'POST',
			data: requestData,
		} )
			.then( function ( response ) {
				if ( response.success ) {
					showMessage(
						messageContainer,
						response.message,
						'success'
					);
					showNotification( response.message, 'success' );
					form.reset();
				}
			} )
			.catch( function ( error ) {
				console.error( 'Request link error:', error );
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to send link. Please try again.',
						'fair-audience'
					)
				);
				showMessage( messageContainer, errorMessage, 'error' );
				showNotification( errorMessage, 'error' );
			} )
			.finally( function () {
				submitButton.disabled = false;
				submitButton.textContent = originalButtonText;
			} );
	}

	/**
	 * Submit signup for authenticated user (token or linked)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} button The signup button
	 */
	function submitSignup( block, button ) {
		const eventId = parseInt( block.dataset.eventId, 10 );
		const token = block.dataset.token || '';
		const messageContainer = block.querySelector(
			'.fair-audience-signup-message'
		);
		const successMessage =
			block.dataset.successMessage ||
			__(
				'You have successfully signed up for the event!',
				'fair-audience'
			);

		// Build request data
		const requestData = {
			event_id: eventId,
		};

		if ( token ) {
			requestData.token = token;
		}

		// Disable button and show loading state
		button.disabled = true;
		const originalButtonText = button.textContent;
		button.textContent = __( 'Signing up...', 'fair-audience' );

		// Submit to API
		apiFetch( {
			path: '/fair-audience/v1/event-signup',
			method: 'POST',
			data: requestData,
		} )
			.then( function ( response ) {
				if ( response.success ) {
					showMessage(
						messageContainer,
						response.message || successMessage,
						'success'
					);
					showNotification(
						response.message || successMessage,
						'success'
					);

					// Replace form with success state
					const formContainer =
						block.querySelector(
							'.fair-audience-signup-token-form'
						) ||
						block.querySelector(
							'.fair-audience-signup-linked-form'
						);

					if ( formContainer ) {
						formContainer.innerHTML =
							'<div class="fair-audience-signup-status fair-audience-signup-status-success">' +
							'<p>' +
							__(
								'You are signed up for this event!',
								'fair-audience'
							) +
							'</p>' +
							'</div>';
					}
				}
			} )
			.catch( function ( error ) {
				console.error( 'Signup error:', error );
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to sign up. Please try again.',
						'fair-audience'
					)
				);
				showMessage( messageContainer, errorMessage, 'error' );
				showNotification( errorMessage, 'error' );
			} )
			.finally( function () {
				button.disabled = false;
				button.textContent = originalButtonText;
			} );
	}

	/**
	 * Extract error message from error object
	 * @param {Object} error Error object
	 * @param {string} defaultMessage Default message
	 * @returns {string} Error message
	 */
	function extractErrorMessage( error, defaultMessage ) {
		if ( error.message ) {
			return error.message;
		}
		if ( error.data && error.data.message ) {
			return error.data.message;
		}
		return defaultMessage;
	}

	/**
	 * Show message in a container
	 * @param {HTMLElement} container Message container
	 * @param {string} message The message
	 * @param {string} type Message type (success, error, info)
	 */
	function showMessage( container, message, type ) {
		if ( ! container ) {
			return;
		}

		container.textContent = message;
		container.className =
			'fair-audience-signup-message fair-audience-signup-message-' + type;
		container.style.display = 'block';

		// Hide after 8 seconds (except for success which should stay visible)
		if ( type !== 'success' ) {
			setTimeout( function () {
				container.style.display = 'none';
			}, 8000 );
		}
	}

	/**
	 * Show a toast notification
	 * @param {string} message The message
	 * @param {string} type Notification type (success, error)
	 */
	function showNotification( message, type ) {
		const notification = document.createElement( 'div' );
		notification.className =
			'fair-audience-signup-notification fair-audience-signup-notification-' +
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
