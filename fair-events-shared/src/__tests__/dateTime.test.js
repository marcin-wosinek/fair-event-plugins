/**
 * Tests for formatDateOnly/formatMonthLabel (#1115).
 *
 * Each style is asserted against the literal `toLocaleDateString(undefined,
 * ...)` expression it replaces (rather than a hardcoded locale string), so
 * the "output unchanged" regression guard holds regardless of which locale
 * the environment's ICU resolves `undefined` to.
 */
import { formatDateOnly, formatMonthLabel } from '../dateTime.js';

describe('formatDateOnly', () => {
	test('long style matches EditInstancesModal/MiniCalendar', () => {
		expect(formatDateOnly('2026-07-08', 'long')).toBe(
			new Date('2026-07-08T00:00:00').toLocaleDateString(undefined, {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		);
	});

	test('medium style matches RecurrenceImpactSummary (the default)', () => {
		expect(formatDateOnly('2026-07-08')).toBe(
			new Date('2026-07-08T00:00:00').toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		);
	});

	test('short style matches SeriesModal/ManageEventApp', () => {
		expect(formatDateOnly('2026-07-08', 'short')).toBe(
			new Date('2026-07-08T00:00:00').toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			})
		);
	});

	test('numeric style matches fair-finance (no options bag)', () => {
		expect(formatDateOnly('2026-07-08', 'numeric')).toBe(
			new Date('2026-07-08T00:00:00').toLocaleDateString(undefined)
		);
	});

	test('accepts a Y-m-d H:i:s datetime string, ignoring the time', () => {
		expect(formatDateOnly('2026-07-08 18:00:00', 'long')).toBe(
			formatDateOnly('2026-07-08', 'long')
		);
	});

	test('accepts a Date object, matching MiniCalendar day cells', () => {
		const date = new Date(2026, 6, 8);
		expect(formatDateOnly(date, 'long')).toBe(
			date.toLocaleDateString(undefined, {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			})
		);
	});

	test('returns an empty string for empty/null/undefined values', () => {
		expect(formatDateOnly('')).toBe('');
		expect(formatDateOnly(null)).toBe('');
		expect(formatDateOnly(undefined)).toBe('');
	});
});

describe('formatMonthLabel', () => {
	test('matches the CalendarHeader/MiniCalendar month header', () => {
		const date = new Date(2026, 6, 1);
		expect(formatMonthLabel(date)).toBe(
			date.toLocaleDateString(undefined, {
				month: 'long',
				year: 'numeric',
			})
		);
	});

	test('accepts a Y-m-d string', () => {
		expect(formatMonthLabel('2026-07-08')).toBe(
			formatMonthLabel(new Date(2026, 6, 8))
		);
	});

	test('returns an empty string for empty/null/undefined values', () => {
		expect(formatMonthLabel('')).toBe('');
		expect(formatMonthLabel(null)).toBe('');
		expect(formatMonthLabel(undefined)).toBe('');
	});
});
