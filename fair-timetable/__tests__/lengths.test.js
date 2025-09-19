/**
 * Test suite for length utilities
 */
import {
	formatLengthLabel,
	generateLengthOptions,
} from '../src/utils/lengths.js';

// Mock WordPress i18n function
jest.mock('@wordpress/i18n', () => ({
	__: (text) => text, // Return the text as-is for testing
}));

describe('formatLengthLabel', () => {
	test('should format whole hours correctly', () => {
		expect(formatLengthLabel(1)).toBe('1 hours');
		expect(formatLengthLabel(2)).toBe('2 hours');
		expect(formatLengthLabel(8)).toBe('8 hours');
		expect(formatLengthLabel(12)).toBe('12 hours');
	});

	test('should format minutes only correctly', () => {
		expect(formatLengthLabel(0.5)).toBe('30 minutes');
		expect(formatLengthLabel(0.25)).toBe('15 minutes');
		expect(formatLengthLabel(0.75)).toBe('45 minutes');
		expect(formatLengthLabel(0.1)).toBe('6 minutes');
	});

	test('should format hours and minutes correctly', () => {
		expect(formatLengthLabel(1.5)).toBe('1 hours, 30 minutes');
		expect(formatLengthLabel(2.25)).toBe('2 hours, 15 minutes');
		expect(formatLengthLabel(3.75)).toBe('3 hours, 45 minutes');
		expect(formatLengthLabel(8.5)).toBe('8 hours, 30 minutes');
	});

	test('should handle edge cases', () => {
		expect(formatLengthLabel(0)).toBe('0 hours');
		expect(formatLengthLabel(24)).toBe('24 hours');
	});

	test('should round minutes correctly', () => {
		// Test rounding behavior for fractional minutes
		expect(formatLengthLabel(1.083333)).toBe('1 hours, 5 minutes'); // 1 hour 5 minutes (1/12 hour)
		expect(formatLengthLabel(2.166667)).toBe('2 hours, 10 minutes'); // 2 hours 10 minutes (1/6 hour)
		expect(formatLengthLabel(0.083333)).toBe('5 minutes'); // 5 minutes (1/12 hour)
	});

	test('should handle decimal precision correctly', () => {
		// Common decimal values
		expect(formatLengthLabel(1.25)).toBe('1 hours, 15 minutes');
		expect(formatLengthLabel(2.75)).toBe('2 hours, 45 minutes');
		expect(formatLengthLabel(0.333333)).toBe('20 minutes');
		expect(formatLengthLabel(0.666667)).toBe('40 minutes');
	});

	test('should handle very small values', () => {
		expect(formatLengthLabel(0.01)).toBe('1 minutes'); // Rounds to 1 minute
		expect(formatLengthLabel(0.005)).toBe('0 hours'); // Rounds to 0 minutes
	});

	test('should handle large values', () => {
		expect(formatLengthLabel(48)).toBe('48 hours');
		expect(formatLengthLabel(48.5)).toBe('48 hours, 30 minutes');
	});

	test('should be consistent with common WordPress time slots', () => {
		// Common time slot durations
		expect(formatLengthLabel(0.5)).toBe('30 minutes');
		expect(formatLengthLabel(1)).toBe('1 hours');
		expect(formatLengthLabel(1.5)).toBe('1 hours, 30 minutes');
		expect(formatLengthLabel(2)).toBe('2 hours');
		expect(formatLengthLabel(2.5)).toBe('2 hours, 30 minutes');
		expect(formatLengthLabel(3)).toBe('3 hours');
		expect(formatLengthLabel(3.5)).toBe('3 hours, 30 minutes');
		expect(formatLengthLabel(4)).toBe('4 hours');
	});
});

describe('generateLengthOptions', () => {
	test('should generate options for basic time slot values', () => {
		const values = [0.5, 1, 1.5];
		const expected = [
			{ label: '30 minutes', value: 0.5 },
			{ label: '1 hours', value: 1 },
			{ label: '1 hours, 30 minutes', value: 1.5 },
		];

		expect(generateLengthOptions(values)).toEqual(expected);
	});

	test('should generate options for timetable length values', () => {
		const values = [4, 5, 6, 8];
		const expected = [
			{ label: '4 hours', value: 4 },
			{ label: '5 hours', value: 5 },
			{ label: '6 hours', value: 6 },
			{ label: '8 hours', value: 8 },
		];

		expect(generateLengthOptions(values)).toEqual(expected);
	});

	test('should handle mixed hour and minute values', () => {
		const values = [0.25, 0.5, 1, 2.5, 4];
		const expected = [
			{ label: '15 minutes', value: 0.25 },
			{ label: '30 minutes', value: 0.5 },
			{ label: '1 hours', value: 1 },
			{ label: '2 hours, 30 minutes', value: 2.5 },
			{ label: '4 hours', value: 4 },
		];

		expect(generateLengthOptions(values)).toEqual(expected);
	});

	test('should handle empty array', () => {
		expect(generateLengthOptions([])).toEqual([]);
	});

	test('should handle single value', () => {
		const values = [1.5];
		const expected = [{ label: '1 hours, 30 minutes', value: 1.5 }];

		expect(generateLengthOptions(values)).toEqual(expected);
	});

	test('should preserve original value precision', () => {
		const values = [0.333333, 0.666667];
		const result = generateLengthOptions(values);

		// Check that values are preserved exactly
		expect(result[0].value).toBe(0.333333);
		expect(result[1].value).toBe(0.666667);

		// Check that labels are formatted correctly
		expect(result[0].label).toBe('20 minutes');
		expect(result[1].label).toBe('40 minutes');
	});

	test('should handle edge cases', () => {
		const values = [0, 24, 0.01];
		const expected = [
			{ label: '0 hours', value: 0 },
			{ label: '24 hours', value: 24 },
			{ label: '1 minutes', value: 0.01 },
		];

		expect(generateLengthOptions(values)).toEqual(expected);
	});

	test('should match time-slot EditComponent base options', () => {
		// Values from time-slot EditComponent
		const values = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
		const result = generateLengthOptions(values);

		expect(result).toHaveLength(8);
		expect(result[0]).toEqual({ label: '30 minutes', value: 0.5 });
		expect(result[1]).toEqual({ label: '1 hours', value: 1 });
		expect(result[2]).toEqual({ label: '1 hours, 30 minutes', value: 1.5 });
		expect(result[7]).toEqual({ label: '4 hours', value: 4 });
	});

	test('should match timetable EditComponent base options', () => {
		// Values that would be generated by timetable component (4-16h)
		const values = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
		const result = generateLengthOptions(values);

		expect(result).toHaveLength(13);
		expect(result[0]).toEqual({ label: '4 hours', value: 4 });
		expect(result[12]).toEqual({ label: '16 hours', value: 16 });

		// All should be whole hour labels
		result.forEach((option) => {
			expect(option.label).toMatch(/^\d+ hours$/);
		});
	});
});
