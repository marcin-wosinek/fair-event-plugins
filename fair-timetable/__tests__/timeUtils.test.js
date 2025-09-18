/**
 * Test suite for timeUtils functions
 */
import { parseTime } from '../src/utils/timeUtils.js';

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
});
