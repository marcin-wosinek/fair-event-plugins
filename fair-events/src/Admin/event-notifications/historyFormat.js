/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';

/**
 * Internal dependencies
 */
import { TYPE_LABELS } from './shared.js';

/**
 * Wording of the notification history, shared by the list, both history
 * views and the execution details so they never disagree.
 *
 * "Accepted" means the mail system or the Telegram API took the message
 * over. Neither confirms that anyone received it, so no label says
 * "delivered".
 */
export const OUTCOME_LABELS = {
	success: __( 'Accepted', 'fair-events' ),
	partial: __( 'Partly accepted', 'fair-events' ),
	failure: __( 'Failed', 'fair-events' ),
	skipped: __( 'Skipped', 'fair-events' ),
	unknown: __( 'Outcome unknown', 'fair-events' ),
};

export const DELIVERY_OUTCOME_LABELS = {
	accepted: __( 'Accepted by the provider', 'fair-events' ),
	failed: __( 'Failed', 'fair-events' ),
	skipped: __( 'Skipped', 'fair-events' ),
	unknown: __( 'Outcome unknown', 'fair-events' ),
};

// Colors of StatusText, by execution or delivery outcome.
export const OUTCOME_STATES = {
	success: 'sent',
	accepted: 'sent',
	partial: 'partial',
	unknown: 'uncertain',
	failure: 'failed',
	failed: 'failed',
};

export const ORIGIN_LABELS = {
	scheduled: __( 'Scheduled', 'fair-events' ),
	test: __( 'Test', 'fair-events' ),
};

export const LIFECYCLE_LABELS = {
	running: __( 'Running', 'fair-events' ),
	completed: __( 'Finished', 'fair-events' ),
	abandoned: __( 'Stopped before it finished', 'fair-events' ),
};

export const REASON_LABELS = {
	no_events: __( 'There were no events that week.', 'fair-events' ),
	expired: __( 'The week ended before it could be sent.', 'fair-events' ),
	suspended: __( 'The notification was paused.', 'fair-events' ),
	configuration_error: __(
		'The settings could not be used, for example a missing event feed or bot token.',
		'fair-events'
	),
	no_recipients: __( 'Nobody was eligible to receive it.', 'fair-events' ),
	interrupted: __(
		'Sending stopped before the outcome was recorded.',
		'fair-events'
	),
	internal_error: __(
		'An error on this site stopped the send.',
		'fair-events'
	),
	send_failed: __( 'The mail system refused the message.', 'fair-events' ),
	not_sendable: __( 'The address could not be sent to.', 'fair-events' ),
	not_eligible: __(
		'Not eligible, for example without consent to marketing emails.',
		'fair-events'
	),
	previous_part_not_sent: __(
		'An earlier part of the message was not sent.',
		'fair-events'
	),
	legacy_unmatched: __(
		'Recorded before this history existed; the details were not kept.',
		'fair-events'
	),
};

/**
 * A reason code as a sentence. An unknown code is shown as it is, so it
 * can still be looked up.
 *
 * @param {string} code Safe reason code.
 * @return {string} Reason, or an empty string without one.
 */
export function reasonLabel( code ) {
	if ( ! code ) {
		return '';
	}
	return (
		REASON_LABELS[ code ] ||
		sprintf(
			/* translators: %s: reason code recorded with a notification send */
			__( 'Reason code: %s', 'fair-events' ),
			code
		)
	);
}

/**
 * An execution's outcome; a running one has none yet.
 *
 * @param {Object} execution Execution payload.
 * @return {string} Label.
 */
export function outcomeLabel( execution ) {
	if ( ! execution.outcome ) {
		return LIFECYCLE_LABELS[ execution.lifecycle ] || execution.lifecycle;
	}
	return OUTCOME_LABELS[ execution.outcome ] || execution.outcome;
}

/**
 * Delivery counts in the unit they were counted in. A count that was not
 * recorded stays unknown instead of becoming zero.
 *
 * @param {Object} counts Execution `counts`.
 * @return {string} Sentence.
 */
