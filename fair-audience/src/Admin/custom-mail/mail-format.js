/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';

/**
 * Format a history timestamp in the site's timezone and date format.
 *
 * `created_at` is written by the database in UTC; marking it as such keeps
 * `dateI18n` from reading it as browser-local time.
 *
 * @param {string} createdAt 'YYYY-MM-DD HH:MM:SS' in UTC.
 * @return {string} Formatted date, or a dash when missing.
 */
export function formatSentAt( createdAt ) {
	if ( ! createdAt ) {
		return '—';
	}
	const { formats } = getSettings();
	return dateI18n( formats.datetime, `${ createdAt.replace( ' ', 'T' ) }Z` );
}

/**
 * A recorded message's subject, or a placeholder when it had none.
 *
 * @param {Object} mail History record.
 * @return {string} Subject.
 */
export function subjectOf( mail ) {
	return mail.subject || __( '(no subject)', 'fair-audience' );
}

/**
 * Who a recorded message was addressed to.
 *
 * The event title comes from the current event, not a copy saved with the
 * message.
 *
 * @param {Object} mail History record.
 * @return {string} Event title or a fallback.
 */
export function audienceOf( mail ) {
	if ( ! mail.event_date_id && ! mail.event_id ) {
		return __( 'All audience', 'fair-audience' );
	}
	return mail.event_title || __( '(deleted event)', 'fair-audience' );
}
