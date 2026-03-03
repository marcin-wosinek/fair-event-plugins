import { __ } from '@wordpress/i18n';

/**
 * Shared form utilities for Fair Audience frontend blocks.
 *
 * @package FairAudience
 */

/**
 * Extract error message from API error object.
 *
 * @param {Object} error   Error object from apiFetch.
 * @param {string} defaultMessage Fallback message.
 * @return {string} Extracted error message.
 */
export function extractErrorMessage(error, defaultMessage) {
	if (error.message) {
		return error.message;
	}
	if (error.data && error.data.message) {
		return error.data.message;
	}
	return defaultMessage;
}

/**
 * Show a toast notification.
 *
 * @param {string} message The message to display.
 * @param {string} type    Notification type (success, error, info).
 */
export function showNotification(message, type) {
	const notification = document.createElement('div');
	notification.className =
		'fair-audience-notification fair-audience-notification-' + type;
	notification.textContent = message;

	notification.style.cssText =
		'position: fixed; top: 20px; right: 20px; padding: 15px 20px; border-radius: 4px; color: white; font-weight: 500; z-index: 9999; max-width: 400px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';

	if (type === 'success' || type === 'info') {
		notification.style.backgroundColor = '#00a32a';
	} else {
		notification.style.backgroundColor = '#d63638';
	}

	document.body.appendChild(notification);

	setTimeout(function () {
		if (notification.parentNode) {
			notification.parentNode.removeChild(notification);
		}
	}, 5000);
}

/**
 * Show an inline message in a container element.
 *
 * @param {HTMLElement} container Message container element.
 * @param {string}      message   The message to display.
 * @param {string}      type      Message type (success, error, info).
 * @param {string}      cssPrefix CSS class prefix (e.g. 'fair-audience-signup').
 */
export function showMessage(container, message, type, cssPrefix) {
	if (!container) {
		return;
	}

	container.textContent = message;
	container.className =
		cssPrefix + '-message ' + cssPrefix + '-message-' + type;
	container.style.display = 'block';

	// Hide after 8 seconds (except for success which should stay visible).
	if (type !== 'success') {
		setTimeout(function () {
			container.style.display = 'none';
		}, 8000);
	}
}

/**
 * Set a button to loading state.
 *
 * @param {HTMLElement} button      The button element.
 * @param {string}      loadingText Text to show while loading.
 * @return {Function} Restore function to call when done.
 */
export function setButtonLoading(button, loadingText) {
	const originalText = button.textContent;
	button.disabled = true;
	button.textContent = loadingText || __('Submitting...', 'fair-audience');

	return function restore() {
		button.disabled = false;
		button.textContent = originalText;
	};
}

/**
 * Defensive DOM ready pattern.
 *
 * @param {Function} initFunction Function to call when DOM is ready.
 */
export function onDomReady(initFunction) {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initFunction);
	} else {
		initFunction();
	}
}
