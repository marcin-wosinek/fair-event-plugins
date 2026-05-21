import './style.css';
import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	extractErrorMessage,
	showNotification,
	showMessage,
	setButtonLoading,
	onDomReady,
	wireNotYouButton,
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
		const hasPicker = block.dataset.hasOccurrencePicker === 'true';

		// Return-from-Mollie retry UI: the rest of the form is not rendered
		// when the callback container is present, so we wire it and stop.
		const retryContainer = block.querySelector(
			'.fair-audience-signup-retry'
		);
		if (retryContainer) {
			const retryButton = retryContainer.querySelector(
				'.fair-audience-signup-retry-button'
			);
			if (retryButton) {
				retryButton.addEventListener('click', function () {
					submitRetryPayment(retryContainer, this);
				});
			}
			return;
		}

		// Return-from-Mollie pending UI: poll for status until the webhook
		// resolves the transaction, then swap to success in place.
		const pendingContainer = block.querySelector(
			'.fair-audience-signup-pending'
		);
		if (pendingContainer) {
			startPendingPoll(pendingContainer);
			return;
		}

		// Return-from-Mollie paid UI: surface a thank-you popup so the user
		// can't miss that the payment went through, then bail.
		const paidContainer = block.querySelector('.fair-audience-signup-paid');
		if (paidContainer) {
			showThankYouPopup(readPaidAmount(paidContainer));
			return;
		}

		// Initialize unsignup button(s) if present
		const unsignupButtons = block.querySelectorAll(
			'.fair-audience-unsignup-button'
		);
		unsignupButtons.forEach(function (btn) {
			btn.addEventListener('click', function () {
				submitUnsignup(block, this);
			});
		});

		// When a recurrence picker is present, the user can switch between
		// signed-up and not-signed-up occurrences inline — initialise the
		// authenticated form even if the default selection is signed up.
		if (isSignedUp && !hasPicker) {
			return;
		}

		// Always wire the picker so it stays interactive (also for anonymous).
		if (hasPicker) {
			initializeOccurrencePicker(block);
		}

		// Initialize based on state
		if (state === 'anonymous') {
			initializeAnonymousBlock(block);
		} else if (state === 'with_token' || state === 'linked') {
			initializeAuthenticatedBlock(block);
		}
	}

	/**
	 * Wire the recurrence occurrence picker. Changing the select navigates
	 * the page to the same URL with ?event_date=<id>, so sibling event
	 * blocks (event-info, event-dates, calendar-button) re-render for the
	 * picked occurrence and the dropdown's own state is preserved via the
	 * server-rendered default selection.
	 * @param {HTMLElement} block The block element
	 */
	function initializeOccurrencePicker(block) {
		const select = block.querySelector(
			'.fair-audience-occurrence-picker select[name="event_date_id"]'
		);
		if (!select) return;
		select.addEventListener('change', function () {
			navigateToOccurrence(this.value);
		});
	}

	/**
	 * Navigate the current page to the same URL with ?event_date=<id> set,
	 * preserving any other query params (e.g. fair_payment_callback).
	 * @param {string} eventDateId Selected occurrence id
	 */
	function navigateToOccurrence(eventDateId) {
		const id = parseInt(eventDateId, 10);
		if (!id) return;
		const url = new URL(window.location.href);
		url.searchParams.set('event_date', String(id));
		window.location.assign(url.toString());
	}

	/**
	 * Enforce the minimum-activities requirement by disabling the signup
	 * and registration buttons until enough options are checked.  No-op
	 * when the block has no minimum configured.
	 * @param {HTMLElement} block The block element
	 */
	function updateMinActivitiesGate(block) {
		// Event-date global baseline.
		const globalMin = parseInt(block.dataset.minActivities || '0', 10);

		// A selected ticket type can raise the requirement (issue #625); a value
		// below the global is ignored because we take the max.
		const selectedTicketType = block.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		const typeMin = selectedTicketType
			? parseInt(selectedTicketType.dataset.minActivities || '0', 10)
			: 0;

		const optionInputs = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		// Cap at the number of options available so the requirement is never
		// impossible to satisfy.
		const effectiveMin = Math.min(
			Math.max(globalMin, typeMin),
			optionInputs.length
		);

		// Keep the hint paragraph in sync with the effective minimum.
		const hint = block.querySelector(
			'.fair-audience-ticket-options-min-hint'
		);
		if (hint) {
			if (effectiveMin > 0) {
				hint.textContent = sprintf(
					/* translators: %d: minimum number of activities required */
					_n(
						'Please select at least %d activity to sign up.',
						'Please select at least %d activities to sign up.',
						effectiveMin,
						'fair-audience'
					),
					effectiveMin
				);
				hint.style.display = '';
			} else {
				hint.style.display = 'none';
			}
		}

		const buttons = block.querySelectorAll(
			'.fair-audience-signup-button, .fair-audience-signup-submit-button'
		);

		if (!effectiveMin) {
			// No minimum in effect: never leave a button disabled by this gate.
			buttons.forEach(function (btn) {
				btn.disabled = false;
				btn.classList.remove('is-disabled');
			});
			return;
		}

		const checkedCount = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		).length;
		const meetsMin = checkedCount >= effectiveMin;

		buttons.forEach(function (btn) {
			btn.disabled = !meetsMin;
			btn.classList.toggle('is-disabled', !meetsMin);
		});
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

		let basePrice = parseFloat(basePriceStr);

		const selectedTicketType = block.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		if (
			selectedTicketType &&
			selectedTicketType.dataset.ticketPrice !== ''
		) {
			basePrice = parseFloat(selectedTicketType.dataset.ticketPrice || 0);
		}

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
		const ticketTypeRadios = block.querySelectorAll(
			'input[name="ticket_type_id"]'
		);
		ticketTypeRadios.forEach(function (radio) {
			radio.addEventListener('change', function () {
				updateButtonTotal(block);
				updateMinActivitiesGate(block);
			});
		});

		const optionCheckboxes = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		optionCheckboxes.forEach(function (checkbox) {
			checkbox.addEventListener('change', function () {
				updateButtonTotal(block);
				updateMinActivitiesGate(block);
			});
		});

		updateMinActivitiesGate(block);
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

		wireNotYouButton(block.querySelector('.fair-audience-not-you'));

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

		const invitationToken = block.dataset.invitationToken || '';
		if (invitationToken) {
			requestData.invitation_token = invitationToken;
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

					// Known email + no matching session: server sent a resume
					// link instead of creating a signup. Surface the message,
					// leave the form so a typo'd email can be corrected, and
					// don't flip into the success UI.
					if (response.status === 'email_recognized') {
						showMessage(
							messageContainer,
							response.message ||
								__(
									'We recognise this email — check your inbox to continue.',
									'fair-audience'
								),
							'info',
							CSS_PREFIX
						);
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

					// Reload when the picker is in play so the next render
					// reflects the just-signed-up date and re-defaults the
					// picker.
					if (block.dataset.hasOccurrencePicker === 'true') {
						window.location.reload();
						return;
					}

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

		const invitationToken = block.dataset.invitationToken || '';
		if (invitationToken) {
			requestData.invitation_token = invitationToken;
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

					// With a recurrence picker the cleanest way to reflect the
					// just-signed-up date and re-default the picker is a full
					// reload — otherwise we'd have to keep the picker in sync
					// with arbitrary follow-up actions.
					if (block.dataset.hasOccurrencePicker === 'true') {
						window.location.reload();
						return;
					}

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

					// Picker present: rerender from server so the cancelled
					// date moves back to "available" and the default selection
					// updates.
					if (block.dataset.hasOccurrencePicker === 'true') {
						window.location.reload();
						return;
					}

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

	/**
	 * Poll the payment status endpoint while the transaction is still
	 * pending. Swaps the container to the paid markup once Mollie reports
	 * success, or to a retry-link message on terminal failure. Stops after
	 * ~30 seconds to avoid hammering the API; the user can refresh manually
	 * if the bank takes longer than that.
	 * @param {HTMLElement} container The pending container element
	 */
	function startPendingPoll(container) {
		const transactionId = parseInt(container.dataset.transactionId, 10);
		if (!transactionId) {
			return;
		}

		const POLL_INTERVAL_MS = 2000;
		const MAX_ATTEMPTS = 15;
		let attempts = 0;

		const tick = function () {
			attempts += 1;
			apiFetch({
				path: `/fair-payment/v1/payments/${transactionId}/status`,
				method: 'GET',
			})
				.then(function (response) {
					const status = response && response.status;
					if (status === 'paid' || status === 'completed') {
						swapPendingToPaid(container, response);
						return;
					}
					if (
						status === 'failed' ||
						status === 'canceled' ||
						status === 'expired'
					) {
						swapPendingToTerminal(container);
						return;
					}
					if (attempts < MAX_ATTEMPTS) {
						setTimeout(tick, POLL_INTERVAL_MS);
					}
				})
				.catch(function () {
					// Swallow polling errors silently; we'll try again on the
					// next tick, and the user can always refresh.
					if (attempts < MAX_ATTEMPTS) {
						setTimeout(tick, POLL_INTERVAL_MS);
					}
				});
		};

		setTimeout(tick, POLL_INTERVAL_MS);
	}

	/**
	 * Replace the pending container's contents with the paid confirmation.
	 * @param {HTMLElement} container The pending container element
	 * @param {Object} transaction Transaction status response
	 */
	function swapPendingToPaid(container, transaction) {
		const amount =
			transaction && transaction.amount
				? `${transaction.amount} ${transaction.currency || ''}`.trim()
				: '';

		container.classList.remove('fair-audience-signup-pending');
		container.classList.add('fair-audience-signup-paid');

		container.innerHTML = '';
		container.appendChild(
			createElement('div', 'fair-audience-signup-paid-icon', '✓', {
				'aria-hidden': 'true',
			})
		);
		container.appendChild(
			createElement(
				'h2',
				'fair-audience-signup-paid-heading',
				__('Payment confirmed', 'fair-audience')
			)
		);
		container.appendChild(
			createElement(
				'p',
				'fair-audience-signup-paid-amount',
				amount ? __('Amount paid:', 'fair-audience') + ' ' + amount : ''
			)
		);
		container.appendChild(
			createElement(
				'p',
				'fair-audience-signup-paid-email',
				__(
					'A confirmation email is on its way. You can close this page.',
					'fair-audience'
				)
			)
		);

		showThankYouPopup(amount);
	}

	/**
	 * Replace the pending container's contents with a terminal-failure note
	 * pointing the user back to the event page so they can retry.
	 * @param {HTMLElement} container The pending container element
	 */
	function swapPendingToTerminal(container) {
		container.classList.remove('fair-audience-signup-pending');
		container.innerHTML = '';
		const message = createElement(
			'p',
			'fair-audience-signup-pending-status',
			__(
				"Your payment didn't go through. Refresh this page to retry.",
				'fair-audience'
			)
		);
		container.appendChild(message);
	}

	/**
	 * Tiny helper to build a DOM element with class + text.
	 * @param {string} tag Element tag name
	 * @param {string} className Class to apply
	 * @param {string} text Text content
	 * @param {Object} attrs Optional attributes
	 * @return {HTMLElement} The created element
	 */
	function createElement(tag, className, text, attrs) {
		const el = document.createElement(tag);
		el.className = className;
		if (text) {
			el.textContent = text;
		}
		if (attrs) {
			Object.keys(attrs).forEach(function (key) {
				el.setAttribute(key, attrs[key]);
			});
		}
		return el;
	}

	/**
	 * Read the formatted amount from a server-rendered paid container so the
	 * popup can echo it back to the user.
	 * @param {HTMLElement} container Paid container element
	 * @return {string} Amount text including currency, or empty when absent
	 */
	function readPaidAmount(container) {
		const amountEl = container.querySelector(
			'.fair-audience-signup-paid-amount'
		);
		if (!amountEl) {
			return '';
		}
		// "Amount paid: 10,00 EUR" → "10,00 EUR". Robust to translation: take
		// everything after the last colon.
		const text = (amountEl.textContent || '').trim();
		const idx = text.lastIndexOf(':');
		return idx >= 0 ? text.slice(idx + 1).trim() : text;
	}

	/**
	 * Show a one-time modal overlay confirming a successful payment. Users
	 * sometimes miss the inline confirmation card; an unmissable popup
	 * removes any doubt that the purchase went through.
	 * @param {string} amount Optional formatted amount with currency.
	 */
	function showThankYouPopup(amount) {
		if (window.__fairAudienceThankYouShown) {
			return;
		}
		window.__fairAudienceThankYouShown = true;

		const overlay = createElement(
			'div',
			'fair-audience-thank-you-overlay',
			'',
			{ role: 'dialog', 'aria-modal': 'true' }
		);

		const card = createElement('div', 'fair-audience-thank-you-card');
		card.appendChild(
			createElement('div', 'fair-audience-thank-you-icon', '✓', {
				'aria-hidden': 'true',
			})
		);
		card.appendChild(
			createElement(
				'h2',
				'fair-audience-thank-you-heading',
				__('Thank you!', 'fair-audience')
			)
		);
		card.appendChild(
			createElement(
				'p',
				'fair-audience-thank-you-message',
				__('Your payment was confirmed.', 'fair-audience')
			)
		);
		if (amount) {
			card.appendChild(
				createElement(
					'p',
					'fair-audience-thank-you-amount',
					__('Amount paid:', 'fair-audience') + ' ' + amount
				)
			);
		}
		card.appendChild(
			createElement(
				'p',
				'fair-audience-thank-you-email',
				__('A confirmation email is on its way.', 'fair-audience')
			)
		);

		const dismissButton = document.createElement('button');
		dismissButton.type = 'button';
		dismissButton.className =
			'wp-block-button__link wp-element-button fair-audience-thank-you-dismiss';
		dismissButton.textContent = __('Got it', 'fair-audience');
		card.appendChild(dismissButton);

		overlay.appendChild(card);
		document.body.appendChild(overlay);

		const close = function () {
			overlay.remove();
			document.removeEventListener('keydown', onKeydown);
		};
		const onKeydown = function (e) {
			if (e.key === 'Escape') {
				close();
			}
		};
		dismissButton.addEventListener('click', close);
		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) {
				close();
			}
		});
		document.addEventListener('keydown', onKeydown);

		dismissButton.focus();
	}

	/**
	 * Submit retry-payment for a previously failed transaction.
	 * @param {HTMLElement} container The retry container element
	 * @param {HTMLElement} button The retry button
	 */
	function submitRetryPayment(container, button) {
		const transactionId = parseInt(container.dataset.transactionId, 10);
		if (!transactionId) {
			return;
		}
		const signature = container.dataset.signature || '';
		const messageContainer = container.querySelector(
			'.fair-audience-signup-message'
		);

		const restoreButton = setButtonLoading(
			button,
			__('Redirecting…', 'fair-audience')
		);

		const requestData = { transaction_id: transactionId };
		if (signature) {
			requestData.signature = signature;
		}

		apiFetch({
			path: '/fair-audience/v1/event-signup/retry-payment',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				if (
					response &&
					response.status === 'payment_required' &&
					response.checkout_url
				) {
					window.location = response.checkout_url;
					return;
				}
				if (response && response.status === 'already_signed_up') {
					showMessage(
						messageContainer,
						response.message,
						'success',
						CSS_PREFIX
					);
					window.location = window.location.pathname;
					return;
				}
				const fallback = __(
					'Could not start the retry. Please try again.',
					'fair-audience'
				);
				showMessage(
					messageContainer,
					(response && response.message) || fallback,
					'error',
					CSS_PREFIX
				);
				restoreButton();
			})
			.catch(function (error) {
				console.error('Retry payment error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Could not start the retry. Please try again.',
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
				restoreButton();
			});
	}
})();
