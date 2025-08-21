/**
 * Frontend JavaScript for Simple Payment Block
 */

/**
 * Initialize payment functionality when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function () {
	// Find all simple payment blocks
	const paymentBlocks = document.querySelectorAll('.simple-payment-block');

	paymentBlocks.forEach((block) => {
		initializePaymentBlock(block);
	});
});

/**
 * Initialize payment functionality for a single block
 *
 * @param {HTMLElement} block - The payment block element
 */
function initializePaymentBlock(block) {
	const buttonWrapper = block.querySelector('.simple-payment-button-wrapper');
	const button = block.querySelector('.simple-payment-button');

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
		// Here you would integrate with your payment API
		// For now, we'll simulate the payment process

		console.log('Processing payment:', { amount, currency });

		// Simulate API call delay
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Example API call (replace with actual payment integration)
		const response = await fetch(
			'/wp-json/fair-payment/v1/create-payment',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': window.wpApiSettings?.nonce || '',
				},
				body: JSON.stringify({
					amount,
					currency,
				}),
			}
		);

		if (response.ok) {
			const data = await response.json();

			// Handle successful payment response
			if (data.checkout_url) {
				// Redirect to payment checkout
				window.location.href = data.checkout_url;
			} else {
				// Show success message
				button.textContent = 'Payment Successful!';
				button.style.backgroundColor = '#28a745';
			}
		} else {
			throw new Error('Payment processing failed');
		}
	} catch (error) {
		console.error('Payment error:', error);

		// Show error state
		button.textContent = 'Payment Failed - Try Again';
		button.style.backgroundColor = '#dc3545';

		// Reset button after 3 seconds
		setTimeout(() => {
			button.textContent = originalText;
			button.style.backgroundColor = '';
			button.disabled = false;
		}, 3000);
	}
}