export function countsText( counts ) {
	const values = [ 'accepted', 'failed', 'skipped', 'unknown' ];
	if ( values.every( ( key ) => null === counts[ key ] ) ) {
		return __( 'The number of messages was not recorded.', 'fair-events' );
	}
	const shown = ( key ) =>
		null === counts[ key ]
			? __( 'not recorded', 'fair-events' )
			: counts[ key ];
	const [ accepted, failed, skipped, unknown ] = values.map( shown );

	switch ( counts.unit ) {
		case 'message_parts':
			return sprintf(
				/* translators: 1: accepted count, 2: failed count, 3: skipped count, 4: unknown count */
				__(
					'Message parts: %1$s accepted, %2$s failed, %3$s skipped, %4$s unknown.',
					'fair-events'
				),
				accepted,
				failed,
				skipped,
				unknown
			);
		case 'recipients':
			return sprintf(
				/* translators: 1: accepted count, 2: failed count, 3: skipped count, 4: unknown count */
				__(
					'Recipients: %1$s accepted, %2$s failed, %3$s skipped, %4$s unknown.',
					'fair-events'
				),
				accepted,
				failed,
				skipped,
				unknown
			);
		case 'destinations':
			return sprintf(
				/* translators: 1: accepted count, 2: failed count, 3: skipped count, 4: unknown count */
				__(
					'Chats: %1$s accepted, %2$s failed, %3$s skipped, %4$s unknown.',
					'fair-events'
				),
				accepted,
				failed,
				skipped,
				unknown
			);
		default:
			return sprintf(
				/* translators: 1: accepted count, 2: failed count, 3: skipped count, 4: unknown count */
				__(
					'%1$s accepted, %2$s failed, %3$s skipped, %4$s unknown.',
					'fair-events'
				),
				accepted,
				failed,
				skipped,
				unknown
			);
	}
}

/**
 * The number of executions as a sentence.
 *
 * @param {number} total Matching executions.
 * @return {string} Sentence.
 */
export function totalText( total ) {
	return sprintf(
		/* translators: %d: number of notification sends and tests */
		_n( '%d entry.', '%d entries.', total, 'fair-events' ),
		total
	);
}

/**
 * A UTC time from the history in the site's timezone and format.
 *
 * @param {string|null} value RFC 3339 UTC time.
 * @return {string} Formatted time, or a dash without one.
 */
export function formatTime( value ) {
	if ( ! value ) {
		return '—';
	}
	return dateI18n( getSettings().formats.datetime, value );
}

/**
 * Offset of a timezone from UTC at a moment, in milliseconds.
 *
 * @param {number} time     Unix time in milliseconds.
 * @param {string} timeZone IANA timezone.
 * @return {number} Offset.
 */
function zoneOffset( time, timeZone ) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat( 'en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		} )
			.formatToParts( new Date( time ) )
			.map( ( part ) => [ part.type, part.value ] )
	);
	const wall = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	return wall - Math.floor( time / 1000 ) * 1000;
}

/**
 * The UTC instant a site-local day starts, for a history date filter.
 *
 * The site's offset is taken on that day, so a filter around a daylight
 * saving change still starts at local midnight. A site set to a fixed UTC
 * offset instead of a city uses that offset.
 *
 * @param {string} day      Local date, 'YYYY-MM-DD'.
 * @param {Object} timezone `timezone` of the site's date settings.
 * @param {number} addDays  Days to move forward, e.g. 1 for the end of `day`.
 * @return {string|null} RFC 3339 UTC time, or null for an invalid date.
 */
export function dayStartUtc( day, timezone, addDays = 0 ) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec( day || '' );
	if ( ! match ) {
		return null;
	}
	const wall = Date.UTC(
		Number( match[ 1 ] ),
		Number( match[ 2 ] ) - 1,
		Number( match[ 3 ] ) + addDays
	);
	let time = wall - Number( timezone?.offset || 0 ) * 3600000;
	if ( timezone?.string ) {
		try {
			// Twice: the offset at the first guess may differ from the
			// offset at local midnight across a change.
			time = wall - zoneOffset( time, timezone.string );
			time = wall - zoneOffset( time, timezone.string );
		} catch {
			// An unknown timezone name keeps the numeric offset.
		}
	}
	return new Date( time ).toISOString().replace( /\.\d{3}Z$/, 'Z' );
}

/**
 * The name an execution is shown by: its name when it ran, else the
 * notification's current name, else its kind.
 *
 * @param {Object} execution      Execution payload.
 * @param {Array}  configurations Configurations shown on the page.
 * @return {string} Name.
 */
export function executionName( execution, configurations ) {
	const current = configurations.find(
		( shown ) => shown.id === execution.configuration.id
	);
	return (
		execution.configuration.name ||
		current?.name ||
		TYPE_LABELS[ execution.channel ] ||
		execution.channel
	);
}
