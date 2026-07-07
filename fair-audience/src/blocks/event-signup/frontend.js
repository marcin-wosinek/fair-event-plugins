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
	computeTicketTotal,
	formatPrice,
} from 'fair-events-shared';
import {
	collectQuestionAnswers,
	validateQuestions,
	hasFileUploads,
	appendQuestionFiles,
	setupQuestionnaire,
} from 'fair-events-shared';

/**
 * Frontend JavaScript for Fair Audience Event Signup
 *
 * @package FairAudience
 */

const CSS_PREFIX = 'fair-audience-signup';
const SCROLL_RESTORE_KEY = 'fairAudienceOccurrenceScrollY';

(function () {
	'use strict';

	onDomReady(function () {
		restoreScrollPosition();
		initializeEventSignup();
	});

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
			wireCancelPendingPayment(block, retryContainer);
			return;
		}

		// Return-from-Mollie resume UI: a payment is still open. Let "Cancel
		// and start over" actually clear the pending_payment hold instead of
		// just hiding it behind stripped query params (issue #554).
		const resumeContainer = block.querySelector(
			'.fair-audience-signup-resume'
		);
		if (resumeContainer) {
			wireCancelPendingPayment(block, resumeContainer);
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

		// Wire the "add activities" section (issue #611) for signed-up viewers.
		// No-op when the section isn't rendered (nothing left to add).
		wireAddActivities(block);

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
	 * preserving any other query params (e.g. fair_payment_callback). The
	 * scroll position is stashed first and restored on the reloaded page
	 * (see restoreScrollPosition()) so picking a date doesn't jump the
	 * viewer back to the top of the page.
	 * @param {string} eventDateId Selected occurrence id
	 */
	function navigateToOccurrence(eventDateId) {
		const id = parseInt(eventDateId, 10);
		if (!id) return;
		const url = new URL(window.location.href);
		url.searchParams.set('event_date', String(id));
		sessionStorage.setItem(SCROLL_RESTORE_KEY, String(window.scrollY));
		window.location.assign(url.toString());
	}

	/**
	 * Restore the scroll position stashed by navigateToOccurrence(), if any.
	 */
	function restoreScrollPosition() {
		const saved = sessionStorage.getItem(SCROLL_RESTORE_KEY);
		if (saved === null) return;
		sessionStorage.removeItem(SCROLL_RESTORE_KEY);
		window.scrollTo(0, parseInt(saved, 10) || 0);
	}

	/**
	 * The currently selected ticket type radio, if any.
	 * @param {HTMLElement} block The block element
	 * @return {HTMLInputElement|null} The checked ticket_type_id radio.
	 */
	function getSelectedTicketType(block) {
		return block.querySelector('input[name="ticket_type_id"]:checked');
	}

	/**
	 * Whether the selected ticket type is a 'multiple_instances' scope pass.
	 * @param {HTMLElement} block The block element
	 * @return {boolean} True when the multi-occurrence checkbox picker applies.
	 */
	function isMultipleInstancesSelected(block) {
		const selected = getSelectedTicketType(block);
		return (
			!!selected &&
			selected.dataset.recurrenceScope === 'multiple_instances'
		);
	}

	/**
	 * Number of checked occurrence checkboxes in the multi-instance picker.
	 * @param {HTMLElement} block The block element
	 * @return {number} Count of checked event_date_ids[] checkboxes.
	 */
	function getCheckedInstanceCount(block) {
		return block.querySelectorAll('input[name="event_date_ids[]"]:checked')
			.length;
	}

	/**
	 * Minimum occurrence count required by the selected ticket type.
	 * @param {HTMLElement} block The block element
	 * @return {number} The configured minimum_instances (0 = none).
	 */
	function getInstanceMinimum(block) {
		const selected = getSelectedTicketType(block);
		return selected
			? parseInt(selected.dataset.minInstances || '0', 10)
			: 0;
	}

	/**
	 * Show the multi-occurrence checkbox picker (hiding the single-occurrence
	 * dropdown) when a 'multiple_instances' ticket type is selected, and vice
	 * versa. Clears stale checkbox state when switching away so a leftover
	 * selection can't leak into a later submission for a different scope.
	 * @param {HTMLElement} block The block element
	 */
	function updateInstancePickerVisibility(block) {
		const instancePicker = block.querySelector(
			'.fair-audience-instance-picker'
		);
		if (!instancePicker) {
			return;
		}
		const occurrencePicker = block.querySelector(
			'.fair-audience-occurrence-picker'
		);
		const active = isMultipleInstancesSelected(block);
		instancePicker.style.display = active ? '' : 'none';
		if (occurrencePicker) {
			occurrencePicker.style.display = active ? 'none' : '';
		}
		if (!active) {
			instancePicker
				.querySelectorAll('input[type="checkbox"]')
				.forEach(function (cb) {
					cb.checked = false;
				});
		}
	}

	/**
	 * Keep the instance picker's minimum hint and live total in sync as the
	 * buyer checks/unchecks occurrences or switches ticket type.
	 * @param {HTMLElement} block The block element
	 */
	function updateInstancePickerHint(block) {
		const instancePicker = block.querySelector(
			'.fair-audience-instance-picker'
		);
		if (!instancePicker || !isMultipleInstancesSelected(block)) {
			return;
		}

		const min = getInstanceMinimum(block);
		const checked = getCheckedInstanceCount(block);

		const hint = instancePicker.querySelector(
			'.fair-audience-instance-picker-hint'
		);
		if (hint) {
			hint.textContent =
				min > 0
					? sprintf(
							/* translators: %d: minimum number of occurrences required */
							_n(
								'Please select at least %d occurrence.',
								'Please select at least %d occurrences.',
								min,
								'fair-audience'
							),
							min
					  )
					: '';
		}

		const selected = getSelectedTicketType(block);
		const price = selected
			? parseFloat(selected.dataset.ticketPrice || 0)
			: 0;
		const totalEl = instancePicker.querySelector(
			'.fair-audience-instance-picker-total'
		);
		if (totalEl) {
			totalEl.textContent =
				checked > 0
					? sprintf(
							/* translators: %s: formatted total price */
							__('Total: €%s', 'fair-audience'),
							formatPrice(
								computeTicketTotal({
									unitPrice: price,
									count: checked,
								})
							)
					  )
					: '';
		}
	}

	/**
	 * Compute the effective minimum number of activities for the block: the
	 * event-date global baseline, possibly raised by the selected ticket type
	 * (issue #625), capped at the number of options available so the requirement
	 * is never impossible to satisfy.
	 * @param {HTMLElement} block The block element
	 * @return {number} The effective minimum (0 when no minimum applies)
	 */
	function getEffectiveMinimum(block) {
		const globalMin = parseInt(block.dataset.minActivities || '0', 10);

		// A selected ticket type can raise the requirement; a value below the
		// global is ignored because we take the max.
		const selectedTicketType = block.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		const typeMin = selectedTicketType
			? parseInt(selectedTicketType.dataset.minActivities || '0', 10)
			: 0;

		const optionCount = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		).length;

		return Math.min(Math.max(globalMin, typeMin), optionCount);
	}

	/**
	 * Enforce the minimum-activities requirement by disabling the signup
	 * and registration buttons until enough options are checked.  No-op
	 * when the block has no minimum configured.
	 * @param {HTMLElement} block The block element
	 */
	function updateMinActivitiesGate(block) {
		const effectiveMin = getEffectiveMinimum(block);

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

		// A 'multiple_instances' ticket type gates on its own occurrence
		// minimum (at least 1 chosen occurrence, or more if configured),
		// independent of the activities-minimum gate above.
		const multiInstanceActive = isMultipleInstancesSelected(block);
		const instanceMin = multiInstanceActive
			? Math.max(1, getInstanceMinimum(block))
			: 0;
		const meetsInstanceMin =
			!multiInstanceActive ||
			getCheckedInstanceCount(block) >= instanceMin;

		if (!effectiveMin) {
			buttons.forEach(function (btn) {
				btn.disabled = !meetsInstanceMin;
				btn.classList.toggle('is-disabled', !meetsInstanceMin);
			});
			return;
		}

		const checkedCount = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		).length;
		const meetsMin = checkedCount >= effectiveMin && meetsInstanceMin;

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

		let instanceCount = 1;
		if (isMultipleInstancesSelected(block)) {
			const instanceMin = Math.max(1, getInstanceMinimum(block));
			instanceCount = getCheckedInstanceCount(block);
			if (instanceCount < instanceMin) {
				// Not enough occurrences chosen yet — show the bare action label
				// until the selection is valid, same treatment as the
				// below-minimum-activities case below.
				const signupBaseText =
					block.dataset.signupBaseText ||
					__('Sign Up', 'fair-audience');
				const registerBaseText =
					block.dataset.registerBaseText ||
					__('Register & Sign Up', 'fair-audience');
				const signupBtnBare = block.querySelector(
					'.fair-audience-signup-button'
				);
				if (signupBtnBare) {
					signupBtnBare.textContent = signupBaseText;
				}
				const submitBtnBare = block.querySelector(
					'.fair-audience-signup-submit-button'
				);
				if (submitBtnBare) {
					submitBtnBare.textContent = registerBaseText;
				}
				return;
			}
		}

		const checkedOptions = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		const optionPrices = [];
		checkedOptions.forEach(function (input) {
			optionPrices.push(parseFloat(input.dataset.optionPrice || 0));
		});

		const total = computeTicketTotal({
			unitPrice: basePrice,
			count: instanceCount,
			optionPrices,
		});
		const signupBaseText =
			block.dataset.signupBaseText || __('Sign Up', 'fair-audience');
		const registerBaseText =
			block.dataset.registerBaseText ||
			__('Register & Sign Up', 'fair-audience');

		// Below the minimum-activities requirement the button is disabled and
		// the price is meaningless, so show only the bare action label until the
		// selection is valid (issue #644).
		const effectiveMin = getEffectiveMinimum(block);
		if (effectiveMin > 0 && checkedOptions.length < effectiveMin) {
			const signupBtnBare = block.querySelector(
				'.fair-audience-signup-button'
			);
			if (signupBtnBare) {
				signupBtnBare.textContent = signupBaseText;
			}
			const submitBtnBare = block.querySelector(
				'.fair-audience-signup-submit-button'
			);
			if (submitBtnBare) {
				submitBtnBare.textContent = registerBaseText;
			}
			return;
		}

		let signupText, registerText;
		if (total > 0) {
			const formatted = formatPrice(total);
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
	 * Show or hide the per-option "(+price)" add-on tags. Tags reveal what
	 * adding an option would cost and only appear once the minimum-activities
	 * requirement is met, on options that are not yet checked (issue #644).
	 * No-op when the block has no add-on tags (feature-inactive events).
	 * @param {HTMLElement} block The block element
	 */
	function updateOptionAddons(block) {
		// Scope to the signup options fieldset so the separate "add activities"
		// fieldset (for already-signed-up viewers) is never touched.
		const fieldset = block.querySelector('.fair-audience-ticket-options');
		if (!fieldset) {
			return;
		}

		const effectiveMin = getEffectiveMinimum(block);
		const checkedCount = fieldset.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		).length;
		const meetsMin = effectiveMin === 0 || checkedCount >= effectiveMin;

		const optionInputs = fieldset.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		optionInputs.forEach(function (input) {
			const label = input.closest('label');
			const addon = label
				? label.querySelector('.fair-audience-ticket-option-addon')
				: null;
			if (!addon) {
				return;
			}
			addon.style.display = meetsMin && !input.checked ? '' : 'none';
		});
	}

	/**
	 * Wire the pay-what-you-can slider (+ paired number input) when sliding
	 * scale is configured. The two inputs stay in sync; every change writes
	 * the chosen amount into block.dataset.basePrice, which
	 * updateButtonTotal() already reads, so the live total picks it up for
	 * free. No-op when the block has no sliding-scale picker.
	 * @param {HTMLElement} block The block element
	 */
	function initializeSlidingScalePicker(block) {
		const picker = block.querySelector(
			'.fair-audience-sliding-scale-picker'
		);
		if (!picker) {
			return;
		}

		const range = picker.querySelector(
			'.fair-audience-sliding-scale-range'
		);
		const number = picker.querySelector(
			'.fair-audience-sliding-scale-number'
		);
		if (!range || !number) {
			return;
		}

		const syncFrom = function (source, target) {
			target.value = source.value;
			block.dataset.basePrice = source.value;
			updateButtonTotal(block);
		};

		range.addEventListener('input', function () {
			syncFrom(range, number);
		});
		number.addEventListener('input', function () {
			syncFrom(number, range);
		});
		// Clamp only once the user finishes editing so intermediate keystrokes
		// (e.g. typing "5" on the way to "50") aren't fought by the browser.
		number.addEventListener('change', function () {
			const min = parseFloat(number.min);
			const max = parseFloat(number.max);
			let value = parseFloat(number.value);
			if (isNaN(value)) {
				value = parseFloat(number.defaultValue) || min || 0;
			}
			if (!isNaN(min) && value < min) {
				value = min;
			}
			if (!isNaN(max) && value > max) {
				value = max;
			}
			number.value = value;
			syncFrom(number, range);
		});

		block.dataset.basePrice = number.value;
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
				updateInstancePickerVisibility(block);
				updateInstancePickerHint(block);
				updateButtonTotal(block);
				updateMinActivitiesGate(block);
				updateOptionAddons(block);
			});
		});

		const optionCheckboxes = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		optionCheckboxes.forEach(function (checkbox) {
			checkbox.addEventListener('change', function () {
				updateButtonTotal(block);
				updateMinActivitiesGate(block);
				updateOptionAddons(block);
			});
		});

		const instanceCheckboxes = block.querySelectorAll(
			'input[name="event_date_ids[]"]'
		);
		instanceCheckboxes.forEach(function (checkbox) {
			checkbox.addEventListener('change', function () {
				updateInstancePickerHint(block);
				updateButtonTotal(block);
				updateMinActivitiesGate(block);
			});
		});

		initializeSlidingScalePicker(block);
		updateInstancePickerVisibility(block);
		updateInstancePickerHint(block);
		updateButtonTotal(block);
		updateMinActivitiesGate(block);
		updateOptionAddons(block);
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
			setupQuestionnaire(registerForm);
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

		const signupAction = block.querySelector(
			'.fair-audience-signup-action-signup'
		);
		if (signupAction) {
			setupQuestionnaire(signupAction);
		}

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
	 * Build apiFetch options for a signup request, attaching the custom
	 * question answers. When the scope has pending file uploads the request is
	 * sent as multipart FormData (matching the Fair Form convention), otherwise
	 * as JSON.
	 *
	 * @param {string}      path                The REST path.
	 * @param {Object}      requestData         Scalar/array signup fields.
	 * @param {Array}       questionnaireAnswers Collected question answers.
	 * @param {HTMLElement} scope               Element containing the question blocks.
	 * @return {Object} apiFetch options.
	 */
	function buildSignupFetch(path, requestData, questionnaireAnswers, scope) {
		if (!hasFileUploads(scope)) {
			return {
				path,
				method: 'POST',
				data: {
					...requestData,
					questionnaire_answers: questionnaireAnswers,
				},
			};
		}

		const formData = new FormData();
		Object.keys(requestData).forEach(function (key) {
			const value = requestData[key];
			if (Array.isArray(value)) {
				value.forEach((v) => formData.append(key + '[]', v));
			} else if (typeof value === 'boolean') {
				formData.append(key, value ? '1' : '0');
			} else if (value !== null && value !== undefined) {
				formData.append(key, value);
			}
		});
		formData.append(
			'questionnaire_answers',
			JSON.stringify(questionnaireAnswers)
		);
		appendQuestionFiles(scope, formData);

		return { path, method: 'POST', body: formData };
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

		// Validate custom question blocks (required/phone/file constraints).
		const questionError = validateQuestions(form);
		if (questionError) {
			showMessage(messageContainer, questionError, 'error', CSS_PREFIX);
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

		if (
			ticketTypeInput &&
			ticketTypeInput.dataset.recurrenceScope === 'multiple_instances'
		) {
			const instanceInputs = form.querySelectorAll(
				'input[name="event_date_ids[]"]:checked'
			);
			requestData.event_date_ids = Array.from(instanceInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		const optionInputs = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		if (optionInputs.length > 0) {
			requestData.ticket_option_ids = Array.from(optionInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		const chosenAmountInput = form.querySelector(
			'.fair-audience-sliding-scale-number'
		);
		if (chosenAmountInput) {
			requestData.chosen_amount = parseFloat(chosenAmountInput.value);
		}

		// Collect custom question answers.
		const questionnaireAnswers = collectQuestionAnswers(form);

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			submitButton,
			__('Submitting...', 'fair-audience')
		);

		// Submit to API
		apiFetch(
			buildSignupFetch(
				'/fair-audience/v1/event-signup/register',
				requestData,
				questionnaireAnswers,
				form
			)
		)
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

		if (
			ticketTypeInput &&
			ticketTypeInput.dataset.recurrenceScope === 'multiple_instances'
		) {
			const instanceInputs = block.querySelectorAll(
				'input[name="event_date_ids[]"]:checked'
			);
			requestData.event_date_ids = Array.from(instanceInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		const optionInputs = block.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);
		if (optionInputs.length > 0) {
			requestData.ticket_option_ids = Array.from(optionInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		const chosenAmountInput = block.querySelector(
			'.fair-audience-sliding-scale-number'
		);
		if (chosenAmountInput) {
			requestData.chosen_amount = parseFloat(chosenAmountInput.value);
		}

		// Custom questions live inside the signup action container.
		const questionScope =
			block.querySelector('.fair-audience-signup-action-signup') || block;

		// Validate custom question blocks (required/phone/file constraints).
		const questionError = validateQuestions(questionScope);
		if (questionError) {
			showMessage(messageContainer, questionError, 'error', CSS_PREFIX);
			return;
		}

		const questionnaireAnswers = collectQuestionAnswers(questionScope);

		// Disable button and show loading state
		const restoreButton = setButtonLoading(
			button,
			__('Signing up...', 'fair-audience')
		);

		// Submit to API
		apiFetch(
			buildSignupFetch(
				'/fair-audience/v1/event-signup',
				requestData,
				questionnaireAnswers,
				questionScope
			)
		)
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
	 * Wire the "add activities" section shown to a signed-up viewer: keep the
	 * Add button's total in sync with the checked options and submit on click.
	 * No-op when the section isn't present.
	 * @param {HTMLElement} block The block element
	 */
	function wireAddActivities(block) {
		const section = block.querySelector('.fair-audience-add-activities');
		if (!section) {
			return;
		}
		const button = section.querySelector(
			'.fair-audience-add-activities-button'
		);
		if (!button) {
			return;
		}
		const checkboxes = section.querySelectorAll(
			'input[name="add_option_ids[]"]'
		);

		const baseText = __('Add activities', 'fair-audience');
		const updateButton = function () {
			const optionPrices = [];
			let anyChecked = false;
			checkboxes.forEach(function (cb) {
				if (cb.checked) {
					anyChecked = true;
					optionPrices.push(parseFloat(cb.dataset.optionPrice || 0));
				}
			});
			const total = computeTicketTotal({ unitPrice: 0, optionPrices });
			button.disabled = !anyChecked;
			button.textContent =
				total > 0 ? baseText + ' — €' + formatPrice(total) : baseText;
		};

		checkboxes.forEach(function (cb) {
			cb.addEventListener('change', updateButton);
		});
		button.addEventListener('click', function () {
			submitAddActivities(block, this);
		});

		updateButton();
	}

	/**
	 * Submit the add-activities request. Redirects to checkout when the added
	 * activities are priced; otherwise reloads to reflect the updated list.
	 * @param {HTMLElement} block The block element
	 * @param {HTMLElement} button The add-activities button
	 */
	function submitAddActivities(block, button) {
		const eventId = parseInt(block.dataset.eventId, 10);
		const eventDateId = block.dataset.eventDateId
			? parseInt(block.dataset.eventDateId, 10)
			: null;
		const token = block.dataset.participantToken || '';
		const section = block.querySelector('.fair-audience-add-activities');
		const messageContainer = block.querySelector(
			'.fair-audience-signup-message'
		);

		const checked = section.querySelectorAll(
			'input[name="add_option_ids[]"]:checked'
		);
		if (checked.length === 0) {
			return;
		}

		const requestData = {
			event_id: eventId,
			ticket_option_ids: Array.from(checked).map((i) =>
				parseInt(i.value, 10)
			),
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

		const restoreButton = setButtonLoading(
			button,
			__('Adding…', 'fair-audience')
		);

		apiFetch({
			path: '/fair-audience/v1/event-signup/add-activities',
			method: 'POST',
			data: requestData,
		})
			.then(function (response) {
				// Paid add: redirect to Mollie checkout for the delta.
				if (
					response &&
					response.status === 'payment_required' &&
					response.checkout_url
				) {
					window.location = response.checkout_url;
					return;
				}
				if (response && response.success) {
					showNotification(
						response.message ||
							__(
								'Your activities have been added!',
								'fair-audience'
							),
						'success'
					);
					// Reload so the list reflects the just-added activities.
					window.location.reload();
					return;
				}
				restoreButton();
			})
			.catch(function (error) {
				console.error('Add activities error:', error);
				const errorMessage = extractErrorMessage(
					error,
					__(
						'Failed to add activities. Please try again.',
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

					// Get participant name from the highlighted name element
					const nameEl = block.querySelector(
						'.fair-audience-signup-greeting-name'
					);
					const participantName = nameEl
						? nameEl.textContent.trim()
						: '';

					// Replace with signup form
					if (container) {
						const nameHtml = participantName
							? '<strong class="fair-audience-signup-greeting-name">' +
							  participantName +
							  '</strong>'
							: '';
						const greetingHtml = nameHtml
							? __(
									'Hi %s! You can sign up for this event.',
									'fair-audience'
							  ).replace('%s', nameHtml)
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
							greetingHtml +
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
				path: `/fair-payments-connector/v1/payments/${transactionId}/status`,
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

	/**
	 * Wire the "Cancel and start over" link so it clears the pending_payment
	 * hold row server-side before navigating. Without this, render.php's
	 * DB-fallback resurrects the same checkout on the next load because the
	 * link previously only stripped URL query params, leaving the DB row
	 * behind (issue #554).
	 * @param {HTMLElement} block     The signup block element
	 * @param {HTMLElement} container The resume/retry callback container
	 */
	function wireCancelPendingPayment(block, container) {
		const cancelLink = container.querySelector(
			'.fair-audience-signup-resume-cancel a, .fair-audience-signup-retry-cancel a'
		);
		if (!cancelLink) {
			return;
		}

		cancelLink.addEventListener('click', function (event) {
			event.preventDefault();

			const eventId = parseInt(block.dataset.eventId, 10);
			const eventDateId = block.dataset.eventDateId
				? parseInt(block.dataset.eventDateId, 10)
				: null;
			const token = block.dataset.participantToken || '';
			const destination = cancelLink.href;

			const requestData = { event_id: eventId };
			if (eventDateId) {
				requestData.event_date_id = eventDateId;
			}
			if (token) {
				requestData.participant_token = token;
			}

			apiFetch({
				path: '/fair-audience/v1/event-signup',
				method: 'DELETE',
				data: requestData,
			})
				.catch(function (error) {
					console.error('Cancel pending payment error:', error);
				})
				.finally(function () {
					window.location = destination;
				});
		});
	}
})();
