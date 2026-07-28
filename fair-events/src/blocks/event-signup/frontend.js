/**
 * Get Tickets Block - Frontend JavaScript
 *
 * @package FairEvents
 */

import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	showMessage,
	onDomReady,
	initiatePayment,
	pollPaymentStatus,
	computeTicketTotal,
	formatMoney,
	collectQuestionAnswers,
	validateQuestions,
	extractErrorMessage,
	setButtonLoading,
} from 'fair-events-shared';
import './frontend.css';

const CSS_PREFIX = 'fair-events-get-tickets';
const PAYMENT_STATE_PATH = '/fair-events/v1/get-tickets/payment-state';

(function () {
	'use strict';

	onDomReady(initialize);

	function initialize() {
		document
			.querySelectorAll('.fair-events-get-tickets-callback-processing')
			.forEach(wireProcessingCard);
		document
			.querySelectorAll(
				'.fair-events-get-tickets-callback-resume, .fair-events-get-tickets-callback-retry'
			)
			.forEach(function (container) {
				wireRetryButton(container);
				wireCancelLink(container);
			});

		const forms = document.querySelectorAll(
			'.fair-events-get-tickets-form'
		);
		forms.forEach(setupForm);
	}

	/**
	 * Build the payment-state query string from a callback card's data
	 * attributes.
	 * @param {HTMLElement} container Card element carrying data-transaction-id/data-token.
	 * @return {string} Query string including the leading '?'.
	 */
	function paymentStateQuery(container) {
		const transactionId = container.dataset.transactionId || '';
		const token = container.dataset.token || '';
		const params = new URLSearchParams();
		if (transactionId) {
			params.set('transaction_id', transactionId);
		}
		if (token) {
			params.set('token', token);
		}
		const query = params.toString();
		return query ? `?${query}` : '';
	}

	/**
	 * Poll the payment-state endpoint while the "thank you, confirming with
	 * your bank" card is showing. Swaps to the confirmed card in place once
	 * paid; reloads the page on any other resolved outcome (failed/resume/
	 * retry) so the visitor sees the exact server-rendered card instead of a
	 * client-built approximation.
	 * @param {HTMLElement} container The processing card element.
	 */
	function wireProcessingCard(container) {
		if (!container.dataset.transactionId) {
			return;
		}

		pollPaymentStatus({
			path: `${PAYMENT_STATE_PATH}${paymentStateQuery(container)}`,
			onConfirmed: (response) => swapToConfirmedCard(container, response),
			onFailed: () => window.location.reload(),
			onProcessing: (response) => {
				if (response.state === 'resume' || response.state === 'retry') {
					window.location.reload();
				}
			},
		});
	}

	/**
	 * Replace the processing card's contents with the paid confirmation.
	 * @param {HTMLElement} container The processing card element.
	 * @param {Object}      response  payment-state response.
	 */
	function swapToConfirmedCard(container, response) {
		container.classList.remove(
			'fair-events-get-tickets-callback-processing'
		);
		container.classList.add('fair-events-get-tickets-callback-confirmed');
		container.innerHTML = '';

		const icon = document.createElement('div');
		icon.className = 'fair-events-get-tickets-callback-icon';
		icon.setAttribute('aria-hidden', 'true');
		icon.textContent = '✓';
		container.appendChild(icon);

		const heading = document.createElement('h2');
		heading.className = 'fair-events-get-tickets-callback-heading';
		heading.textContent = __('Payment confirmed', 'fair-events');
		container.appendChild(heading);

		if (response.amount) {
			const amountEl = document.createElement('p');
			amountEl.className = 'fair-events-get-tickets-callback-amount';
			amountEl.textContent = `${__(
				'Amount paid:',
				'fair-events'
			)} ${formatMoney(response.amount, response.currency)}`;
			container.appendChild(amountEl);
		}

		const emailEl = document.createElement('p');
		emailEl.className = 'fair-events-get-tickets-callback-email';
		emailEl.textContent = __(
			'A confirmation email is on its way. You can close this page.',
			'fair-events'
		);
		container.appendChild(emailEl);
	}

	/**
	 * Wire a resume/retry card's "Retry payment" button, if present (the
	 * resume card links straight to its existing checkout_url instead).
	 * @param {HTMLElement} container The resume/retry card element.
	 */
	function wireRetryButton(container) {
		const button = container.querySelector(
			'.fair-events-get-tickets-callback-retry-button'
		);
		if (!button) {
			return;
		}

		const messageContainer = container.querySelector(
			'.fair-events-get-tickets-callback-message'
		);

		button.addEventListener('click', function () {
			initiatePayment({
				apiPath: '/fair-events/v1/get-tickets/retry-payment',
				data: {
					transaction_id: parseInt(
						container.dataset.transactionId,
						10
					),
					token: container.dataset.token || '',
				},
				button,
				loadingText: __('Redirecting…', 'fair-events'),
				defaultErrorMessage: __(
					'Could not start the retry. Please try again.',
					'fair-events'
				),
				onError: (message) => {
					showMessage(messageContainer, message, 'error', CSS_PREFIX);
				},
			}).catch(function () {
				// Error already surfaced via onError.
			});
		});
	}

	/**
	 * Wire a resume/retry card's "Cancel and start over" link so it clears
	 * the pending_payment hold (and the session cookie) server-side before
	 * reloading with the callback params stripped — without this, the
	 * direct-navigation fallback would resurrect the same checkout on the
	 * next load.
	 * @param {HTMLElement} container The resume/retry card element.
	 */
	function wireCancelLink(container) {
		const link = container.querySelector(
			'.fair-events-get-tickets-callback-cancel-link'
		);
		if (!link) {
			return;
		}

		link.addEventListener('click', function (event) {
			event.preventDefault();

			apiFetch({
				path: '/fair-events/v1/get-tickets/cancel-payment',
				method: 'POST',
				data: {
					transaction_id: parseInt(
						container.dataset.transactionId,
						10
					),
					token: container.dataset.token || '',
				},
			})
				.catch(function (error) {
					console.error('Cancel payment error:', error);
				})
				.finally(function () {
					const url = new URL(window.location.href);
					url.searchParams.delete('fair_payment_callback');
					url.searchParams.delete('transaction_id');
					url.searchParams.delete('token');
					window.location.href = url.toString();
				});
		});
	}

	function setupForm(form) {
		form.addEventListener('submit', function (e) {
			e.preventDefault();

			if (!validateForm(form)) {
				return;
			}

			const data = collectFormData(form);
			submitForm(form, data);
		});

		const ticketTypeFields = form.querySelectorAll(
			'input[name="ticket_type_id"]'
		);
		ticketTypeFields.forEach(function (field) {
			field.addEventListener('change', function () {
				refreshSignupState(form);
			});
		});

		const instancePicker = form.querySelector(
			'.fair-events-instance-picker'
		);
		if (instancePicker) {
			instancePicker
				.querySelectorAll('input[name="event_date_ids[]"]')
				.forEach(function (checkbox) {
					checkbox.addEventListener('change', function () {
						refreshSignupState(form);
					});
				});
		}

		const ticketOptions = form.querySelector('.fair-events-ticket-options');
		if (ticketOptions) {
			ticketOptions
				.querySelectorAll('input[name="ticket_option_ids[]"]')
				.forEach(function (checkbox) {
					checkbox.addEventListener('change', function () {
						refreshSignupState(form);
					});
				});
		}

		wireAddActivities(form);

		refreshSignupState(form);
	}

	/**
	 * Recompute every selection-dependent piece of UI (occurrence/instance
	 * picker, ticket-options fieldset, submit gate) in one pass. Wired to every
	 * input whose change can affect any of them, so the instance and activity
	 * gates always compose correctly regardless of which one changed.
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function refreshSignupState(form) {
		updateInstancePicker(form);
		updateTicketOptions(form);
		updateSubmitGate(form);
	}

	/**
	 * Whether the selected ticket type is a 'whole_series' scope pass.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {boolean} True when the selected ticket covers the whole series.
	 */
	function isWholeSeriesSelected(form) {
		const option = getSelectedTicketTypeOption(form);
		return !!option && option.dataset.recurrenceScope === 'whole_series';
	}

	/**
	 * Checked ticket type radio input, if any.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {HTMLInputElement|null} The checked radio input element.
	 */
	function getSelectedTicketTypeOption(form) {
		return form.querySelector('input[name="ticket_type_id"]:checked');
	}

	/**
	 * Whether the selected ticket type is a 'multiple_instances' scope pass.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {boolean} True when the multi-occurrence checkbox picker applies.
	 */
	function isMultipleInstancesSelected(form) {
		const option = getSelectedTicketTypeOption(form);
		return (
			!!option && option.dataset.recurrenceScope === 'multiple_instances'
		);
	}

	/**
	 * Toggle the single-occurrence dropdown based on the selected ticket type's
	 * scope: visible for 'single_instance' (or no ticket type selected), hidden
	 * for 'whole_series' and 'multiple_instances' (the checkbox picker handles
	 * that case instead).
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function updateOccurrencePicker(form) {
		const occurrencePicker = form.querySelector(
			'.fair-events-occurrence-picker'
		);
		if (!occurrencePicker) {
			return;
		}

		const active =
			!isMultipleInstancesSelected(form) && !isWholeSeriesSelected(form);
		occurrencePicker.style.display = active ? '' : 'none';
	}

	/**
	 * Toggle the multi-occurrence checkbox picker (and hide the quantity field,
	 * since v1 fixes quantity to 1 for this scope — instance count is the only
	 * multiplier) based on the selected ticket type, and keep the minimum hint
	 * and live total in sync.
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function updateInstancePicker(form) {
		updateOccurrencePicker(form);

		const instancePicker = form.querySelector(
			'.fair-events-instance-picker'
		);
		const quantityRow = form.querySelector('.fair-events-quantity-row');
		const quantityField = form.querySelector('input[name="quantity"]');
		if (!instancePicker) {
			return;
		}

		const active = isMultipleInstancesSelected(form);
		instancePicker.style.display = active ? '' : 'none';
		if (quantityRow) {
			quantityRow.style.display = active ? 'none' : '';
		}
		if (active && quantityField) {
			quantityField.value = '1';
		}

		if (!active) {
			instancePicker
				.querySelectorAll('input[type="checkbox"]')
				.forEach(function (cb) {
					cb.checked = false;
				});
			return;
		}

		const option = getSelectedTicketTypeOption(form);
		const min = parseInt(option.dataset.minInstances || '0', 10);
		const price = parseFloat(option.dataset.ticketPrice || 0);
		const checked = instancePicker.querySelectorAll(
			'input[name="event_date_ids[]"]:checked'
		).length;

		const hint = instancePicker.querySelector(
			'.fair-events-instance-picker-hint'
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
								'fair-events'
							),
							min
					  )
					: '';
		}

		const totalEl = instancePicker.querySelector(
			'.fair-events-instance-picker-total'
		);
		if (totalEl) {
			totalEl.textContent =
				checked > 0
					? sprintf(
							/* translators: %s: formatted total price */
							__('Total: %s', 'fair-events'),
							formatMoney(
								computeTicketTotal({
									unitPrice: price,
									count: checked,
								}),
								form.dataset.currency
							)
					  )
					: '';
		}
	}

	/**
	 * Whether the event date has an activities (ticket options) fieldset at
	 * all — used to pin quantity to 1, same treatment 'multiple_instances'
	 * ticket types get, since activities attach to a single EventParticipant
	 * row.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {boolean} True when an activities fieldset is present.
	 */
	function hasActivityOptions(form) {
		return !!form.querySelector('.fair-events-ticket-options');
	}

	/**
	 * Compute the effective minimum number of activities: the event-date
	 * global baseline, possibly raised by the selected ticket type, capped at
	 * the number of options available so the requirement is never impossible
	 * to satisfy.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {number} The effective minimum (0 when no minimum applies).
	 */
	function getEffectiveActivityMinimum(form) {
		const globalMin = parseInt(form.dataset.minActivities || '0', 10);
		const selectedTicketType = getSelectedTicketTypeOption(form);
		const typeMin = selectedTicketType
			? parseInt(selectedTicketType.dataset.minActivities || '0', 10)
			: 0;
		const optionCount = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		).length;

		return Math.min(Math.max(globalMin, typeMin), optionCount);
	}

	/**
	 * Whether enough activities are currently checked to satisfy the
	 * effective minimum. Always true when the fieldset is hidden
	 * ('multiple_instances' ignores activities) or there's no minimum.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {boolean} True when the requirement is satisfied.
	 */
	function meetsActivityMinimum(form) {
		if (!hasActivityOptions(form) || isMultipleInstancesSelected(form)) {
			return true;
		}
		const effectiveMin = getEffectiveActivityMinimum(form);
		if (!effectiveMin) {
			return true;
		}
		const checkedCount = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		).length;
		return checkedCount >= effectiveMin;
	}

	/**
	 * Whether enough occurrences are checked to satisfy the selected
	 * 'multiple_instances' ticket type's minimum. Always true when that scope
	 * isn't active.
	 * @param {HTMLFormElement} form The get-tickets form.
	 * @return {boolean} True when the requirement is satisfied.
	 */
	function meetsInstanceMinimum(form) {
		if (!isMultipleInstancesSelected(form)) {
			return true;
		}
		const option = getSelectedTicketTypeOption(form);
		const min = Math.max(
			1,
			parseInt(option.dataset.minInstances || '0', 10)
		);
		const checked = form.querySelectorAll(
			'input[name="event_date_ids[]"]:checked'
		).length;
		return checked >= min;
	}

	/**
	 * Disable the submit button until both the instance and activity
	 * minimums (independent gates that must both hold) are satisfied. Also
	 * pins quantity to 1 whenever activities are configured, since
	 * updateInstancePicker() only knows about the 'multiple_instances' case.
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function updateSubmitGate(form) {
		const quantityRow = form.querySelector('.fair-events-quantity-row');
		const quantityField = form.querySelector('input[name="quantity"]');
		if (
			hasActivityOptions(form) &&
			!isMultipleInstancesSelected(form) &&
			quantityField
		) {
			if (quantityRow) {
				quantityRow.style.display = 'none';
			}
			quantityField.value = '1';
		}

		const submitButton = form.querySelector('button[type="submit"]');
		if (!submitButton) {
			return;
		}
		const enabled =
			meetsInstanceMinimum(form) && meetsActivityMinimum(form);
		submitButton.disabled = !enabled;
		submitButton.classList.toggle('is-disabled', !enabled);
	}

	/**
	 * Toggle the activities (ticket options) fieldset based on the selected
	 * ticket type ('multiple_instances' ignores activities, mirroring the
	 * legacy form), and keep its minimum hint, per-option add-on price tags,
	 * and live total in sync.
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function updateTicketOptions(form) {
		const fieldset = form.querySelector('.fair-events-ticket-options');
		if (!fieldset) {
			return;
		}
		const row = fieldset.closest('.form-row') || fieldset;

		const hidden = isMultipleInstancesSelected(form);
		row.style.display = hidden ? 'none' : '';
		if (hidden) {
			fieldset
				.querySelectorAll('input[type="checkbox"]')
				.forEach(function (cb) {
					cb.checked = false;
				});
		}

		const effectiveMin = getEffectiveActivityMinimum(form);
		const checkedOptions = fieldset.querySelectorAll(
			'input[name="ticket_option_ids[]"]:checked'
		);

		const hint = fieldset.querySelector(
			'.fair-events-ticket-options-min-hint'
		);
		if (hint) {
			if (!hidden && effectiveMin > 0) {
				hint.textContent = sprintf(
					/* translators: %d: minimum number of activities required */
					_n(
						'Please select at least %d activity to sign up.',
						'Please select at least %d activities to sign up.',
						effectiveMin,
						'fair-events'
					),
					effectiveMin
				);
				hint.style.display = '';
			} else {
				hint.style.display = 'none';
			}
		}

		// Reveal the per-option "(+price)" add-on tag on unchecked options once
		// the minimum is met (or there is none), so the checkbox list doesn't
		// show a price twice.
		const meetsMin =
			effectiveMin === 0 || checkedOptions.length >= effectiveMin;
		fieldset
			.querySelectorAll('input[name="ticket_option_ids[]"]')
			.forEach(function (input) {
				const label = input.closest('label');
				const addon = label
					? label.querySelector('.fair-events-ticket-option-addon')
					: null;
				if (!addon) {
					return;
				}
				addon.style.display = meetsMin && !input.checked ? '' : 'none';
			});

		const totalEl = fieldset.querySelector(
			'.fair-events-ticket-options-total'
		);
		if (totalEl) {
			const selectedTicketType = getSelectedTicketTypeOption(form);
			const unitPrice = selectedTicketType
				? parseFloat(selectedTicketType.dataset.ticketPrice || 0)
				: 0;
			const optionPrices = Array.from(checkedOptions).map((input) =>
				parseFloat(input.dataset.optionPrice || 0)
			);
			const total = computeTicketTotal({
				unitPrice,
				count: 1,
				optionPrices,
			});
			totalEl.textContent =
				!hidden && checkedOptions.length > 0
					? sprintf(
							/* translators: %s: formatted total price */
							__('Total: %s', 'fair-events'),
							formatMoney(total, form.dataset.currency)
					  )
					: '';
		}
	}

	/**
	 * Wire the "add activities" section shown to a signed-up viewer (rendered
	 * by fair-audience's SignupHookBridge, since only it can persist the
	 * selection): keep the Add button's total in sync with the checked
	 * options and submit on click. No-op when the section isn't present.
	 * @param {HTMLFormElement} form The get-tickets form (used to reach the
	 *                                shared currency/message container).
	 */
	function wireAddActivities(form) {
		const block = form.closest('.fair-events-get-tickets');
		const section = block
			? block.querySelector('.fair-events-add-activities')
			: null;
		if (!section) {
			return;
		}
		const button = section.querySelector(
			'.fair-events-add-activities-button'
		);
		if (!button) {
			return;
		}
		const checkboxes = section.querySelectorAll(
			'input[name="add_option_ids[]"]'
		);

		const baseText = __('Add activities', 'fair-events');
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
				total > 0
					? baseText +
					  ' — ' +
					  formatMoney(total, form.dataset.currency)
					: baseText;
		};

		checkboxes.forEach(function (cb) {
			cb.addEventListener('change', updateButton);
		});
		button.addEventListener('click', function () {
			submitAddActivities(block, section, button);
		});

		updateButton();
	}

	/**
	 * Submit the add-activities request to fair-audience's existing route.
	 * Redirects to checkout when the added activities are priced; otherwise
	 * reloads to reflect the updated list.
	 * @param {HTMLElement} block   The .fair-events-get-tickets wrapper.
	 * @param {HTMLElement} section The .fair-events-add-activities section.
	 * @param {HTMLElement} button  The add-activities button.
	 */
	function submitAddActivities(block, section, button) {
		const eventId = parseInt(section.dataset.eventId, 10);
		const eventDateId = section.dataset.eventDateId
			? parseInt(section.dataset.eventDateId, 10)
			: null;
		const token = section.dataset.participantToken || '';
		const messageContainer = block.querySelector('.message-container');

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

		const restoreButton = setButtonLoading(
			button,
			__('Adding…', 'fair-events')
		);

		apiFetch({
			path: '/fair-audience/v1/event-signup/add-activities',
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
				if (response && response.success) {
					showMessage(
						messageContainer,
						response.message ||
							__(
								'Your activities have been added!',
								'fair-events'
							),
						'success',
						CSS_PREFIX
					);
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
						'fair-events'
					)
				);
				showMessage(
					messageContainer,
					errorMessage,
					'error',
					CSS_PREFIX
				);
				restoreButton();
			});
	}

	function validateForm(form) {
		const messageContainer = form
			.closest('.fair-events-get-tickets')
			.querySelector('.message-container');
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
			showMessage(
				messageContainer,
				__('Please fill in all required fields.', 'fair-events'),
				'error',
				CSS_PREFIX
			);
			return false;
		}

		const emailField = form.querySelector('input[name="email"]');
		if (emailField && emailField.value) {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			if (!emailRegex.test(emailField.value)) {
				showMessage(
					messageContainer,
					__('Please enter a valid email address.', 'fair-events'),
					'error',
					CSS_PREFIX
				);
				emailField.classList.add('error');
				return false;
			}
		}

		if (isMultipleInstancesSelected(form)) {
			const option = getSelectedTicketTypeOption(form);
			const min = Math.max(
				1,
				parseInt(option.dataset.minInstances || '0', 10)
			);
			const checked = form.querySelectorAll(
				'input[name="event_date_ids[]"]:checked'
			).length;
			if (checked < min) {
				showMessage(
					messageContainer,
					sprintf(
						/* translators: %d: minimum number of occurrences required */
						_n(
							'Please select at least %d occurrence.',
							'Please select at least %d occurrences.',
							min,
							'fair-events'
						),
						min
					),
					'error',
					CSS_PREFIX
				);
				return false;
			}
		} else {
			const quantityField = form.querySelector('input[name="quantity"]');
			if (quantityField) {
				const qty = parseInt(quantityField.value, 10);
				if (isNaN(qty) || qty < 1 || qty > 10) {
					showMessage(
						messageContainer,
						__('Quantity must be between 1 and 10.', 'fair-events'),
						'error',
						CSS_PREFIX
					);
					return false;
				}
			}
		}

		if (!meetsActivityMinimum(form)) {
			const effectiveMin = getEffectiveActivityMinimum(form);
			showMessage(
				messageContainer,
				sprintf(
					/* translators: %d: minimum number of activities required */
					_n(
						'Please select at least %d activity to sign up.',
						'Please select at least %d activities to sign up.',
						effectiveMin,
						'fair-events'
					),
					effectiveMin
				),
				'error',
				CSS_PREFIX
			);
			return false;
		}

		const questionError = validateQuestions(form);
		if (questionError) {
			showMessage(messageContainer, questionError, 'error', CSS_PREFIX);
			return false;
		}

		return true;
	}

	function collectFormData(form) {
		const data = {};

		const occurrenceSelect = form.querySelector(
			'select[name="event_date_id_single"]'
		);
		if (
			occurrenceSelect &&
			!isMultipleInstancesSelected(form) &&
			!isWholeSeriesSelected(form)
		) {
			data.event_date_id = parseInt(occurrenceSelect.value, 10);
		} else {
			data.event_date_id = parseInt(
				form.getAttribute('data-event-date-id') || '0',
				10
			);
		}

		const nameField = form.querySelector('input[name="name"]');
		if (nameField) {
			data.name = nameField.value;
		}

		const emailField = form.querySelector('input[name="email"]');
		if (emailField) {
			data.email = emailField.value;
		}

		const ticketTypeField = form.querySelector(
			'input[name="ticket_type_id"]:checked'
		);
		if (ticketTypeField && ticketTypeField.value) {
			data.ticket_type_id = parseInt(ticketTypeField.value, 10);
		}

		if (isMultipleInstancesSelected(form)) {
			data.quantity = 1;
			const instanceInputs = form.querySelectorAll(
				'input[name="event_date_ids[]"]:checked'
			);
			data.event_date_ids = Array.from(instanceInputs).map((i) =>
				parseInt(i.value, 10)
			);
		} else {
			const quantityField = form.querySelector('input[name="quantity"]');
			if (quantityField) {
				data.quantity = Math.max(
					1,
					Math.min(10, parseInt(quantityField.value, 10) || 1)
				);
			}
		}

		if (hasActivityOptions(form) && !isMultipleInstancesSelected(form)) {
			const optionInputs = form.querySelectorAll(
				'input[name="ticket_option_ids[]"]:checked'
			);
			data.ticket_option_ids = Array.from(optionInputs).map((i) =>
				parseInt(i.value, 10)
			);
		}

		const mailingField = form.querySelector('input[name="mailing_opt_in"]');
		data.mailing_opt_in = mailingField ? mailingField.checked : false;

		const honeypotField = form.querySelector('input[name="_honeypot"]');
		data._honeypot = honeypotField ? honeypotField.value : '';

		data.questionnaire_answers = collectQuestionAnswers(form);

		return data;
	}

	function submitForm(form, data) {
		const messageContainer = form
			.closest('.fair-events-get-tickets')
			.querySelector('.message-container');
		const submitButton = form.querySelector('button[type="submit"]');

		messageContainer.textContent = '';
		messageContainer.className = 'message-container';

		initiatePayment({
			apiPath: '/fair-events/v1/get-tickets',
			data,
			button: submitButton,
			loadingText: __('Processing…', 'fair-events'),
			defaultErrorMessage: __(
				'Failed to submit. Please try again.',
				'fair-events'
			),
			onError: (message) => {
				showMessage(messageContainer, message, 'error', CSS_PREFIX);
			},
		})
			.then(function (response) {
				if (response.checkout_url) {
					return;
				}

				showMessage(
					messageContainer,
					response.message ||
						__('You have successfully registered!', 'fair-events'),
					'success',
					CSS_PREFIX
				);
				form.style.display = 'none';
			})
			.catch(function () {
				// Error already surfaced via onError.
			});
	}
})();
