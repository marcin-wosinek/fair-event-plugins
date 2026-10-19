/**
 * Translated summaries and checks for an event date's canonical timing:
 * site-local dates with independently optional times (#1819, #1851).
 *
 * The formatted pieces come from fair-events-shared; the wording lives here
 * so it is extracted into the fair-events catalog. Only supplied times are
 * shown, an end-only time is labelled as the end, and a missing time is
 * never shown as midnight or as "all day".
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { formatTimingParts } from 'fair-events-shared/src/dateTime.js';

/**
 * Summarize an event date's timing, e.g. "October 18, 2026, 10:00 am –
 * 12:00 pm", "October 18, 2026, ends 12:00 pm" or "October 18, 2026".
 *
 * @param {Object|null|undefined} timing Object with `start_date`, `end_date`, `start_time`, `end_time` and `all_day`.
 * @return {string} Summary, or '' for an undated timing.
 */
export function formatEventTiming( timing ) {
	const parts = formatTimingParts( timing );
	if ( ! parts ) {
		return '';
	}
	const { startDate, endDate, startTime, endTime } = parts;

	if ( startTime && endTime ) {
		return endDate
			? sprintf(
					/* translators: 1: start date, 2: start time, 3: end date, 4: end time */
					__( '%1$s %2$s – %3$s %4$s', 'fair-events' ),
					startDate,
					startTime,
					endDate,
					endTime
				)
			: sprintf(
					/* translators: 1: date, 2: start time, 3: end time */
					__( '%1$s, %2$s – %3$s', 'fair-events' ),
					startDate,
					startTime,
					endTime
				);
	}

	if ( startTime ) {
		return endDate
			? sprintf(
					/* translators: 1: start date, 2: start time, 3: end date */
					__( '%1$s %2$s – %3$s', 'fair-events' ),
					startDate,
					startTime,
					endDate
				)
			: sprintf(
					/* translators: 1: date, 2: start time */
					__( '%1$s, %2$s', 'fair-events' ),
					startDate,
					startTime
				);
	}

	if ( endTime ) {
		return endDate
			? sprintf(
					/* translators: 1: start date, 2: end date, 3: end time. The event has no start time. */
					__( '%1$s – ends %2$s %3$s', 'fair-events' ),
					startDate,
					endDate,
					endTime
				)
			: sprintf(
					/* translators: 1: date, 2: end time. The event has no start time. */
					__( '%1$s, ends %2$s', 'fair-events' ),
					startDate,
					endTime
				);
	}

	return endDate
		? sprintf(
				/* translators: 1: start date, 2: end date */
				__( '%1$s – %2$s', 'fair-events' ),
				startDate,
				endDate
			)
		: startDate;
}

/**
 * Whether a timing can be added to calendars: explicitly all-day, or with
 * both a start and an end time. Mirrors EventTiming::is_calendar_exportable().
 *
 * @param {Object|null|undefined} timing Canonical timing.
 * @return {boolean} Whether calendar export is available.
 */
export function isCalendarExportable( timing ) {
	if ( ! timing?.start_date ) {
		return false;
	}
	return !! timing.all_day || ( !! timing.start_time && !! timing.end_time );
}

/**
 * Explain why an editor's timing cannot be saved, or null when it can.
 * Missing times never take part in the ordering check: times are compared
 * only when both are supplied and the event ends on its start date.
 *
 * @param {Object}  fields                Editor values (`HH:MM` times, '' when empty).
 * @param {string}  fields.startDate      Start date (Y-m-d) or ''.
 * @param {string}  fields.endDate        End date (Y-m-d) or ''.
 * @param {string}  fields.startTime      Start time or ''.
 * @param {string}  fields.endTime        End time or ''.
 * @param {boolean} fields.allDay         Whether the event is all day.
 * @param {Object}  [options]
 * @param {boolean} [options.requireDate] Whether the event must have a date.
 * @return {string|null} Translated error, or null.
 */
export function getTimingError(
	{ startDate, endDate, startTime, endTime, allDay },
	{ requireDate = false } = {}
) {
	if ( ! startDate ) {
		if ( requireDate ) {
			return __( 'Enter a start date.', 'fair-events' );
		}
		if ( endDate || ( ! allDay && ( startTime || endTime ) ) ) {
			return __(
				'Enter a start date, or clear the end date and times.',
				'fair-events'
			);
		}
		return null;
	}

	if ( endDate && endDate < startDate ) {
		return __( 'The end date is before the start date.', 'fair-events' );
	}

	if (
		! allDay &&
		startTime &&
		endTime &&
		( ! endDate || endDate === startDate ) &&
		endTime < startTime
	) {
		return __(
			'The end time is before the start time on the same day.',
			'fair-events'
		);
	}

	return null;
}
