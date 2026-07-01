/**
 * Get Tickets Block - Frontend JavaScript
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import {
	showMessage,
	onDomReady,
	initiatePayment,
	handlePaymentCallback,
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
			'select[name="ticket_type_id"]'
		);
		if (ticketTypeField && ticketTypeField.value) {
			data.ticket_type_id = parseInt(ticketTypeField.value, 10);
		}

		const quantityField = form.querySelector('input[name="quantity"]');
		if (quantityField) {
			data.quantity = Math.max(
				1,
				Math.min(10, parseInt(quantityField.value, 10) || 1)
			);
		}

		const mailingField = form.querySelector('input[name="mailing_opt_in"]');
		data.mailing_opt_in = mailingField ? mailingField.checked : false;

		const honeypotField = form.querySelector('input[name="_honeypot"]');
		data._honeypot = honeypotField ? honeypotField.value : '';

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
