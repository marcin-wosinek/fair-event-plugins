/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { formatSiteLocalDatetime } from 'fair-events-shared';

export const LIST_URL = 'admin.php?page=fair-finance-settlements';

/**
 * Stable address of one settlement.
 *
 * @param {number} id Settlement ID.
 * @return {string} Admin URL.
 */
export const settlementUrl = ( id ) => `${ LIST_URL }&settlement=${ id }`;

/**
 * Show an exact amount with its currency. The stored decimal string is shown
 * as it is, so nothing is rounded on the way to the screen.
 *
 * @param {string|null} amount   Decimal string, or null when unknown.
 * @param {string|null} currency Currency code.
 * @return {string} Amount, or "Unknown".
 */
export const formatMoney = ( amount, currency ) => {
	if ( amount === null || amount === undefined ) {
		return __( 'Unknown', 'fair-finance' );
	}
	return currency ? `${ amount } ${ currency }` : amount;
};

/**
 * Show an amount of Mollie's settlement report at the precision Mollie
 * supplied. An amount Mollie did not send and one that could not be read are
 * named as such, so neither is mistaken for zero.
 *
 * @param {Object|null} amount Report amount as `{ value, currency, state }`.
 * @return {string} Amount, or what is known about its absence.
 */
export const formatReportAmount = ( amount ) => {
	if ( amount?.state === 'provided' ) {
		return formatMoney( amount.value, amount.currency );
	}
	return amount?.state === 'invalid'
		? __( 'Could not read amount', 'fair-finance' )
		: __( 'Not provided by Mollie', 'fair-finance' );
};

/**
 * Show a percentage rate of Mollie's settlement report as supplied.
 *
 * @param {Object|null} rate Rate as `{ value, state }`.
 * @return {string} Rate, or what is known about its absence.
 */
export const formatReportRate = ( rate ) => {
	if ( rate?.state === 'provided' ) {
		/* translators: %s: percentage rate as a decimal number, such as 1.8 */
		return sprintf( __( '%s%%', 'fair-finance' ), rate.value );
	}
	return rate?.state === 'invalid'
		? __( 'Could not read rate', 'fair-finance' )
		: __( 'Not provided by Mollie', 'fair-finance' );
};

/**
 * Name a report period.
 *
 * @param {Object} period Period with `year` and `month`.
 * @return {string} Period, such as "2026-05".
 */
export const periodLabel = ( period ) =>
	period.year && period.month
		? sprintf(
				/* translators: 1: four-digit year, 2: two-digit month */
				__( 'Period %1$s-%2$s', 'fair-finance' ),
				period.year,
				period.month
		  )
		: __( 'Period not stated', 'fair-finance' );

/**
 * Show a site-local datetime, or a fallback when there is none.
 *
 * @param {string|null} datetime Naive site-local datetime.
 * @param {string}      fallback Text when there is no value.
 * @return {string} Formatted datetime.
 */
export const formatDatetime = ( datetime, fallback = '' ) =>
	datetime ? formatSiteLocalDatetime( datetime ) : fallback;

/**
 * Name of a movement type.
 *
 * @param {string} type Movement type.
 * @return {string} Label.
 */
export const typeLabel = ( type ) => {
	switch ( type ) {
		case 'payment':
			return __( 'Payment', 'fair-finance' );
		case 'capture':
			return __( 'Capture', 'fair-finance' );
		case 'refund':
			return __( 'Refund', 'fair-finance' );
		case 'chargeback':
			return __( 'Chargeback', 'fair-finance' );
		case 'fee':
			return __( 'Fees', 'fair-finance' );
		case 'adjustment':
			return __( 'Adjustment', 'fair-finance' );
		case 'summary':
			return __( 'Revenue summary', 'fair-finance' );
		default:
			return __( 'Not recognized', 'fair-finance' );
	}
};

/**
 * Where a settlement or movement came from.
 *
 * @param {string[]} sources `api` and/or `csv`.
 * @return {string} Label.
 */
export const sourcesLabel = ( sources = [] ) => {
	const fromApi = sources.includes( 'api' );
	const fromCsv = sources.includes( 'csv' );
	if ( fromApi && fromCsv ) {
		return __( 'Mollie API and file', 'fair-finance' );
	}
	if ( fromApi ) {
		return __( 'Mollie API', 'fair-finance' );
	}
	if ( fromCsv ) {
		return __( 'File', 'fair-finance' );
	}
	return __( 'Not loaded yet', 'fair-finance' );
};

/**
 * How far the saved data can be relied on.
 *
 * @param {string} completeness `incomplete`, `unverified` or `verified`.
 * @return {{label: string, tone: string}} Badge text and tone.
 */
export const completenessBadge = ( completeness ) => {
	switch ( completeness ) {
		case 'verified':
			return {
				label: __( 'Adds up to payout', 'fair-finance' ),
				tone: 'good',
			};
		case 'unverified':
			return {
				label: __( 'Loaded, not verified', 'fair-finance' ),
				tone: 'neutral',
			};
		default:
			return {
				label: __( 'Incomplete', 'fair-finance' ),
				tone: 'warning',
			};
	}
};

