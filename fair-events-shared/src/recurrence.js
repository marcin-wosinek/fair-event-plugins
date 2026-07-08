/**
 * Shared RRULE parsing/building helpers for the recurrence editor.
 *
 * The frequency vocabulary here (daily/weekly/biweekly/monthly ↔
 * FREQ/INTERVAL) is mirrored in PHP by
 * `RecurrenceService::build_rrule()` in fair-events — keep both in sync.
 */

import { __ } from '@wordpress/i18n';

export const RECURRENCE_FREQUENCIES = [
	{ label: __('Daily', 'fair-events'), value: 'daily' },
	{ label: __('Weekly', 'fair-events'), value: 'weekly' },
	{ label: __('Biweekly', 'fair-events'), value: 'biweekly' },
	{ label: __('Monthly', 'fair-events'), value: 'monthly' },
];

export const RECURRENCE_END_TYPES = [
	{ label: __('After number of occurrences', 'fair-events'), value: 'count' },
	{ label: __('On a specific date', 'fair-events'), value: 'until' },
];

/**
 * Parse an RRULE string into the app-level recurrence shape.
 *
 * @param {string} rrule RRULE string (e.g. "FREQ=WEEKLY;COUNT=10").
 * @return {{frequency: string, endType: string, count: number, until: string}} Parsed recurrence fields.
 */
export function parseRRule(rrule) {
	const parts = {};
	rrule.split(';').forEach((part) => {
		const [key, val] = part.split('=');
		parts[key] = val;
	});

	const freq = parts.FREQ || 'WEEKLY';
	const interval = parseInt(parts.INTERVAL || '1', 10);

	let frequency = 'weekly';
	if (freq === 'DAILY') {
		frequency = 'daily';
	} else if (freq === 'WEEKLY' && interval === 2) {
		frequency = 'biweekly';
	} else if (freq === 'WEEKLY') {
		frequency = 'weekly';
	} else if (freq === 'MONTHLY') {
		frequency = 'monthly';
	}

	let endType = 'count';
	let count = 10;
	let until = '';

	if (parts.COUNT) {
		endType = 'count';
		count = parseInt(parts.COUNT, 10);
	} else if (parts.UNTIL) {
		endType = 'until';
		const u = parts.UNTIL;
		until = `${u.substring(0, 4)}-${u.substring(4, 6)}-${u.substring(
			6,
			8
		)}`;
	}

	return { frequency, endType, count, until };
}

/**
 * Build an RRULE string from the app-level recurrence shape.
 *
 * @param {Object}  recurrence
 * @param {boolean} recurrence.enabled   Whether recurrence is enabled.
 * @param {string}  recurrence.frequency 'daily' | 'weekly' | 'biweekly' | 'monthly'.
 * @param {string}  recurrence.endType   'count' | 'until'.
 * @param {number}  recurrence.count     Number of occurrences (when endType is 'count').
 * @param {string}  recurrence.until     End date, Y-m-d (when endType is 'until').
 * @return {string|null} RRULE string, or null when recurrence is disabled.
 */
export function buildRRule({ enabled, frequency, endType, count, until }) {
	if (!enabled) return null;

	let freq = 'WEEKLY';
	let interval = 1;

	switch (frequency) {
		case 'daily':
			freq = 'DAILY';
			break;
		case 'weekly':
			freq = 'WEEKLY';
			break;
		case 'biweekly':
			freq = 'WEEKLY';
			interval = 2;
			break;
		case 'monthly':
			freq = 'MONTHLY';
			break;
	}

	const ruleParts = [`FREQ=${freq}`];
	if (interval > 1) {
		ruleParts.push(`INTERVAL=${interval}`);
	}
	if (endType === 'count' && count) {
		ruleParts.push(`COUNT=${count}`);
	} else if (endType === 'until' && until) {
		ruleParts.push(`UNTIL=${until.replace(/-/g, '')}`);
	}

	return ruleParts.join(';');
}
