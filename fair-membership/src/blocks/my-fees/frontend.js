/**
 * Frontend script for My Fees block
 *
 * @package FairMembership
 */

import apiFetch from '@wordpress/api-fetch';

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initializePaymentButtons);
	} else {
		initializePaymentButtons();
	}

	function initializePaymentButtons() {
		const payButtons = document.querySelectorAll('.pay-fee-button');

		payButtons.forEach((button) => {
			button.addEventListener('click', handlePaymentClick);
		});
	}

	async function handlePaymentClick(event) {
		const button = event.target;
		const feeId = button.dataset.feeId;

		if (!feeId) {
			console.error('Fee ID not found on button');
			return;
		}

		// Disable button and show loading state
		button.disabled = true;
		const originalText = button.textContent;
		button.textContent = button.dataset.loadingText || 'Processing...';

		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/user-fees/${feeId}/create-payment`,
				method: 'POST',
				data: {
					redirect_url: window.location.href,
				},
			});

			if (response.checkout_url) {
				// Redirect to checkout
				window.location.href = response.checkout_url;
			} else {
				throw new Error('No checkout URL in response');
			}
		} catch (error) {
			// Re-enable button and restore text
			button.disabled = false;
			button.textContent = originalText;

			// Show error message
			const errorMessage =
				error.message || 'Failed to create payment. Please try again.';
			alert(errorMessage);
			console.error('Payment creation failed:', error);
		}
	}
})();
