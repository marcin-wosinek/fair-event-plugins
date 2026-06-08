/**
 * Frontend JavaScript for Simple Payment Block
 *
 * @package FairPaymentsConnector
 */

import apiFetch from '@wordpress/api-fetch';

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
	}

	function initPaymentButtons() {
		const buttons = document.querySelectorAll(
			'.fair-payments-connector-button'
		);

		buttons.forEach(function (button) {
			button.addEventListener('click', handlePaymentClick);
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
			callback.remove();
		}

		const url = new URL(window.location.href);
		url.searchParams.delete('fair_payment_callback');
		url.searchParams.delete('transaction_id');
		window.history.replaceState({}, '', url.toString());
	}

	async function handlePaymentClick(event) {
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

		// Hide error, show loading
		if (errorEl) {
			errorEl.style.display = 'none';
		}
		if (loadingEl) {
			loadingEl.style.display = 'block';
		}
		button.disabled = true;

		try {
			// Create payment via REST API using WordPress apiFetch
			const data = await apiFetch({
				path: '/fair-payments-connector/v1/payments',
				method: 'POST',
				data: {
					amount: amount,
					currency: currency,
					description: description,
					post_id: postId,
				},
			});

			// Redirect to Mollie checkout
			if (data.checkout_url) {
				window.location.href = data.checkout_url;
			} else {
				throw new Error('No checkout URL received');
			}
		} catch (error) {
			// Show error message
			if (errorEl) {
				// apiFetch errors may have a message property directly or nested in data
				const errorMessage =
					error.message ||
					(error.data && error.data.message) ||
					'Failed to create payment';
				errorEl.textContent = errorMessage;
				errorEl.style.display = 'block';
			}
			if (loadingEl) {
				loadingEl.style.display = 'none';
			}
			button.disabled = false;

			console.error('Payment error:', error);
		}
	}
})();
