/**
 * Fair Payment Admin JavaScript
 */

import '../css/admin.scss';

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
	initFairPaymentAdmin();
});

/**
 * Initialize Fair Payment Admin functionality
 */
function initFairPaymentAdmin() {
	initStripeConnectionTest();
	initPasswordToggle();
	initFormValidation();
}

/**
 * Initialize Stripe connection test functionality
 */
function initStripeConnectionTest() {
	const testButton = document.getElementById(
		'test-comprehensive-stripe-connection'
	);
	if (!testButton) return;

	testButton.addEventListener('click', function () {
		const secretKey = document.getElementById('stripe_secret_key')?.value;
		const publishableKey = document.getElementById(
			'stripe_publishable_key'
		)?.value;
		const resultsDiv = document.getElementById(
			'comprehensive-stripe-test-results'
		);
		const button = this;
		const originalContent = button.innerHTML;

		if (!secretKey?.trim()) {
			showError(resultsDiv, fairPaymentAdmin.strings.enterSecretKey);
			return;
		}

		// Set loading state
		setLoadingState(button, true);
		showInfo(resultsDiv, fairPaymentAdmin.strings.testingConfiguration);

		// Call the REST API endpoint
		fetch(fairPaymentAdmin.apiUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': fairPaymentAdmin.nonce,
			},
			body: JSON.stringify({
				secret_key: secretKey,
				publishable_key: publishableKey,
				_wpnonce: fairPaymentAdmin.nonce,
			}),
		})
			.then((response) => response.json())
			.then((data) => {
				if (data.success) {
					resultsDiv.innerHTML = buildSuccessResults(data.data);
				} else {
					showError(
						resultsDiv,
						data.data?.message ||
							data.message ||
							fairPaymentAdmin.strings.unknownError
					);
				}
			})
			.catch((error) => {
				console.error('Fair Payment API Error:', error);
				showError(
					resultsDiv,
					`${fairPaymentAdmin.strings.connectionFailed}: ${error.message}`
				);
			})
			.finally(() => {
				setLoadingState(button, false, originalContent);
			});
	});
}

/**
 * Initialize password field toggle functionality
 */
function initPasswordToggle() {
	const toggleButtons = document.querySelectorAll(
		'.fair-payment-password-toggle'
	);

	toggleButtons.forEach((button) => {
		button.addEventListener('click', function () {
			const input = this.previousElementSibling;
			if (input && input.type === 'password') {
				input.type = 'text';
				this.textContent = fairPaymentAdmin.strings.hide;
				this.setAttribute(
					'aria-label',
					fairPaymentAdmin.strings.hidePassword
				);
			} else if (input && input.type === 'text') {
				input.type = 'password';
				this.textContent = fairPaymentAdmin.strings.show;
				this.setAttribute(
					'aria-label',
					fairPaymentAdmin.strings.showPassword
				);
			}
		});
	});
}

/**
 * Initialize form validation
 */
function initFormValidation() {
	const secretKeyField = document.getElementById('stripe_secret_key');
	const publishableKeyField = document.getElementById(
		'stripe_publishable_key'
	);

	if (secretKeyField) {
		secretKeyField.addEventListener('blur', function () {
			validateStripeKey(this, 'sk');
		});
	}

	if (publishableKeyField) {
		publishableKeyField.addEventListener('blur', function () {
			validateStripeKey(this, 'pk');
		});
	}
}

/**
 * Validate Stripe key format
 */
function validateStripeKey(field, keyType) {
	const value = field.value.trim();
	if (!value) return; // Allow empty values

	const pattern = new RegExp(`^${keyType}_(test|live)_[a-zA-Z0-9]+$`);
	const isValid = pattern.test(value);

	// Remove existing validation classes
	field.classList.remove('fair-payment-valid', 'fair-payment-invalid');

	// Add appropriate class
	if (isValid) {
		field.classList.add('fair-payment-valid');
	} else {
		field.classList.add('fair-payment-invalid');
	}
}

/**
 * Set button loading state
 */
