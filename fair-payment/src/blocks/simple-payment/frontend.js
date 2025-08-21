/**
 * Frontend JavaScript for Simple Payment Block
 */

// Prevent multiple initializations
if (!window.fairPaymentInitialized) {
	window.fairPaymentInitialized = true;

	/**
	 * Initialize payment functionality when DOM is loaded
	 */
	document.addEventListener('DOMContentLoaded', function () {
		// Find all simple payment blocks
		const paymentBlocks = document.querySelectorAll(
			'.simple-payment-block'
		);

		paymentBlocks.forEach((block) => {
			initializePaymentBlock(block);
		});
	});
}

/**
 * Initialize payment functionality for a single block
 *
 * @param {HTMLElement} block - The payment block element
 */
function initializePaymentBlock(block) {
	const buttonWrapper = block.querySelector('.simple-payment-button-wrapper');
	const button = block.querySelector(
		'.simple-payment-button .wp-element-button'
	);

	if (!buttonWrapper || !button) {
		return;
	}

	// Get payment data from wrapper attributes
	const amount = buttonWrapper.getAttribute('data-amount');
	const currency = buttonWrapper.getAttribute('data-currency');

	// Add click event listener to the button
	button.addEventListener('click', function (event) {
		event.preventDefault();

		// Show loading state
		const originalText = button.textContent;
		button.textContent = 'Processing...';
		button.disabled = true;

		// Call payment processing function
		processPayment(amount, currency, button, originalText);
	});
}

/**
 * Process payment with the given parameters
 *
 * @param {string} amount - Payment amount
 * @param {string} currency - Payment currency
 * @param {HTMLElement} button - The clicked button element
 * @param {string} originalText - Original button text
 */
async function processPayment(amount, currency, button, originalText) {
	try {
		// Call the Stripe checkout endpoint
		const apiUrl = window.fairPaymentApi?.root
			? window.fairPaymentApi.root + '/create-stripe-checkout'
			: '/wp-json/fair-payment/v1/create-stripe-checkout';

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce':
					window.fairPaymentApi?.nonce ||
					window.wpApiSettings?.nonce ||
					'',
			},
			body: JSON.stringify({
				amount,
				currency,
				description: `Payment of ${amount} ${currency}`,
				_wpnonce:
					window.fairPaymentApi?.nonce ||
					window.wpApiSettings?.nonce ||
					'',
			}),
		});

		const data = await response.json();

		if (response.ok && data.success && data.data?.checkout_url) {
			// Redirect to Stripe checkout
			window.location.href = data.data.checkout_url;
		} else {
			throw new Error(
				data.message || 'Failed to create checkout session'
			);
		}
	} catch (error) {
		console.error('Payment error:', error);

		// Reset button state
		button.textContent = originalText;
		button.disabled = false;

		// Show error message
		alert(`Payment failed: ${error.message || 'Unknown error'}`);
	}
}
