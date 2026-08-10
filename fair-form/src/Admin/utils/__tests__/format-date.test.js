import { formatDate, formatDateLong } from '../format-date.js';

describe('formatDateLong', () => {
	it('returns an empty string for empty/undefined input', () => {
		expect(formatDateLong('')).toBe('');
		expect(formatDateLong(undefined)).toBe('');
	});

	it('formats a stored UTC datetime as a long, human-readable date', () => {
		const result = formatDateLong('2026-07-31 18:19:00');

		// Assert structurally rather than locale-exact: Jest's default locale
		// may not match the site's, but day/year must be present and the time
		// must be minute-precision (no seconds).
		expect(result).toContain('2026');
		expect(result).toContain('31');
		expect(result).not.toMatch(/\d{2}:\d{2}:\d{2}/);
	});
});

describe('formatDate', () => {
	it('returns an empty string for empty/undefined input', () => {
		expect(formatDate('')).toBe('');
		expect(formatDate(undefined)).toBe('');
	});
});