function setLoadingState(button, isLoading, originalContent = null) {
	if (isLoading) {
		button.disabled = true;
		button.innerHTML = `<span class="dashicons dashicons-update-alt fair-payment-spin"></span>${fairPaymentAdmin.strings.testing}`;
	} else {
		button.disabled = false;
		button.innerHTML = originalContent || button.innerHTML;
	}
}

/**
 * Show error message
 */
function showError(container, message) {
	container.innerHTML = `<div class="notice notice-error"><p><strong>${fairPaymentAdmin.strings.testFailed}</strong></p><p>${message}</p></div>`;
}

/**
 * Show info message
 */
function showInfo(container, message) {
	container.innerHTML = `<div class="notice notice-info"><p>${message}</p></div>`;
}

/**
 * Build success results HTML
 */
function buildSuccessResults(data) {
	let html = `<div class="notice notice-success"><p><strong>${fairPaymentAdmin.strings.testSuccessful}</strong></p></div>`;

	html += '<div class="fair-payment-test-results">';

	// Secret Key Results
	html += '<div class="fair-payment-result-card fair-payment-success">';
	html += `<h4>${fairPaymentAdmin.strings.secretKey}</h4>`;
	if (data.secret_key?.valid) {
		html += `<p class="fair-payment-status-valid"><span class="dashicons dashicons-yes-alt"></span> ${fairPaymentAdmin.strings.valid}</p>`;
		html += `<p><strong>${fairPaymentAdmin.strings.mode}:</strong> ${data.secret_key.mode || 'unknown'}</p>`;
	}
	html += '</div>';

	// Publishable Key Results
	const publishableStatus = data.publishable_key?.valid
		? 'success'
		: data.publishable_key
			? 'error'
			: 'warning';
	html += `<div class="fair-payment-result-card fair-payment-${publishableStatus}">`;
	html += `<h4>${fairPaymentAdmin.strings.publishableKey}</h4>`;
	if (data.publishable_key) {
		if (data.publishable_key.valid) {
			html += `<p class="fair-payment-status-valid"><span class="dashicons dashicons-yes-alt"></span> ${fairPaymentAdmin.strings.valid}</p>`;
			html += `<p><strong>${fairPaymentAdmin.strings.mode}:</strong> ${data.publishable_key.mode || 'unknown'}</p>`;
		} else {
			html += `<p class="fair-payment-status-invalid"><span class="dashicons dashicons-dismiss"></span> ${fairPaymentAdmin.strings.invalid}</p>`;
			html += `<p class="fair-payment-error">${data.publishable_key.error || fairPaymentAdmin.strings.unknownError}</p>`;
		}
	} else {
		html += `<p class="fair-payment-status-warning"><span class="dashicons dashicons-warning"></span> ${fairPaymentAdmin.strings.notTested}</p>`;
		html += `<p class="fair-payment-muted">${fairPaymentAdmin.strings.noPublishableKey}</p>`;
	}
	html += '</div>';

	html += '</div>';

	// Connection Details
	if (data.balance || data.connection) {
		html += '<div class="fair-payment-connection-details">';
		html += `<h4>${fairPaymentAdmin.strings.connectionDetails}</h4>`;

		if (data.connection?.response_time) {
			html += `<p><strong>${fairPaymentAdmin.strings.responseTime}:</strong> ${data.connection.response_time}ms</p>`;
		}

		if (data.balance?.currencies?.length > 0) {
			html += `<p><strong>${fairPaymentAdmin.strings.availableCurrencies}:</strong> ${data.balance.currencies.join(', ').toUpperCase()}</p>`;
		}

		if (data.connection?.api_version) {
			html += `<p><strong>${fairPaymentAdmin.strings.apiVersion}:</strong> ${data.connection.api_version}</p>`;
		}

		html += '</div>';
	}

	return html;
}

// Export for potential external use
window.FairPaymentAdmin = {
	initStripeConnectionTest,
	initPasswordToggle,
	initFormValidation,
	validateStripeKey,
};
