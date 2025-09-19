/**
 * Test suite for LengthOptions class
 */
import { LengthOptions } from '../src/models/LengthOptions.js';

// Mock WordPress i18n function
jest.mock('@wordpress/i18n', () => ({
	__: (text) => text, // Return the text as-is for testing
}));

describe('LengthOptions.formatLengthLabel', () => {
	test('should format whole hours correctly', () => {
		expect(LengthOptions.formatLengthLabel(1)).toBe('1 hours');
		expect(LengthOptions.formatLengthLabel(2)).toBe('2 hours');
		expect(LengthOptions.formatLengthLabel(8)).toBe('8 hours');
		expect(LengthOptions.formatLengthLabel(12)).toBe('12 hours');
	});

	test('should format minutes only correctly', () => {
		expect(LengthOptions.formatLengthLabel(0.5)).toBe('30 minutes');
		expect(LengthOptions.formatLengthLabel(0.25)).toBe('15 minutes');
		expect(LengthOptions.formatLengthLabel(0.75)).toBe('45 minutes');
		expect(LengthOptions.formatLengthLabel(0.1)).toBe('6 minutes');
	});

	test('should format hours and minutes correctly', () => {
		expect(LengthOptions.formatLengthLabel(1.5)).toBe(
			'1 hours, 30 minutes'
		);
		expect(LengthOptions.formatLengthLabel(2.25)).toBe(
			'2 hours, 15 minutes'
		);
		expect(LengthOptions.formatLengthLabel(3.75)).toBe(
			'3 hours, 45 minutes'
		);
		expect(LengthOptions.formatLengthLabel(8.5)).toBe(
			'8 hours, 30 minutes'
		);
	});

	test('should handle edge cases', () => {
		expect(LengthOptions.formatLengthLabel(0)).toBe('0 hours');
		expect(LengthOptions.formatLengthLabel(24)).toBe('24 hours');
	});

	test('should round minutes correctly', () => {
		// Test rounding behavior for fractional minutes
		expect(LengthOptions.formatLengthLabel(1.083333)).toBe(
			'1 hours, 5 minutes'
		); // 1 hour 5 minutes (1/12 hour)
		expect(LengthOptions.formatLengthLabel(2.166667)).toBe(
			'2 hours, 10 minutes'
		); // 2 hours 10 minutes (1/6 hour)
		expect(LengthOptions.formatLengthLabel(0.083333)).toBe('5 minutes'); // 5 minutes (1/12 hour)
	});

	test('should handle decimal precision correctly', () => {
		// Common decimal values
		expect(LengthOptions.formatLengthLabel(1.25)).toBe(
			'1 hours, 15 minutes'
		);
		expect(LengthOptions.formatLengthLabel(2.75)).toBe(
			'2 hours, 45 minutes'
		);
		expect(LengthOptions.formatLengthLabel(0.333333)).toBe('20 minutes');
		expect(LengthOptions.formatLengthLabel(0.666667)).toBe('40 minutes');
	});

	test('should handle very small values', () => {
		expect(LengthOptions.formatLengthLabel(0.01)).toBe('1 minutes'); // Rounds to 1 minute
		expect(LengthOptions.formatLengthLabel(0.005)).toBe('0 hours'); // Rounds to 0 minutes
	});

	test('should handle large values', () => {
		expect(LengthOptions.formatLengthLabel(48)).toBe('48 hours');
		expect(LengthOptions.formatLengthLabel(48.5)).toBe(
			'48 hours, 30 minutes'
		);
	});

	test('should be consistent with common WordPress time slots', () => {
		// Common time slot durations
		expect(LengthOptions.formatLengthLabel(0.5)).toBe('30 minutes');
		expect(LengthOptions.formatLengthLabel(1)).toBe('1 hours');
		expect(LengthOptions.formatLengthLabel(1.5)).toBe(
			'1 hours, 30 minutes'
		);
		expect(LengthOptions.formatLengthLabel(2)).toBe('2 hours');
		expect(LengthOptions.formatLengthLabel(2.5)).toBe(
			'2 hours, 30 minutes'
		);
		expect(LengthOptions.formatLengthLabel(3)).toBe('3 hours');
		expect(LengthOptions.formatLengthLabel(3.5)).toBe(
			'3 hours, 30 minutes'
		);
		expect(LengthOptions.formatLengthLabel(4)).toBe('4 hours');
	});
});

