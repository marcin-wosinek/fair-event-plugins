/**
 * Payment return notice
 *
 * Fallback notice for a buyer returning from Mollie to a page where no block
 * renders its own payment result. The Simple Payment and event signup blocks
 * report the return themselves, so the notice stays out of their way.
 *
 * The status read is authenticated with the access token the browser keeps in
 * session storage, sent in a request header (#858). Logged-in owners and
 * admins are authenticated by their session instead. Nothing here reads or
 * forwards a token from the URL.
 *
 * @package FairPaymentsConnector
 */

import { __, sprintf } from '@wordpress/i18n';
import { pollPaymentStatus } from 'fair-events-shared/src/payment-flow.js';
import { credentialHeaders } from './payment-credentials.js';
import './payment-callback.css';

const STATUS_PATH = '/fair-payments-connector/v1/payments';

// Rendered result surfaces of blocks that handle the return themselves.
const OWNING_SURFACES =
	'.fair-payments-connector-callback, .fair-events-get-tickets-callback';

const CLASS_NAME = 'fair-payments-connector-notification';

/**
 * Transaction id from a valid return marker.
 *
 * @return {string} Positive integer id, or '' when the URL is not a return.
 */
function returnTransactionId() {
	const params = new URLSearchParams( window.location.search );
	if ( params.get( 'fair_payment_callback' ) !== 'true' ) {
		return '';
	}
	const id = params.get( 'transaction_id' ) || '';
	return /^[1-9]\d*$/.test( id ) ? id : '';
}

/**
 * Format an amount in the page language, falling back to "12.50 EUR".
 *
 * @param {string|number} amount   Amount.
 * @param {string}        currency ISO 4217 code.
 * @return {string} Display amount.
 */
function formatAmount( amount, currency ) {
	const value = Number( amount );
	try {
		return new Intl.NumberFormat( document.documentElement.lang || [], {
			style: 'currency',
			currency,
		} ).format( value );
	} catch ( error ) {
		return `${ amount } ${ currency }`;
	}
}

/**
 * Notice text for the current model.
 *
 * @param {Object} model Notice model.
 * @return {string} Message.
 */
function messageFor( { phase, transaction } ) {
	const hasAmount =
		transaction &&
		transaction.currency &&
		Number.isFinite( Number( transaction.amount ) );
	const amount = hasAmount
		? formatAmount( transaction.amount, transaction.currency )
		: '';

	switch ( phase ) {
		case 'confirmed':
			return amount
				? sprintf(
						/* translators: %s: formatted amount, e.g. €12.50 */
						__(
							'Thank you! Your payment of %s has been received and confirmed.',
							'fair-payments-connector'
						),
						amount
					)
				: __(
						'Thank you! Your payment has been received and confirmed.',
						'fair-payments-connector'
					);
		case 'failed':
			return amount
				? sprintf(
						/* translators: %s: formatted amount, e.g. €12.50 */
						__(
							'Your payment of %s was not completed.',
							'fair-payments-connector'
						),
						amount
					)
				: __(
						'Your payment was not completed.',
						'fair-payments-connector'
					);
		case 'processing':
			return amount
				? sprintf(
						/* translators: %s: formatted amount, e.g. €12.50 */
						__(
							'Thank you! Your payment of %s is being processed.',
							'fair-payments-connector'
						),
						amount
					)
				: __(
						'Thank you! Your payment is being processed.',
						'fair-payments-connector'
					);
		case 'unverified':
			return __(
				'We couldn’t verify your payment status. If you completed the payment, check your email for a confirmation or contact the organizer.',
				'fair-payments-connector'
			);
		default:
			return __(
				'Checking your payment status…',
				'fair-payments-connector'
			);
	}
}

/**
 * Show the notice for a transaction and keep it in step with the status.
 *
 * @param {string} transactionId Transaction id.
 */
function startNotice( transactionId ) {
	const model = { phase: 'checking', transaction: null, dismissed: false };

	const notice = document.createElement( 'div' );
	notice.className = CLASS_NAME;
	notice.setAttribute( 'role', 'status' );

	const message = document.createElement( 'p' );
	message.className = `${ CLASS_NAME }__message`;
	notice.appendChild( message );

	const testMode = document.createElement( 'span' );
	testMode.className = `${ CLASS_NAME }__testmode`;
	testMode.textContent = __( 'Test mode', 'fair-payments-connector' );
	notice.appendChild( testMode );

	const dismiss = document.createElement( 'button' );
	dismiss.type = 'button';
	dismiss.className = `${ CLASS_NAME }__dismiss`;
	dismiss.setAttribute(
		'aria-label',
		__( 'Dismiss payment notice', 'fair-payments-connector' )
	);
	dismiss.textContent = '×';
	notice.appendChild( dismiss );

	let stopPolling = null;

	function render() {
		if ( model.dismissed ) {
			notice.remove();
			return;
		}
		notice.dataset.phase = model.phase;
		message.textContent = messageFor( model );
		testMode.hidden = ! (
			model.transaction &&
			model.transaction.testmode &&
			model.phase !== 'unverified'
		);
	}

	function update( phase, transaction ) {
		if ( model.dismissed ) {
			return;
		}
		model.phase = phase;
		model.transaction = transaction || model.transaction;
		render();
	}

	function isUsable( response ) {
		return !! response && typeof response.lifecycle_status === 'string';
	}

	dismiss.addEventListener( 'click', () => {
		model.dismissed = true;
		if ( stopPolling ) {
			stopPolling();
		}
		render();
	} );

	render();
	const container = document.querySelector( 'main' ) || document.body;
	container.insertBefore( notice, container.firstChild );

	stopPolling = pollPaymentStatus( {
		path: `${ STATUS_PATH }/${ transactionId }/status`,
		headers: credentialHeaders( transactionId ),
		onConfirmed: ( response ) => update( 'confirmed', response ),
		onFailed: ( response ) => update( 'failed', response ),
		onProcessing: ( response ) => {
			if ( ! isUsable( response ) ) {
				stopPolling();
				update( 'unverified', null );
				return;
			}
			update( 'processing', response );
		},
		onError: () => update( 'unverified', null ),
	} );
}

function init() {
	const transactionId = returnTransactionId();
	if ( ! transactionId || document.querySelector( OWNING_SURFACES ) ) {
		return;
	}
	startNotice( transactionId );
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
