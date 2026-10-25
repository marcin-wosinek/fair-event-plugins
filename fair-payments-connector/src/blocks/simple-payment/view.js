/**
 * Frontend JavaScript for Simple Payment Block
 *
 * @package FairPaymentsConnector
 */

import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import {
	initiatePayment,
	handlePaymentCallback,
	renderPaymentError,
	wireRestartButton,
} from 'fair-events-shared/src/payment-flow.js';
import {
	credentialHeaders,
	isCredentialStorageAvailable,
	removeCredential,
	saveCredential,
} from '../../payment-credentials.js';

const STATUS_PATH = '/fair-payments-connector/v1/payments';

// Transaction this page returned for, read once from the callback URL.
function callbackTransactionId() {
	const params = new URLSearchParams( window.location.search );
	return params.get( 'fair_payment_callback' ) === 'true'
		? params.get( 'transaction_id' ) || ''
		: '';
}

( function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}

	function init() {
		const transactionId = callbackTransactionId();
		initPaymentButtons();
		initCallbackDismiss( transactionId );
		initRestart( transactionId );
		initCallbackPolling( transactionId );
	}

	function initPaymentButtons() {
		const buttons = document.querySelectorAll(
			'.fair-payments-connector-button'
		);

		buttons.forEach( function ( button ) {
			// Fetch a fresh nonce per button instance on page load so cached pages
			// don't embed a stale nonce in static HTML.
			const noncePromise = apiFetch( {
				path: '/fair-payments-connector/v1/nonce',
			} ).then( ( res ) => res.nonce );

			button.addEventListener( 'click', ( event ) =>
				handlePaymentClick( event, noncePromise )
			);
		} );
	}

	function initCallbackDismiss( transactionId ) {
		const buttons = document.querySelectorAll(
			'.fair-payments-connector-callback-dismiss'
		);

		buttons.forEach( function ( button ) {
			button.addEventListener( 'click', ( event ) =>
				handleCallbackDismiss( event, transactionId )
			);
		} );
	}

	function handleCallbackDismiss( event, transactionId ) {
		const button = event.currentTarget;
		const callback = button.closest( '.fair-payments-connector-callback' );

		if ( callback ) {
			callback.style.display = 'none';
		}

		// The buyer is done with this return page; a reload no longer needs it.
		removeCredential( transactionId );

		const url = new URL( window.location.href );
		url.searchParams.delete( 'fair_payment_callback' );
		url.searchParams.delete( 'transaction_id' );
		url.searchParams.delete( 'token' );
		window.history.replaceState( {}, '', url.toString() );
	}

	function initRestart( transactionId ) {
		const callbackEl = document.querySelector(
			'.fair-payments-connector-callback'
		);
		const restartButton = document.querySelector(
			'.fair-payments-connector-restart'
		);
		const paymentForm = document.querySelector(
			'.fair-payments-connector-payment-form'
		);

		wireRestartButton( {
			button: restartButton,
			form: paymentForm,
			onReset: () => {
				removeCredential( transactionId );
				if ( callbackEl ) {
					callbackEl.style.display = 'none';
				}
			},
		} );
	}

	function initCallbackPolling( transactionId ) {
		const callbackEl = document.querySelector(
			'.fair-payments-connector-callback'
		);
		if ( ! callbackEl || ! transactionId ) {
			return;
		}

		// Without a stored token the read still works for the signed-in owner
		// or an admin; anyone else gets a 404, shown as "can't verify" rather
		// than as a failed payment.
		handlePaymentCallback( {
			statusPath: STATUS_PATH,
			transactionId,
			headers: credentialHeaders( transactionId ),
			onConfirmed: () => updateCallbackState( callbackEl, 'confirmed' ),
			onFailed: () => updateCallbackState( callbackEl, 'failed' ),
			onError: () => updateCallbackState( callbackEl, 'unverified' ),
		} );
	}

	function updateCallbackState( callbackEl, status ) {
		callbackEl
			.querySelectorAll( '[data-status]' )
			.forEach( function ( el ) {
				el.style.display =
					el.getAttribute( 'data-status' ) === status
						? 'block'
						: 'none';
			} );

		const restartButton = callbackEl.querySelector(
			'.fair-payments-connector-restart'
		);
		const dismissButton = callbackEl.querySelector(
			'.fair-payments-connector-callback-dismiss'
		);

		if ( restartButton ) {
			restartButton.style.display =
				status === 'failed' ? 'block' : 'none';
		}
		if ( dismissButton ) {
			dismissButton.style.display =
				status === 'failed' ? 'none' : 'block';
		}
	}

	function handlePaymentClick( event, noncePromise ) {
		const button = event.target;
		const paymentBlock = button.closest( '.fair-payments-connector-block' );
		const loadingEl = paymentBlock.querySelector(
			'.fair-payments-connector-loading'
		);
		const errorEl = paymentBlock.querySelector(
			'.fair-payments-connector-error'
		);

		// Get payment data from button attributes
		const amount = button.getAttribute( 'data-amount' );
		const currency = button.getAttribute( 'data-currency' );
		const description = button.getAttribute( 'data-description' );
		const postId = button.getAttribute( 'data-post-id' );
		const blockId = button.getAttribute( 'data-block-id' );

		// Hide error, show loading
		if ( errorEl ) {
			errorEl.style.display = 'none';
		}

		// The return page proves who started the payment with a token kept in
		// session storage. Without it the buyer could pay but never see the
		// result, so refuse before creating anything.
		if ( ! isCredentialStorageAvailable() ) {
			if ( errorEl ) {
				errorEl.textContent = __(
					'Your browser is blocking site data, which is needed to confirm your payment when you return. Allow site data for this site and try again.',
					'fair-payments-connector'
				);
				errorEl.style.display = 'block';
			}
			return;
		}
		if ( loadingEl ) {
			loadingEl.style.display = 'block';
		}
		button.disabled = true;

		noncePromise
			.then( ( nonce ) =>
				initiatePayment( {
					apiPath: '/fair-payments-connector/v1/payments',
					data: {
						amount,
						currency,
						description,
						post_id: postId,
						block_id: blockId,
						nonce,
					},
					defaultErrorMessage: __(
						'Failed to create payment',
						'fair-payments-connector'
					),
					onBeforeRedirect: ( response ) =>
						saveCredential(
							response.transaction_id,
							response.access_token
						),
					onError: ( message, error ) => {
						renderPaymentError(
							errorEl,
							error,
							message,
							'fair-payments-connector'
						);
						if ( loadingEl ) {
							loadingEl.style.display = 'none';
						}
						button.disabled = false;
					},
				} )
			)
			.catch( () => {
				// Error already surfaced via onError.
			} );
	}
} )();
