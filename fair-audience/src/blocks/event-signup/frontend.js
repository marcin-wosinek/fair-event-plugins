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
 * Frontend JavaScript for Fair Audience Event Signup
 *
 * @package FairAudience
 */

const CSS_PREFIX = 'fair-audience-signup';

(function () {
	'use strict';

	onDomReady(initializeEventSignup);

	/**
	 * Initialize all event signup blocks on the page
	 */
	function initializeEventSignup() {
		const blocks = document.querySelectorAll('.fair-audience-event-signup');

		blocks.forEach(function (block) {
			initializeBlock(block);
		});
	}

	/**
	 * Initialize a single event signup block
	 * @param {HTMLElement} block The block element
	 */
	function initializeBlock(block) {
		const state = block.dataset.state;
		const isSignedUp = block.dataset.isSignedUp === 'true';

		// Initialize unsignup button if present
		const unsignupButton = block.querySelector(
			'.fair-audience-unsignup-button'
		);
		if (unsignupButton) {
			unsignupButton.addEventListener('click', function () {
				submitUnsignup(block, this);
			});
		}

		// Skip signup initialization if already signed up
		if (isSignedUp) {
			return;
		}

		// Initialize based on state
		if (state === 'anonymous') {
			initializeAnonymousBlock(block);
		} else if (state === 'with_token' || state === 'linked') {
			initializeAuthenticatedBlock(block);
		}
	}

	/**
	 * Update signup button text to reflect current base price + selected option prices.
	 * No-op when no base price is configured on the block.
	 * @param {HTMLElement} block The block element
	 */
	function updateButtonTotal(block) {
		const basePriceStr = block.dataset.basePrice;
		if (basePriceStr === '' || basePriceStr === undefined) {
			return;
		}

		const basePrice = parseFloat(basePriceStr);

		const checkedOptions = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		let optionsTotal = 0;
		checkedOptions.forEach(function (input) {
			optionsTotal += parseFloat(input.dataset.optionPrice || 0);
		});

		const total = basePrice + optionsTotal;
		const signupBaseText =
			block.dataset.signupBaseText || __('Sign Up', 'fair-audience');
		const registerBaseText =
			block.dataset.registerBaseText ||
			__('Register & Sign Up', 'fair-audience');

		let signupText, registerText;
		if (total > 0) {
			const formatted = total.toFixed(2);
			signupText = signupBaseText + ' \u2014 \u20ac' + formatted;
			registerText = registerBaseText + ' \u2014 \u20ac' + formatted;
		} else {
			signupText = __('Sign up for free', 'fair-audience');
			registerText = __('Register for free', 'fair-audience');
		}

		const signupBtn = block.querySelector('.fair-audience-signup-button');
		if (signupBtn) {
			signupBtn.textContent = signupText;
		}

		const submitBtn = block.querySelector(
			'.fair-audience-signup-submit-button'
		);
		if (submitBtn) {
			submitBtn.textContent = registerText;
		}
	}

	/**
	 * Attach change listeners to ticket option checkboxes so the button total
	 * stays in sync as the user checks/unchecks options.
	 * @param {HTMLElement} block The block element
	 */
	function initializeOptionTotals(block) {
		const optionCheckboxes = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		optionCheckboxes.forEach(function (checkbox) {
			checkbox.addEventListener('change', function () {
				updateButtonTotal(block);
			});
		});
	}

	/**
	 * Initialize anonymous block with tabs and forms
	 * @param {HTMLElement} block The block element
	 */
	function initializeAnonymousBlock(block) {
		// Setup tab switching
		const tabs = block.querySelectorAll('.fair-audience-signup-tab');
		const tabContents = block.querySelectorAll('[data-tab-content]');

		tabs.forEach(function (tab) {
			tab.addEventListener('click', function () {
				const targetTab = this.dataset.tab;

				// Update active tab
				tabs.forEach((t) => t.classList.remove('active'));
				this.classList.add('active');

				// Show/hide content
				tabContents.forEach(function (content) {
					if (content.dataset.tabContent === targetTab) {
						content.style.display = 'block';
					} else {
						content.style.display = 'none';
					}
				});
			});
		});

		initializeOptionTotals(block);

		// Setup registration form
		const registerForm = block.querySelector(
			'.fair-audience-signup-register'
		);
		if (registerForm) {
			registerForm.addEventListener('submit', function (e) {
				e.preventDefault();
				submitRegistration(block, registerForm);
			});
		}

		// Setup request link form
		const requestLinkForm = block.querySelector(
			'.fair-audience-signup-request-link'
		);
		if (requestLinkForm) {
			requestLinkForm.addEventListener('submit', function (e) {
				e.preventDefault();
				submitRequestLink(block, requestLinkForm);
			});
		}
	}

	/**
	 * Initialize authenticated block (token or linked user)
	 * @param {HTMLElement} block The block element
	 */
	function initializeAuthenticatedBlock(block) {
		initializeOptionTotals(block);

		const signupButton = block.querySelector(
			'.fair-audience-signup-button'
		);

		if (signupButton) {
			signupButton.addEventListener('click', function () {
				submitSignup(block, this);
			});
		}
	}

	/**
	 * Submit registration form (new participant)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} form The form element
	 */
	function submitRegistration(block, form) {
		const eventId = parseInt(block.dataset.eventId, 10);
		const eventDateId = block.dataset.eventDateId
			? parseInt(block.dataset.eventDateId, 10)
			: null;
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
		const nameInput = form.querySelector('input[name="signup_name"]');
		const surnameInput = form.querySelector('input[name="signup_surname"]');
		const emailInput = form.querySelector('input[name="signup_email"]');
		const keepInformedInput = form.querySelector(
			'input[name="signup_keep_informed"]'
		);

		// Validate
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
			event_id: eventId,
			name: nameInput.value.trim(),
			surname: surnameInput ? surnameInput.value.trim() : '',
			email: emailInput.value.trim(),
			keep_informed: keepInformedInput
				? keepInformedInput.checked
				: false,
		};

		if (eventDateId) {
			requestData.event_date_id = eventDateId;
		}

		const ticketTypeInput = form.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		if (ticketTypeInput) {
			requestData.ticket_type_id = parseInt(ticketTypeInput.value, 10);
		}

		const optionInputs = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		if (optionInputs.length > 0) {
			requestData.ticket_option_ids = Array.from(optionInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		// Submit to API
		apiFetch({
			path: '/fair-audience/v1/event-signup/register',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				if (response.success) {
					// Paid signup: redirect to Mollie checkout.
					if (
						response.status === 'payment_required' &&
						response.checkout_url
					) {
						showMessage(
							messageContainer,
							response.message ||
								__('Redirecting to payment…', 'fair-audience'),
							'success',
							CSS_PREFIX
						);
						window.location = response.checkout_url;
						return;
					}

					showMessage(
						messageContainer,
						response.message || successMessage,
						'success',
						CSS_PREFIX
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
					if (tabs) {
						tabs.style.display = 'none';
					}

					// Create success element
					const successEl = document.createElement('div');
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
						.querySelector('.fair-audience-signup-anonymous')
						.appendChild(successEl);
				}
			})
			.catch(function (error) {
				console.error('Event signup error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__('Failed to sign up. Please try again.', 'fair-audience')
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

	/**
	 * Submit request link form (existing participant)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} form The form element
	 */
	function submitRequestLink(block, form) {
		const eventId = parseInt(block.dataset.eventId, 10);
		const eventDateId = block.dataset.eventDateId
			? parseInt(block.dataset.eventDateId, 10)
			: null;
		const messageContainer = form.querySelector(
			'.fair-audience-signup-message'
		);
		const submitButton = form.querySelector(
			'.fair-audience-signup-submit-button'
		);

		// Get email
		const emailInput = form.querySelector('input[name="link_email"]');

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
			event_id: eventId,
			email: emailInput.value.trim(),
		};

		if (eventDateId) {
			requestData.event_date_id = eventDateId;
		}

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Sending...', 'fair-audience')
		);

		// Submit to API
		apiFetch({
			path: '/fair-audience/v1/event-signup/request-link',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				if (response.success) {
					showMessage(
						messageContainer,
						response.message,
						'success',
						CSS_PREFIX
					);
					showNotification(response.message, 'success');
					form.reset();
				}
			})
			.catch(function (error) {
				console.error('Request link error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to send link. Please try again.',
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

	/**
	 * Submit signup for authenticated user (token or linked)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} button The signup button
	 */
	function submitSignup(block, button) {
		const eventId = parseInt(block.dataset.eventId, 10);
		const eventDateId = block.dataset.eventDateId
			? parseInt(block.dataset.eventDateId, 10)
			: null;
		const token = block.dataset.participantToken || '';
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

		if (eventDateId) {
			requestData.event_date_id = eventDateId;
		}

		if (token) {
			requestData.participant_token = token;
		}

		const ticketTypeInput = block.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		if (ticketTypeInput) {
			requestData.ticket_type_id = parseInt(ticketTypeInput.value, 10);
		}

		const optionInputs = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		if (optionInputs.length > 0) {
			requestData.ticket_option_ids = Array.from(optionInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			button,
			__('Signing up...', 'fair-audience')
		);

		// Submit to API
		apiFetch({
			path: '/fair-audience/v1/event-signup',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				if (response.success) {
					// Paid signup: redirect to Mollie checkout.
					if (
						response.status === 'payment_required' &&
						response.checkout_url
					) {
						showMessage(
							messageContainer,
							response.message ||
								__('Redirecting to payment…', 'fair-audience'),
							'success',
							CSS_PREFIX
						);
						window.location = response.checkout_url;
						return;
					}

					showMessage(
						messageContainer,
						response.message || successMessage,
						'success',
						CSS_PREFIX
					);
					showNotification(
						response.message || successMessage,
						'success'
					);

					// Replace form with signed-up state including cancel button
					const formContainer =
						block.querySelector(
							'.fair-audience-signup-token-form'
						) ||
						block.querySelector(
							'.fair-audience-signup-linked-form'
						);

					if (formContainer) {
						formContainer.innerHTML =
							'<div class="fair-audience-signup-status fair-audience-signup-status-success">' +
							'<p>' +
							__(
								'You are signed up for this event!',
								'fair-audience'
							) +
							'</p>' +
							'</div>' +
							'<div class="wp-block-button fair-audience-unsignup-button-wrap">' +
							'<button type="button" class="wp-block-button__link wp-element-button fair-audience-unsignup-button is-style-outline">' +
							__('Cancel signup', 'fair-audience') +
							'</button>' +
							'</div>' +
							'<div class="fair-audience-signup-message" style="display: none;"></div>';

						// Attach handler to the new button
						const newUnsignupBtn = formContainer.querySelector(
							'.fair-audience-unsignup-button'
						);
						newUnsignupBtn.addEventListener('click', function () {
							submitUnsignup(block, this);
						});
					}
				}
			})
			.catch(function (error) {
				console.error('Signup error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__('Failed to sign up. Please try again.', 'fair-audience')
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

	/**
	 * Submit unsignup (cancel signup)
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} button The unsignup button
	 */
	function submitUnsignup(block, button) {
		const eventId = parseInt(block.dataset.eventId, 10);
		const eventDateId = block.dataset.eventDateId
			? parseInt(block.dataset.eventDateId, 10)
			: null;
		const token = block.dataset.participantToken || '';
		const state = block.dataset.state;

		const container =
			block.querySelector('.fair-audience-signup-signed-up') ||
			block.querySelector('.fair-audience-signup-token-form') ||
			block.querySelector('.fair-audience-signup-linked-form');

		const messageContainer = container
			? container.querySelector('.fair-audience-signup-message')
			: null;

		// Build request data
		const requestData = {
			event_id: eventId,
		};

		if (eventDateId) {
			requestData.event_date_id = eventDateId;
		}

		if (token) {
			requestData.participant_token = token;
		}

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			button,
			__('Cancelling...', 'fair-audience')
		);

		apiFetch({
			path: '/fair-audience/v1/event-signup',
			method: 'DELETE',
			data: requestData,
		})
			.then(function (response) {
				if (response.success) {
					showNotification(
						response.message ||
							__(
								'You have been removed from this event.',
								'fair-audience'
							),
						'success'
					);

					// Get participant name from greeting or fallback
					const greetingEl = block.querySelector(
						'.fair-audience-signup-greeting'
					);
					const participantName = greetingEl
						? greetingEl.textContent.match(
								/(?:Hi|Hola|Salut|Ciao)\s+(.+?)!/
						  )?.[1] || ''
						: '';

					// Replace with signup form
					if (container) {
						const greetingText = participantName
							? __(
									'Hi %s! You can sign up for this event.',
									'fair-audience'
							  ).replace('%s', participantName)
							: __(
									'You can sign up for this event.',
									'fair-audience'
							  );

						const wrapClass =
							state === 'with_token'
								? 'fair-audience-signup-token-form'
								: 'fair-audience-signup-linked-form';

						container.className = wrapClass;
						container.innerHTML =
							'<p class="fair-audience-signup-greeting">' +
							greetingText +
							'</p>' +
							'<div class="wp-block-button">' +
							'<button type="button" class="wp-block-button__link wp-element-button fair-audience-signup-button" data-action="signup">' +
							__('Sign Up', 'fair-audience') +
							'</button>' +
							'</div>' +
							'<div class="fair-audience-signup-message" style="display: none;"></div>';

						// Attach signup handler to new button
						const newSignupBtn = container.querySelector(
							'.fair-audience-signup-button'
						);
						newSignupBtn.addEventListener('click', function () {
							submitSignup(block, this);
						});
					}
				}
			})
			.catch(function (error) {
				console.error('Unsignup error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to cancel signup. Please try again.',
						'fair-audience'
					)
				);
				if (messageContainer) {
					showMessage(
						messageContainer,
						errorMessage,
						'error',
						CSS_PREFIX
					);
				}
				showNotification(errorMessage, 'error');
			})
			.finally(function () {
				restoreButton();
			});
	}
})();
