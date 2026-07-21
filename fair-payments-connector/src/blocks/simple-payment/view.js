/**
 * Frontend JavaScript for Simple Payment Block
 *
 * @package FairPaymentsConnector
 */

import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	initiatePayment,
	handlePaymentCallback,
	renderPaymentError,
	wireRestartButton,
} from 'fair-events-shared';

const STATUS_PATH = '/fair-payments-connector/v1/payments';

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	function init() {
		initPaymentButtons();
		initCallbackDismiss();
		initRestart();
		initCallbackPolling();
	}

	function initPaymentButtons() {
		const buttons = document.querySelectorAll(
			'.fair-payments-connector-button'
		);

		buttons.forEach(function (button) {
			// Fetch a fresh nonce per button instance on page load so cached pages
			// don't embed a stale nonce in static HTML.
			const noncePromise = apiFetch({
				path: '/fair-payments-connector/v1/nonce',
			}).then((res) => res.nonce);

			button.addEventListener('click', (event) =>
				handlePaymentClick(event, noncePromise)
			);
		});
	}

	function initCallbackDismiss() {
		const buttons = document.querySelectorAll(
			'.fair-payments-connector-callback-dismiss'
		);

		buttons.forEach(function (button) {
			button.addEventListener('click', handleCallbackDismiss);
		});
	}

	function handleCallbackDismiss(event) {
		const button = event.currentTarget;
		const callback = button.closest('.fair-payments-connector-callback');

		if (callback) {
			callback.style.display = 'none';
		}

		const url = new URL(window.location.href);
		url.searchParams.delete('fair_payment_callback');
		url.searchParams.delete('transaction_id');
		url.searchParams.delete('token');
		window.history.replaceState({}, '', url.toString());
	}

	function initRestart() {
		const callbackEl = document.querySelector(
			'.fair-payments-connector-callback'
		);
		const restartButton = document.querySelector(
			'.fair-payments-connector-restart'
		);
		const paymentForm = document.querySelector(
			'.fair-payments-connector-payment-form'
		);

		wireRestartButton({
			button: restartButton,
			form: paymentForm,
			onReset: () => {
				if (callbackEl) {
					callbackEl.style.display = 'none';
				}
			},
		});
	}

	function initCallbackPolling() {
		const callbackEl = document.querySelector(
			'.fair-payments-connector-callback'
		);
		if (!callbackEl) {
			return;
		}

		handlePaymentCallback({
			statusPath: STATUS_PATH,
			onConfirmed: () => updateCallbackState(callbackEl, 'confirmed'),
			onFailed: () => updateCallbackState(callbackEl, 'failed'),
		});
	}

	function updateCallbackState(callbackEl, status) {
		callbackEl.querySelectorAll('[data-status]').forEach(function (el) {
			el.style.display =
				el.getAttribute('data-status') === status ? 'block' : 'none';
		});

		const restartButton = callbackEl.querySelector(
			'.fair-payments-connector-restart'
		);
		const dismissButton = callbackEl.querySelector(
			'.fair-payments-connector-callback-dismiss'
		);

		if (restartButton) {
			restartButton.style.display =
				status === 'failed' ? 'block' : 'none';
		}
		if (dismissButton) {
			dismissButton.style.display =
				status === 'failed' ? 'none' : 'block';
		}
	}

	function handlePaymentClick(event, noncePromise) {
		const button = event.target;
		const paymentBlock = button.closest('.fair-payments-connector-block');
		const loadingEl = paymentBlock.querySelector(
			'.fair-payments-connector-loading'
		);
		const errorEl = paymentBlock.querySelector(
			'.fair-payments-connector-error'
		);

		// Get payment data from button attributes
		const amount = button.getAttribute('data-amount');
		const currency = button.getAttribute('data-currency');
		const description = button.getAttribute('data-description');
		const postId = button.getAttribute('data-post-id');
		const blockId = button.getAttribute('data-block-id');

		// Hide error, show loading
		if (errorEl) {
			errorEl.style.display = 'none';
		}
		if (loadingEl) {
			loadingEl.style.display = 'block';
		}
		button.disabled = true;

		noncePromise
			.then((nonce) =>
				initiatePayment({
					apiPath: '/fair-payments-connector/v1/payments',
					data: {
						amount,
						currency,
						description,
						post_id: postId,
						block_id: blockId,
						nonce,
					},
					defaultErrorMessage: __(
						'Failed to create payment',
						'fair-payments-connector'
					),
					onError: (message, error) => {
						renderPaymentError(
							errorEl,
							error,
							message,
							'fair-payments-connector'
						);
						if (loadingEl) {
							loadingEl.style.display = 'none';
						}
						button.disabled = false;
					},
				})
			)
			.catch(() => {
				// Error already surfaced via onError.
			});
	}
})();
