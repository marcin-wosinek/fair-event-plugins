import apiFetch from '@wordpress/api-fetch';
import { extractErrorMessage, setButtonLoading } from './form-utils.js';

/**
 * Shared payment-integration lifecycle for blocks that create Mollie payments.
 *
 * Any block that creates a payment goes through the same three phases:
 * initiate (POST + redirect to checkout), callback (poll the canonical status
 * endpoint after the buyer returns), and restart (reset for a failed/expired
 * attempt). This module owns that lifecycle so blocks only describe their
 * inputs and presentation.
 *
 * @package FairEventsShared
 */

const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 3000;

/**
 * Create a payment via a public REST endpoint and redirect to its checkout URL.
 *
 * @param {Object}        args                     Options.
 * @param {string}        args.apiPath             Hardcoded REST path to POST to.
 * @param {Object}        args.data                Request body.
 * @param {HTMLElement}   [args.button]             Submit button to put into a loading state while the request is in flight.
 * @param {string}        [args.loadingText]        Text shown on the button while loading (passed to setButtonLoading).
 * @param {string}        [args.defaultErrorMessage] Fallback error message when the API error has none.
 * @param {Function}      [args.onError]            Called with (message, error) when the request fails.
 * @return {Promise<Object>} Resolves with the API response. On a `checkout_url` response the browser is redirected before the promise resolves.
 */
export async function initiatePayment({
	apiPath,
	data,
	button,
	loadingText,
	defaultErrorMessage,
	onError,
}) {
	const restoreButton = button ? setButtonLoading(button, loadingText) : null;

	try {
		const response = await apiFetch({
			path: apiPath,
			method: 'POST',
			data,
		});

		if (response && response.checkout_url) {
			window.location.href = response.checkout_url;
			return response;
		}

		if (restoreButton) {
			restoreButton();
		}

		return response;
	} catch (error) {
		if (restoreButton) {
			restoreButton();
		}
		if (onError) {
			onError(extractErrorMessage(error, defaultErrorMessage), error);
		}
		throw error;
	}
}

/**
 * Poll a REST path until the response's `lifecycle_status` reaches a
 * terminal state (`confirmed`/`failed`), or `maxAttempts` is reached.
 *
 * Generic over the endpoint shape: any route that returns a
 * `lifecycle_status` of `confirmed`/`failed`/`processing` can be polled this
 * way, not just the connector's own status endpoint — callers that need more
 * than the three-way split (e.g. a resume/retry distinction) read the extra
 * fields off the same response passed to `onProcessing`.
 *
 * @param {Object}   args                Options.
 * @param {string}   args.path           Full REST path to poll (including any query string) — rebuilt fresh on every tick, so a caller can vary it per attempt if needed.
 * @param {Function} [args.onConfirmed]  Called with the response once `lifecycle_status` is `confirmed`.
 * @param {Function} [args.onFailed]     Called with the response once `lifecycle_status` is `failed`.
 * @param {Function} [args.onProcessing] Called with the response on each poll while still in progress.
 * @param {number}   [args.maxAttempts]  Stop polling after this many ticks.
 * @param {number}   [args.intervalMs]   Delay between ticks.
 */
export function pollPaymentStatus({
	path,
	onConfirmed,
	onFailed,
	onProcessing,
	maxAttempts = MAX_ATTEMPTS,
	intervalMs = POLL_INTERVAL_MS,
}) {
	poll(0);

	function poll(attempt) {
		if (attempt >= maxAttempts) {
			return;
		}

		apiFetch({ path })
			.then(function (response) {
				if (response.lifecycle_status === 'confirmed') {
					if (onConfirmed) {
						onConfirmed(response);
					}
					return;
				}

				if (response.lifecycle_status === 'failed') {
					if (onFailed) {
						onFailed(response);
					}
					return;
				}

				if (onProcessing) {
					onProcessing(response);
				}

				setTimeout(function () {
					poll(attempt + 1);
				}, intervalMs);
			})
			.catch(function () {
				// Ignore polling errors — stop polling silently.
			});
	}
}

/**
 * Detect a return from the payment gateway and poll the canonical status
 * endpoint until the transaction reaches a terminal state.
 *
 * No-ops unless `fair_payment_callback=true` is present in the URL and a
 * transaction id is available (either passed in or read from the
 * `transaction_id` URL parameter).
 *
 * @param {Object}   args                Options.
 * @param {string}   args.statusPath     Hardcoded REST base path for the status resource (e.g. `/fair-payments-connector/v1/payments`). Polled at `${statusPath}/${transactionId}/status`.
 * @param {string}   [args.transactionId] Transaction id. Falls back to the `transaction_id` URL parameter.
 * @param {string}   [args.token]        Per-transaction access token. Falls back to the `token` URL parameter.
 * @param {Function} [args.onConfirmed]  Called with the status response once `lifecycle_status` is `confirmed`.
 * @param {Function} [args.onFailed]     Called with the status response once `lifecycle_status` is `failed`.
 * @param {Function} [args.onProcessing] Called with the status response on each poll while still `processing`.
 */
