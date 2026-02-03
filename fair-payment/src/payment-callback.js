/**
 * Payment Callback Handler
 *
 * Handles payment callback from Mollie and shows transaction status notification.
 *
 * @package FairPayment
 */

import apiFetch from '@wordpress/api-fetch';
import './payment-callback.css';

( function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', initializeCallback );
	} else {
		initializeCallback();
	}

	function initializeCallback() {
		// Get transaction_id from URL parameters
		const urlParams = new URLSearchParams( window.location.search );
		const transactionId = urlParams.get( 'transaction_id' );

		if ( ! transactionId ) {
			console.error( 'Fair Payment: No transaction_id found in URL' );
			return;
		}

		// Fetch transaction status from API
		fetchTransactionStatus( transactionId );
	}

	/**
	 * Fetch transaction status from REST API
	 *
	 * @param {string} transactionId Transaction ID
	 */
	function fetchTransactionStatus( transactionId ) {
		apiFetch( {
			path: `/fair-payment/v1/payments/${ transactionId }/status`,
			method: 'GET',
		} )
			.then( ( response ) => {
				showNotification( response );
			} )
			.catch( ( error ) => {
				console.error(
					'Fair Payment: Failed to fetch transaction status',
					error
				);
				showErrorNotification( error );
			} );
	}

	/**
	 * Show notification based on transaction status
	 *
	 * @param {Object} transaction Transaction data
	 */
	function showNotification( transaction ) {
		const status = transaction.status;
		let message = '';
		let type = 'info';

		switch ( status ) {
			case 'paid':
			case 'completed':
				message = `Thank you! Your payment of ${ transaction.amount } ${ transaction.currency } has been successfully processed.`;
				type = 'success';
				break;

			case 'pending_payment':
			case 'pending':
				message = `Your payment of ${ transaction.amount } ${ transaction.currency } is being processed. You will receive a confirmation shortly.`;
				type = 'info';
				break;

			case 'failed':
			case 'expired':
			case 'canceled':
				message = `Your payment of ${ transaction.amount } ${ transaction.currency } was not completed. Please try again.`;
				type = 'error';
				break;

			case 'draft':
				message = `Your payment is still being initialized. Please wait...`;
				type = 'info';
				break;

			default:
				message = `Payment status: ${ status }`;
				type = 'info';
				break;
		}

		// Add testmode indicator
		if ( transaction.testmode ) {
			message += ' (Test Mode)';
		}

		displayNotification( message, type );
	}

	/**
	 * Show error notification
	 *
	 * @param {Error} error Error object
	 */
	function showErrorNotification( error ) {
		const message =
			error.message ||
			'Failed to retrieve payment status. Please contact support.';
		displayNotification( message, 'error' );
	}

	/**
	 * Display notification to user
	 *
	 * @param {string} message Notification message
	 * @param {string} type Notification type (success, error, info)
	 */
	function displayNotification( message, type ) {
		// Create notification element
		const notification = document.createElement( 'div' );
		notification.className = `fair-payment-notification fair-payment-notification--${ type }`;
		notification.setAttribute( 'role', 'alert' );
		notification.setAttribute( 'aria-live', 'polite' );

		// Create message content
		const messageElement = document.createElement( 'p' );
		messageElement.textContent = message;
		notification.appendChild( messageElement );

		// Create dismiss button
		const dismissButton = document.createElement( 'button' );
		dismissButton.textContent = '×';
		dismissButton.className = 'fair-payment-notification__dismiss';
		dismissButton.setAttribute( 'aria-label', 'Dismiss notification' );
		dismissButton.addEventListener( 'click', () => {
			notification.remove();
		} );
		notification.appendChild( dismissButton );

		// Insert at the top of the page
		const body = document.querySelector( 'body' );
		body.insertBefore( notification, body.firstChild );

		// Auto-dismiss after 10 seconds for success/info messages
		if ( type === 'success' || type === 'info' ) {
			setTimeout( () => {
				if ( notification.parentNode ) {
					notification.classList.add(
						'fair-payment-notification--fade-out'
					);
					setTimeout( () => notification.remove(), 500 );
				}
			}, 10000 );
		}
	}
} )();
