/**
 * Formatting for the Payment history page.
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';
import {
	formatMoney,
	formatTimingStart,
	getEventDisplayTitle,
} from 'fair-events-shared';

/**
 * An amount in its currency, or a dash when unknown. Never shows a missing
 * amount as zero.
 *
 * @param {number|null|undefined} amount   Amount.
 * @param {string}                currency Currency code.
 * @return {string} Formatted amount.
 */
export function formatAmount( amount, currency ) {
	if ( amount === null || amount === undefined || amount === '' ) {
		return '—';
	}
	return formatMoney( Number( amount ), currency || '' );
}

/**
 * Event title and start, e.g. "Salsa night, 12 March 2026 20:00".
 *
 * @param {Object|null} eventDate title, start_date, start_time, all_day.
 * @return {string} Label.
 */
export function formatEventDate( eventDate ) {
	if ( ! eventDate ) {
		return __( 'No event date', 'fair-events' );
	}
	const title = getEventDisplayTitle( eventDate.title );
	const start = formatTimingStart( eventDate );
	return start
		? sprintf(
				/* translators: 1: event title, 2: event start date and time */
				__( '%1$s, %2$s', 'fair-events' ),
				title,
				start
			)
		: title;
}

/**
 * A UTC timestamp from the database in the site's date and time format and
 * timezone.
 *
 * @param {string|null} utc "Y-m-d H:i:s" in UTC.
 * @return {string} Formatted date and time.
 */
export function formatUtcDateTime( utc ) {
	if ( ! utc ) {
		return '—';
	}
	const { formats } = getSettings();
	return dateI18n( formats.datetime, `${ utc.replace( ' ', 'T' ) }Z` );
}

/**
 * A purchase as an organizer recognizes it.
 *
 * @param {Object|null} purchase Purchase summary.
 * @return {string} Label.
 */
export function formatPurchase( purchase ) {
	if ( ! purchase ) {
		return __( 'Purchase no longer exists', 'fair-events' );
	}
	const name = purchase.name || __( '(no name)', 'fair-events' );
	return purchase.email
		? sprintf(
				/* translators: 1: purchase number, 2: purchaser name, 3: purchaser email */
				__( 'Purchase #%1$d — %2$s (%3$s)', 'fair-events' ),
				purchase.id,
				name,
				purchase.email
			)
		: sprintf(
				/* translators: 1: purchase number, 2: purchaser name */
				__( 'Purchase #%1$d — %2$s', 'fair-events' ),
				purchase.id,
				name
			);
}

/**
 * Cents of an amount, for exact sums.
 *
 * @param {number|string} amount Amount.
 * @return {number} Cents.
 */
export function toCents( amount ) {
	const value = Number( amount );
	return Number.isFinite( value ) ? Math.round( value * 100 ) : NaN;
}