describe('LengthOptions', () => {
	describe('constructor and getLengthOptions', () => {
		test('should generate options for basic time slot values', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);
			const expected = [
				{ label: '30 minutes', value: 0.5 },
				{ label: '1 hours', value: 1 },
				{ label: '1 hours, 30 minutes', value: 1.5 },
			];

			expect(lengthOptions.getLengthOptions()).toEqual(expected);
		});

		test('should generate options for timetable length values', () => {
			const values = [4, 5, 6, 8];
			const lengthOptions = new LengthOptions(values);
			const expected = [
				{ label: '4 hours', value: 4 },
				{ label: '5 hours', value: 5 },
				{ label: '6 hours', value: 6 },
				{ label: '8 hours', value: 8 },
			];

			expect(lengthOptions.getLengthOptions()).toEqual(expected);
		});

		test('should handle mixed hour and minute values', () => {
			const values = [0.25, 0.5, 1, 2.5, 4];
			const lengthOptions = new LengthOptions(values);
			const expected = [
				{ label: '15 minutes', value: 0.25 },
				{ label: '30 minutes', value: 0.5 },
				{ label: '1 hours', value: 1 },
				{ label: '2 hours, 30 minutes', value: 2.5 },
				{ label: '4 hours', value: 4 },
			];

			expect(lengthOptions.getLengthOptions()).toEqual(expected);
		});

		test('should handle empty array', () => {
			const lengthOptions = new LengthOptions([]);
			expect(lengthOptions.getLengthOptions()).toEqual([]);
		});

		test('should handle single value', () => {
			const values = [1.5];
			const lengthOptions = new LengthOptions(values);
			const expected = [{ label: '1 hours, 30 minutes', value: 1.5 }];

			expect(lengthOptions.getLengthOptions()).toEqual(expected);
		});

		test('should preserve original value precision', () => {
			const values = [0.333333, 0.666667];
			const lengthOptions = new LengthOptions(values);
			const result = lengthOptions.getLengthOptions();

			// Check that values are preserved exactly
			expect(result[0].value).toBe(0.333333);
			expect(result[1].value).toBe(0.666667);

			// Check that labels are formatted correctly
			expect(result[0].label).toBe('20 minutes');
			expect(result[1].label).toBe('40 minutes');
		});

		test('should handle edge cases', () => {
			const values = [0, 24, 0.01];
			const lengthOptions = new LengthOptions(values);
			const expected = [
				{ label: '0 hours', value: 0 },
				{ label: '24 hours', value: 24 },
				{ label: '1 minutes', value: 0.01 },
			];

			expect(lengthOptions.getLengthOptions()).toEqual(expected);
		});

		test('should match time-slot EditComponent base options', () => {
			// Values from time-slot EditComponent
			const values = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
			const lengthOptions = new LengthOptions(values);
			const result = lengthOptions.getLengthOptions();

			expect(result).toHaveLength(8);
			expect(result[0]).toEqual({ label: '30 minutes', value: 0.5 });
			expect(result[1]).toEqual({ label: '1 hours', value: 1 });
			expect(result[2]).toEqual({
				label: '1 hours, 30 minutes',
				value: 1.5,
			});
			expect(result[7]).toEqual({ label: '4 hours', value: 4 });
		});

		test('should match timetable EditComponent base options', () => {
			// Values that would be generated by timetable component (4-16h)
			const values = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
			const lengthOptions = new LengthOptions(values);
			const result = lengthOptions.getLengthOptions();

			expect(result).toHaveLength(13);
			expect(result[0]).toEqual({ label: '4 hours', value: 4 });
			expect(result[12]).toEqual({ label: '16 hours', value: 16 });

			// All should be whole hour labels
			result.forEach((option) => {
				expect(option.label).toMatch(/^\d+ hours$/);
			});
		});
	});

	describe('multiple calls to getLengthOptions', () => {
		test('should return consistent results on multiple calls', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			const result1 = lengthOptions.getLengthOptions();
			const result2 = lengthOptions.getLengthOptions();

			expect(result1).toEqual(result2);
		});
	});

	describe('setValue and custom value handling', () => {
		test('should add custom value when not in predefined list', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			// Set a custom value not in the list
			lengthOptions.setValue(2.25);
			const result = lengthOptions.getLengthOptions();

			expect(result).toHaveLength(4);
			expect(result[3]).toEqual({ label: '2 hours, 15 minutes', value: 2.25 });

			// Should be sorted by value
			expect(result.map(opt => opt.value)).toEqual([0.5, 1, 1.5, 2.25]);
		});

		test('should not add duplicate when value exists in predefined list', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			// Set a value that exists in the list
			lengthOptions.setValue(1);
			const result = lengthOptions.getLengthOptions();

			expect(result).toHaveLength(3);
			expect(result.map(opt => opt.value)).toEqual([0.5, 1, 1.5]);
		});

		test('should handle 0.01 tolerance for floating point comparison', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			// Set a value very close to an existing one (within 0.01 tolerance)
			lengthOptions.setValue(1.005);
			const result = lengthOptions.getLengthOptions();

			// Should not add duplicate due to 0.01 tolerance
			expect(result).toHaveLength(3);
		});

		test('should not add custom value if it is zero or negative', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			lengthOptions.setValue(0);
			let result = lengthOptions.getLengthOptions();
			expect(result).toHaveLength(3);

			lengthOptions.setValue(-1);
			result = lengthOptions.getLengthOptions();
			expect(result).toHaveLength(3);
		});

		test('should maintain sorted order when adding custom values', () => {
			const values = [1, 3, 4];
			const lengthOptions = new LengthOptions(values);

			// Add a custom value in the middle
			lengthOptions.setValue(2.5);
			const result = lengthOptions.getLengthOptions();

			expect(result.map(opt => opt.value)).toEqual([1, 2.5, 3, 4]);
		});
	});

	describe('hasMatchingValue', () => {
		test('should return false when no value is selected', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			expect(lengthOptions.hasMatchingValue()).toBe(false);
		});

		test('should return true when selected value matches predefined value within tolerance', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			lengthOptions.setValue(1.005); // Within 0.01 tolerance of 1
			expect(lengthOptions.hasMatchingValue()).toBe(true);
		});

		test('should return false when selected value is outside tolerance', () => {
			const values = [0.5, 1, 1.5];
			const lengthOptions = new LengthOptions(values);

			lengthOptions.setValue(1.02); // Outside 0.01 tolerance
			expect(lengthOptions.hasMatchingValue()).toBe(false);
		});
	});
});