export function handlePaymentCallback({
	statusPath,
	transactionId,
	token,
	onConfirmed,
	onFailed,
	onProcessing,
}) {
	const params = new URLSearchParams(window.location.search);
	if (params.get('fair_payment_callback') !== 'true') {
		return;
	}

	const resolvedTransactionId = transactionId || params.get('transaction_id');
	const resolvedToken = token || params.get('token') || '';

	if (!resolvedTransactionId) {
		return;
	}

	const query = resolvedToken
		? `?token=${encodeURIComponent(resolvedToken)}`
		: '';

	pollPaymentStatus({
		path: `${statusPath}/${resolvedTransactionId}/status${query}`,
		onConfirmed,
		onFailed,
		onProcessing,
	});
}

/**
 * Render a sanitized payment-creation error into a message container.
 *
 * Always shows the generic message from `error`/`defaultMessage` (via
 * `extractErrorMessage`), matching plain error rendering elsewhere. When the
 * REST error additionally carries `error.data.admin` (only present for a
 * capability-checked admin — see `PaymentGatewayError::to_wp_error()` in the
 * connector), it appends the interpreted cause and fix-it links below the
 * message; both cause and link labels arrive already-translated from PHP, so
 * no client-side string-building is needed. Adds (never replaces) CSS
 * classes, so callers that re-query the container by its original class
 * (e.g. `.fair-payments-connector-error`) keep finding it on retry.
 *
 * @param {HTMLElement|null} container    Message container element. No-op when null.
 * @param {Object}           error        Error object from apiFetch (or any error with a `.data.admin` shape).
 * @param {string}           defaultMessage Fallback message when the error has none.
 * @param {string}           cssPrefix    CSS class prefix (e.g. 'fair-payments-connector').
 */
export function renderPaymentError(
	container,
	error,
	defaultMessage,
	cssPrefix
) {
	if (!container) {
		return;
	}

	const message = extractErrorMessage(error, defaultMessage);
	const admin = error && error.data && error.data.admin;

	container.classList.add(
		cssPrefix + '-message',
		cssPrefix + '-message-error'
	);
	container.textContent = '';
	container.style.display = 'block';

	const messageEl = document.createElement('p');
	messageEl.className = cssPrefix + '-message-text';
	messageEl.textContent = message;
	container.appendChild(messageEl);

	if (admin && admin.cause) {
		const causeEl = document.createElement('p');
		causeEl.className = cssPrefix + '-message-admin-cause';
		causeEl.textContent = admin.cause;
		container.appendChild(causeEl);
	}

	if (admin && Array.isArray(admin.links) && admin.links.length > 0) {
		const list = document.createElement('ul');
		list.className = cssPrefix + '-message-admin-links';
		admin.links.forEach(function (link) {
			const item = document.createElement('li');
			const anchor = document.createElement('a');
			anchor.href = link.url;
			anchor.textContent = link.label;
			anchor.target = '_blank';
			anchor.rel = 'noopener noreferrer';
			item.appendChild(anchor);
			list.appendChild(item);
		});
		container.appendChild(list);
	}

	// Auto-hide like plain error messages elsewhere, but only when there is no
	// admin guidance to read — an admin following the links needs more than a
	// few seconds before the container disappears under them.
	if (!admin) {
		setTimeout(function () {
			container.style.display = 'none';
		}, 8000);
	}
}

/**
 * Wire a "try again" button that clears the callback URL params and restores
 * the form to a fresh state so the buyer can start a new payment attempt.
 *
 * @param {HTMLElement|null}                  args.button  The restart button. No-op when null.
 * @param {HTMLFormElement|HTMLElement} [args.form]  Element to reveal again. `reset()` is called on it when available.
 * @param {Function}                    [args.onReset] Called after the URL/form have been reset.
 */
export function wireRestartButton({ button, form, onReset }) {
	if (!button) {
		return;
	}

	button.addEventListener('click', function () {
		const url = new URL(window.location.href);
		url.searchParams.delete('fair_payment_callback');
		url.searchParams.delete('transaction_id');
		url.searchParams.delete('token');
		window.history.replaceState({}, '', url.toString());

		if (form) {
			if (typeof form.reset === 'function') {
				form.reset();
			}
			form.style.display = '';
		}

		if (onReset) {
			onReset();
		}
	});
}
