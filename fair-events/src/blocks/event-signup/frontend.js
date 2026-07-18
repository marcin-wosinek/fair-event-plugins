/**
 * Get Tickets Block - Frontend JavaScript
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import {
	showMessage,
	onDomReady,
	initiatePayment,
	handlePaymentCallback,
	computeTicketTotal,
	formatPrice,
	collectQuestionAnswers,
	validateQuestions,
} from 'fair-events-shared';
import './frontend.css';

const CSS_PREFIX = 'fair-events-get-tickets';
const STATUS_PATH = '/fair-payments-connector/v1/payments';

(function () {
	'use strict';

	onDomReady(initialize);

	function initialize() {
		const container = document.querySelector('.fair-events-get-tickets');
		handlePaymentCallback({
			statusPath: STATUS_PATH,
			onConfirmed: () => handleConfirmed(container),
		});

		const forms = document.querySelectorAll(
			'.fair-events-get-tickets-form'
		);
		forms.forEach(setupForm);
	}

	function handleConfirmed(container) {
		if (!container) {
			return;
		}

		const messageContainer = container.querySelector('.message-container');
		const form = container.querySelector('.fair-events-get-tickets-form');

		if (messageContainer) {
			showMessage(
				messageContainer,
				__(
					'Your ticket purchase was successful! Thank you.',
					'fair-events'
				),
				'success',
				CSS_PREFIX
			);
		}

		if (form) {
			form.style.display = 'none';
		}
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
				updateInstancePicker(form);
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
						updateInstancePicker(form);
					});
				});
		}

		updateInstancePicker(form);
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
	 * Toggle the multi-occurrence checkbox picker (and hide the quantity field,
	 * since v1 fixes quantity to 1 for this scope — instance count is the only
	 * multiplier) based on the selected ticket type, and keep the minimum hint
	 * and live total in sync.
	 * @param {HTMLFormElement} form The get-tickets form.
	 */
	function updateInstancePicker(form) {
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
							__('Total: €%s', 'fair-events'),
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

		const questionError = validateQuestions(form);
		if (questionError) {
			showMessage(messageContainer, questionError, 'error', CSS_PREFIX);
			return false;
		}

		return true;
	}

	function collectFormData(form) {
		const data = {};

		data.event_date_id = parseInt(
			form.getAttribute('data-event-date-id') || '0',
			10
		);

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
