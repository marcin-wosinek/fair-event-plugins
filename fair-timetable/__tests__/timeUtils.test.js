/**
 * Test suite for timeUtils functions
 */
import { parseTime, formatTime } from '../src/utils/timeUtils.js';

describe('timeUtils', () => {
	describe('parseTime', () => {
		test('should parse valid time strings correctly', () => {
			const testCases = [
				{ input: '00:00', expected: 0 },
				{ input: '00:15', expected: 0.25 },
				{ input: '00:30', expected: 0.5 },
				{ input: '00:45', expected: 0.75 },
				{ input: '01:00', expected: 1 },
				{ input: '09:30', expected: 9.5 },
				{ input: '12:15', expected: 12.25 },
				{ input: '23:59', expected: 23.983333333333334 },
			];

			testCases.forEach(({ input, expected }) => {
				expect(parseTime(input)).toBeCloseTo(expected, 5);
			});
		});

		test('should handle midnight correctly', () => {
			expect(parseTime('00:00')).toBe(0);
			expect(parseTime('24:00')).toBe(0); // Invalid, should return 0
		});

		test('should handle edge cases with minutes', () => {
			expect(parseTime('12:01')).toBeCloseTo(12.016666666666667, 5);
			expect(parseTime('12:59')).toBeCloseTo(12.983333333333334, 5);
		});

		test('should return 0 for invalid time formats', () => {
			const invalidFormats = [
				'invalid',
				'25:00', // Invalid hour
				'12:60', // Invalid minute
				'12',
				'12:',
				':30',
				'24:00', // Invalid hour
				'12:99', // Invalid minute
				'-1:30', // Negative hour
				'12:-5', // Negative minute
			];

			invalidFormats.forEach((invalidTime) => {
				expect(parseTime(invalidTime)).toBe(0);
			});
		});

		test('should return 0 for null, undefined, and empty inputs', () => {
			expect(parseTime(null)).toBe(0);
			expect(parseTime(undefined)).toBe(0);
			expect(parseTime('')).toBe(0);
		});

		test('should return 0 for non-string inputs', () => {
			expect(parseTime(123)).toBe(0);
			expect(parseTime({})).toBe(0);
			expect(parseTime([])).toBe(0);
			expect(parseTime(true)).toBe(0);
		});

		test('should handle malformed strings gracefully', () => {
			const malformedStrings = [
				'abc:def',
				'12:ab',
				'ab:30',
				'12:30:45', // Too many parts
				'12.30', // Wrong separator
				'12-30', // Wrong separator
				'12 30', // Space separator
			];

			malformedStrings.forEach((malformed) => {
				expect(parseTime(malformed)).toBe(0);
			});
		});

		test('should handle boundary values', () => {
			// Valid boundary cases
			expect(parseTime('00:00')).toBe(0);
			expect(parseTime('23:59')).toBeCloseTo(23.983333333333334, 5);

			// Invalid boundary cases
			expect(parseTime('24:00')).toBe(0);
			expect(parseTime('23:60')).toBe(0);
		});

		test('should be consistent with HourlyRange test expectations', () => {
			// These test cases should match the expectations from HourlyRange tests
			expect(parseTime('09:30')).toBe(9.5);
			expect(parseTime('12:15')).toBe(12.25);
			expect(parseTime('23:59')).toBeCloseTo(23.983333333333334, 5);
			expect(parseTime('00:15')).toBe(0.25);
			expect(parseTime('00:45')).toBe(0.75);
		});

		test('should handle leading zeros correctly', () => {
			expect(parseTime('09:05')).toBe(9.083333333333334);
			expect(parseTime('01:01')).toBeCloseTo(1.016666666666667, 5);
			expect(parseTime('00:01')).toBeCloseTo(0.016666666666666666, 5);
		});

		test('should accept flexible time formats that date-fns parses', () => {
			// date-fns accepts these formats, though they're not strictly HH:mm
			expect(parseTime('1:30')).toBe(1.5); // Parsed as 01:30
			expect(parseTime('12:5')).toBeCloseTo(12.083333333333334, 5); // Parsed as 12:05
		});

		test('should maintain precision for fractional minutes', () => {
			// Test cases that verify minute-to-decimal conversion precision
			expect(parseTime('01:01')).toBeCloseTo(1 + 1 / 60, 10);
			expect(parseTime('01:30')).toBe(1.5);
			expect(parseTime('01:45')).toBe(1.75);
			expect(parseTime('01:15')).toBe(1.25);
		});
	});

	describe('formatTime', () => {
		test('should format valid decimal hours correctly', () => {
			const testCases = [
				{ input: 0, expected: '00:00' },
				{ input: 0.25, expected: '00:15' },
				{ input: 0.5, expected: '00:30' },
				{ input: 0.75, expected: '00:45' },
				{ input: 1, expected: '01:00' },
				{ input: 9.5, expected: '09:30' },
				{ input: 12.25, expected: '12:15' },
				{ input: 23.983333333333334, expected: '23:59' },
			];

			testCases.forEach(({ input, expected }) => {
				expect(formatTime(input)).toBe(expected);
			});
		});

		test('should handle midnight correctly', () => {
			expect(formatTime(0)).toBe('00:00');
			expect(formatTime(24)).toBe('00:00'); // Overflow to next day
		});

		test('should handle 24-hour overflow', () => {
			expect(formatTime(25.5)).toBe('01:30'); // 25.5 hours = 1:30 next day
			expect(formatTime(48)).toBe('00:00'); // 48 hours = midnight 2 days later
			expect(formatTime(30.75)).toBe('06:45'); // 30.75 hours = 6:45 next day
		});

		test('should return 00:00 for invalid inputs', () => {
			const invalidInputs = [
				null,
				undefined,
				'invalid',
				{},
				[],
				true,
				-1,
				-5.5,
			];

			invalidInputs.forEach((invalidInput) => {
				expect(formatTime(invalidInput)).toBe('00:00');
			});
		});

		test('should handle edge cases with minutes', () => {
			expect(formatTime(12.016666666666667)).toBe('12:01');
			expect(formatTime(12.983333333333334)).toBe('12:59');
		});

		test('should round minutes correctly', () => {
			// Test cases that verify minute rounding
			expect(formatTime(1 + 1 / 60)).toBe('01:01'); // 1.016666... should round to 01
			expect(formatTime(1.5)).toBe('01:30');
			expect(formatTime(1.75)).toBe('01:45');
			expect(formatTime(1.25)).toBe('01:15');
		});

		test('should handle fractional seconds by rounding', () => {
			// When decimal hours result in fractional seconds, should round to nearest minute
			expect(formatTime(1.0083333)).toBe('01:00'); // ~30 seconds, rounds down to 0 minutes
			expect(formatTime(1.0166666)).toBe('01:01'); // Exactly 1 minute
		});

		test('should be consistent with parseTime (round-trip)', () => {
			const timeStrings = [
				'00:00',
				'00:15',
				'00:30',
				'00:45',
				'01:00',
				'09:30',
				'12:15',
				'23:59',
			];

			timeStrings.forEach((timeString) => {
				const parsed = parseTime(timeString);
				const formatted = formatTime(parsed);
				expect(formatted).toBe(timeString);
			});
		});

		test('should handle boundary values', () => {
			expect(formatTime(0)).toBe('00:00');
			expect(formatTime(23.999)).toBe('00:00'); // Very close to 24, rounds to 60 minutes -> next day
			expect(formatTime(23.99)).toBe('23:59'); // Should stay within the day
		});

		test('should maintain precision for common time values', () => {
			// Test common decimal hour values used in scheduling
			expect(formatTime(8.5)).toBe('08:30');
			expect(formatTime(9.25)).toBe('09:15');
			expect(formatTime(10.75)).toBe('10:45');
			expect(formatTime(17.5)).toBe('17:30');
		});
	});
});
