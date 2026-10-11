/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

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
		return __( 'Mollie and file', 'fair-finance' );
	}
	if ( fromApi ) {
		return __( 'Mollie', 'fair-finance' );
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
