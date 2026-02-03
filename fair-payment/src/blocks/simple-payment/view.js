/**
 * Frontend JavaScript for Simple Payment Block
 *
 * @package FairPayment
 */

import apiFetch from '@wordpress/api-fetch';

( function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', initPaymentButtons );
	} else {
		initPaymentButtons();
	}

	function initPaymentButtons() {
		const buttons = document.querySelectorAll( '.fair-payment-button' );

		buttons.forEach( function ( button ) {
			button.addEventListener( 'click', handlePaymentClick );
		} );
	}

	async function handlePaymentClick( event ) {
		const button = event.target;
		const paymentBlock = button.closest( '.fair-payment-block' );
		const loadingEl = paymentBlock.querySelector( '.fair-payment-loading' );
		const errorEl = paymentBlock.querySelector( '.fair-payment-error' );

		// Get payment data from button attributes
		const amount = button.getAttribute( 'data-amount' );
		const currency = button.getAttribute( 'data-currency' );
		const description = button.getAttribute( 'data-description' );
		const postId = button.getAttribute( 'data-post-id' );

		// Hide error, show loading
		if ( errorEl ) {
			errorEl.style.display = 'none';
		}
		if ( loadingEl ) {
			loadingEl.style.display = 'block';
		}
		button.disabled = true;

		try {
			// Create payment via REST API using WordPress apiFetch
			const data = await apiFetch( {
				path: '/fair-payment/v1/payments',
				method: 'POST',
				data: {
					amount: amount,
					currency: currency,
					description: description,
					post_id: postId,
				},
			} );

			// Redirect to Mollie checkout
			if ( data.checkout_url ) {
				window.location.href = data.checkout_url;
			} else {
				throw new Error( 'No checkout URL received' );
			}
		} catch ( error ) {
			// Show error message
			if ( errorEl ) {
				// apiFetch errors may have a message property directly or nested in data
				const errorMessage =
					error.message ||
					( error.data && error.data.message ) ||
					'Failed to create payment';
				errorEl.textContent = errorMessage;
				errorEl.style.display = 'block';
			}
			if ( loadingEl ) {
				loadingEl.style.display = 'none';
			}
			button.disabled = false;

			console.error( 'Payment error:', error );
		}
	}
} )();
