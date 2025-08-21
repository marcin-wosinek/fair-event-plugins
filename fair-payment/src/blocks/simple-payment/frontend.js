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
	// Reset button state
	button.textContent = originalText;
	button.disabled = false;

	// Show alert with payment information
	alert(`Payment initiated!\nAmount: ${amount} ${currency}`);

	console.log('Payment details:', { amount, currency });
}