/**
 * Name a settlement for a heading or link.
 *
 * @param {Object} settlement Settlement.
 * @return {string} Reference, Mollie ID, or a fallback.
 */
export const settlementName = ( settlement ) =>
	settlement.reference ||
	settlement.provider_id ||
	__( '(no reference)', 'fair-finance' );

/**
 * Check that a value is an ID Mollie issues, so it is safe inside an address.
 *
 * @param {*}      id     Value to check.
 * @param {string} prefix What the ID has to start with, such as `tr_`.
 * @return {boolean} Whether the value is such an ID.
 */
const isMollieId = ( id, prefix ) =>
	typeof id === 'string' &&
	id.startsWith( prefix ) &&
	/^[A-Za-z0-9]+$/.test( id.slice( prefix.length ) );

/**
 * Address of a payment in the Mollie dashboard. The organization is the one
 * the settlement was saved under, which may not be the one connected now;
 * without it Mollie looks the payment up in whichever organization is open.
 *
 * @param {string|null} organizationId Mollie organization of the settlement.
 * @param {string|null} paymentId      Mollie payment ID, such as `tr_abc`.
 * @return {string|null} URL, or null when this is not a payment ID.
 */
export const molliePaymentUrl = ( organizationId, paymentId ) => {
	if ( ! isMollieId( paymentId, 'tr_' ) ) {
		return null;
	}
	return isMollieId( organizationId, 'org_' )
		? `https://my.mollie.com/dashboard/${ encodeURIComponent(
				organizationId
		  ) }/payments/${ encodeURIComponent( paymentId ) }`
		: `https://www.mollie.com/dashboard/payments/${ encodeURIComponent(
				paymentId
		  ) }`;
};

/**
 * Where the Mollie dashboard shows a settlement. Mollie has no page per
 * settlement, so this is the settlements report of the organization the
 * settlement was saved under; without that organization there is no address.
 *
 * @param {string|null} organizationId Mollie organization of the settlement.
 * @param {string|null} settlementId   Mollie settlement ID, such as `stl_abc`.
 * @return {string|null} URL, or null when either ID is missing or malformed.
 */
export const mollieSettlementUrl = ( organizationId, settlementId ) =>
	isMollieId( settlementId, 'stl_' ) && isMollieId( organizationId, 'org_' )
		? `https://my.mollie.com/dashboard/${ encodeURIComponent(
				organizationId
		  ) }/reports/settlements`
		: null;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Add up the Settled values of movement rows, per currency. The stored decimal
 * strings are summed as integers, so no amount passes through a float.
 *
 * @param {Object[]} movements Movement rows.
 * @return {{totals: Array<{currency: string, amount: string}>, unknown: number}}
 *         One total per currency in order of first appearance, and how many
 *         rows had no usable amount or currency and were left out.
 */
export const settledTotals = ( movements ) => {
	const sums = new Map();
	let unknown = 0;

	movements.forEach( ( movement ) => {
		const currency = movement.settlement_currency;
		const match =
			typeof movement.settlement_amount === 'string'
				? DECIMAL.exec( movement.settlement_amount )
				: null;
		if ( ! currency || ! match ) {
			unknown++;
			return;
		}

		const [ , sign, whole, fraction = '' ] = match;
		const sum = sums.get( currency ) || { units: BigInt( 0 ), scale: 0 };
		const scale = Math.max( sum.scale, fraction.length );
		const units = BigInt( whole + fraction.padEnd( scale, '0' ) );

		sums.set( currency, {
			units:
				sum.units * BigInt( `1${ '0'.repeat( scale - sum.scale ) }` ) +
				( sign ? -units : units ),
			scale,
		} );
	} );

	return {
		totals: [ ...sums ].map( ( [ currency, { units, scale } ] ) => {
			const negative = units < BigInt( 0 );
			const digits = ( negative ? -units : units )
				.toString()
				.padStart( scale + 1, '0' );
			const whole = digits.slice( 0, digits.length - scale );
			const amount = scale
				? `${ whole }.${ digits.slice( -scale ) }`
				: whole;

			return { currency, amount: negative ? `-${ amount }` : amount };
		} ),
		unknown,
	};
};

/**
 * Words for an import request that failed: the server's explanation when it
 * gave one.
 *
 * @param {Object} error `{ phase, message }` from the import hook.
 * @return {string} Message.
 */
export const importErrorText = ( error ) => {
	if ( error.message ) {
		return error.message;
	}

	switch ( error.phase ) {
		case 'start':
			return __( 'The import could not be started.', 'fair-finance' );
		case 'refresh':
			return __(
				'The status of the import could not be read. Try again in a moment.',
				'fair-finance'
			);
		default:
			return __(
				'The import could not continue. Its last known state is shown below.',
				'fair-finance'
			);
	}
};
