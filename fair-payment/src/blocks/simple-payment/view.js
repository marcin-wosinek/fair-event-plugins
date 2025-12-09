/**
 * Frontend JavaScript for Simple Payment Block
 *
 * @package FairPayment
 */

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initPaymentButtons);
	} else {
		initPaymentButtons();
	}

	function initPaymentButtons() {
		const buttons = document.querySelectorAll('.fair-payment-button');

		buttons.forEach(function (button) {
			button.addEventListener('click', handlePaymentClick);
		});
	}

	async function handlePaymentClick(event) {
		const button = event.target;
		const paymentBlock = button.closest('.fair-payment-block');
		const loadingEl = paymentBlock.querySelector('.fair-payment-loading');
		const errorEl = paymentBlock.querySelector('.fair-payment-error');

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
			// Create payment via REST API
			const response = await fetch('/wp-json/fair-payment/v1/payments', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					amount: amount,
					currency: currency,
					description: description,
					post_id: postId,
				}),
			});

			const data = await response.json();

			if (!response.ok || !data.success) {
				throw new Error(data.message || 'Failed to create payment');
			}

			// Redirect to Mollie checkout
			if (data.checkout_url) {
				window.location.href = data.checkout_url;
			} else {
				throw new Error('No checkout URL received');
			}
		} catch (error) {
			// Show error message
			if (errorEl) {
				errorEl.textContent = error.message;
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
