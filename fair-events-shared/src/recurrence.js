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

const MAX_PREVIEW_OCCURRENCES = 100;

function pad2(n) {
	return String(n).padStart(2, '0');
}

function toDateStr(date) {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate()
	)}`;
}

function parseRawRRule(rrule) {
	const result = { freq: null, interval: 1, count: null, until: null };
	if (!rrule) return result;

	rrule.split(';').forEach((part) => {
		const [key, value] = part.split('=');
		if (!key || value === undefined) return;

		switch (key.toUpperCase()) {
			case 'FREQ':
				result.freq = value.toUpperCase();
				break;
			case 'INTERVAL':
				result.interval = parseInt(value, 10) || 1;
				break;
			case 'COUNT':
				result.count = parseInt(value, 10);
				break;
			case 'UNTIL': {
				const y = value.substring(0, 4);
				const m = value.substring(4, 6);
				const d = value.substring(6, 8);
				// Mirror RecurrenceService::parse_ical_date(): a bare Ymd
				// UNTIL means end-of-day, else a same-day occurrence with a
				// later time-of-day would be excluded.
				result.until = new Date(`${y}-${m}-${d}T23:59:59`);
				break;
			}
		}
	});

	return result;
}

function addInterval(date, freq, interval) {
	const next = new Date(date);
	switch (freq) {
		case 'DAILY':
			next.setDate(next.getDate() + interval);
			break;
		case 'WEEKLY':
			next.setDate(next.getDate() + interval * 7);
			break;
		case 'MONTHLY':
			next.setMonth(next.getMonth() + interval);
			break;
	}
	return next;
}

/**
 * Expand an RRULE into a preview of its occurrence dates, for display before
 * saving. Mirrors `RecurrenceService::generate_occurrences()` in PHP
 * (daily/weekly/monthly + INTERVAL + COUNT/UNTIL — the only rule vocabulary
 * this editor supports) but only needs start dates, not full occurrence
 * objects, and is capped the same way the server caps generation.
 *
 * @param {string} rrule         RRULE string.
 * @param {string} startDatetime Naive "Y-m-d H:i:s" (or "Y-m-d") start of the first occurrence.
 * @param {number} limit         Number of leading dates to return in full.
 * @return {{dates: string[], totalCount: number, remainingCount: number, lastDate: string|null}} Preview summary.
 */
export function expandRRulePreview(rrule, startDatetime, limit = 4) {
	const parsed = parseRawRRule(rrule);

	if (!parsed.freq || !startDatetime) {
		return { dates: [], totalCount: 0, remainingCount: 0, lastDate: null };
	}

	const start = new Date(startDatetime.replace(' ', 'T'));
	const maxCount = parsed.count
		? Math.min(parsed.count, MAX_PREVIEW_OCCURRENCES)
		: MAX_PREVIEW_OCCURRENCES;

	const allDates = [];
	let current = start;
	let count = 0;

	while (count < maxCount) {
		if (parsed.until && current > parsed.until) {
			break;
		}
		count++;
		allDates.push(toDateStr(current));
		current = addInterval(current, parsed.freq, parsed.interval);
	}

	return {
		dates: allDates.slice(0, limit),
		totalCount: allDates.length,
		remainingCount: Math.max(0, allDates.length - limit),
		lastDate: allDates.length ? allDates[allDates.length - 1] : null,
	};
}
