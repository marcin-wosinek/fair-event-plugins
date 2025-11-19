/**
 * Test suite for DurationOptions class
 */
import { DurationOptions } from '../src/DurationOptions.js';

// Mock WordPress i18n function
jest.mock('@wordpress/i18n', () => ({
	__: (text) => text, // Return the text as-is for testing
}));

describe('DurationOptions.formatHoursLabel', () => {
	test('should format whole hours correctly', () => {
		expect(DurationOptions.formatHoursLabel(1)).toBe('1 hours');
		expect(DurationOptions.formatHoursLabel(2)).toBe('2 hours');
		expect(DurationOptions.formatHoursLabel(8)).toBe('8 hours');
		expect(DurationOptions.formatHoursLabel(12)).toBe('12 hours');
	});

	test('should format minutes only correctly', () => {
		expect(DurationOptions.formatHoursLabel(0.5)).toBe('30 minutes');
		expect(DurationOptions.formatHoursLabel(0.25)).toBe('15 minutes');
		expect(DurationOptions.formatHoursLabel(0.75)).toBe('45 minutes');
	});

	test('should format hours and minutes correctly', () => {
		expect(DurationOptions.formatHoursLabel(1.5)).toBe(
			'1 hours, 30 minutes'
		);
		expect(DurationOptions.formatHoursLabel(2.25)).toBe(
			'2 hours, 15 minutes'
		);
		expect(DurationOptions.formatHoursLabel(3.75)).toBe(
			'3 hours, 45 minutes'
		);
	});
});

describe('DurationOptions.formatMinutesLabel', () => {
	test('should format minutes only correctly', () => {
		expect(DurationOptions.formatMinutesLabel(30)).toBe('30 minutes');
		expect(DurationOptions.formatMinutesLabel(45)).toBe('45 minutes');
		expect(DurationOptions.formatMinutesLabel(90)).toBe(
			'1 hour 30 minutes'
		);
	});

	test('should format whole hours correctly', () => {
		expect(DurationOptions.formatMinutesLabel(60)).toBe('1 hour');
		expect(DurationOptions.formatMinutesLabel(120)).toBe('2 hours');
		expect(DurationOptions.formatMinutesLabel(180)).toBe('3 hours');
	});

	test('should format hours and minutes correctly', () => {
		expect(DurationOptions.formatMinutesLabel(90)).toBe(
			'1 hour 30 minutes'
		);
		expect(DurationOptions.formatMinutesLabel(150)).toBe(
			'2 hours 30 minutes'
		);
		expect(DurationOptions.formatMinutesLabel(135)).toBe(
			'2 hours 15 minutes'
		);
	});

	test('should use singular for 1 hour', () => {
		expect(DurationOptions.formatMinutesLabel(60)).toBe('1 hour');
		expect(DurationOptions.formatMinutesLabel(75)).toBe(
			'1 hour 15 minutes'
		);
	});

	test('should use plural for multiple hours', () => {
		expect(DurationOptions.formatMinutesLabel(120)).toBe('2 hours');
		expect(DurationOptions.formatMinutesLabel(240)).toBe('4 hours');
	});
});

describe('DurationOptions.formatDaysLabel', () => {
	test('should format singular day correctly', () => {
		expect(DurationOptions.formatDaysLabel(1)).toBe('1 day');
	});

	test('should format plural days correctly', () => {
		expect(DurationOptions.formatDaysLabel(2)).toBe('2 days');
		expect(DurationOptions.formatDaysLabel(3)).toBe('3 days');
		expect(DurationOptions.formatDaysLabel(7)).toBe('7 days');
	});
});

describe('DurationOptions.formatDurationLabel', () => {
	test('should format hours unit correctly', () => {
		expect(DurationOptions.formatDurationLabel(1.5, 'hours')).toBe(
			'1 hours, 30 minutes'
		);
		expect(DurationOptions.formatDurationLabel(2, 'hours')).toBe('2 hours');
	});

	test('should format minutes unit correctly', () => {
		expect(DurationOptions.formatDurationLabel(30, 'minutes')).toBe(
			'30 minutes'
		);
		expect(DurationOptions.formatDurationLabel(90, 'minutes')).toBe(
			'1 hour 30 minutes'
		);
	});

	test('should format days unit correctly', () => {
		expect(DurationOptions.formatDurationLabel(1, 'days')).toBe('1 day');
		expect(DurationOptions.formatDurationLabel(3, 'days')).toBe('3 days');
	});

	test('should default to hours if no unit specified', () => {
		expect(DurationOptions.formatDurationLabel(2)).toBe('2 hours');
		expect(DurationOptions.formatDurationLabel(1.5)).toBe(
			'1 hours, 30 minutes'
		);
	});
});

describe('DurationOptions constructor and getDurationOptions', () => {
	test('should always include "Other" as first option', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		const result = options.getDurationOptions();
		expect(result[0]).toEqual({ label: 'Other', value: 'other' });
	});

	test('should generate options for hours correctly', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		const result = options.getDurationOptions();
		expect(result).toEqual([
			{ label: 'Other', value: 'other' },
			{ label: '30 minutes', value: 0.5 },
			{ label: '1 hours', value: 1 },
			{ label: '1 hours, 30 minutes', value: 1.5 },
		]);
	});

	test('should generate options for minutes correctly', () => {
		const options = new DurationOptions({
			values: [30, 60, 90],
			unit: 'minutes',
		});

		const result = options.getDurationOptions();
		expect(result).toEqual([
			{ label: 'Other', value: 'other' },
			{ label: '30 minutes', value: 30 },
			{ label: '1 hour', value: 60 },
			{ label: '1 hour 30 minutes', value: 90 },
		]);
	});

	test('should generate options for days correctly', () => {
		const options = new DurationOptions({
			values: [1, 2, 3],
			unit: 'days',
		});

		const result = options.getDurationOptions();
		expect(result).toEqual([
			{ label: 'Other', value: 'other' },
			{ label: '1 day', value: 1 },
			{ label: '2 days', value: 2 },
			{ label: '3 days', value: 3 },
		]);
	});

	test('should handle empty values array', () => {
		const options = new DurationOptions({
			values: [],
			unit: 'hours',
		});

		const result = options.getDurationOptions();
		expect(result).toEqual([{ label: 'Other', value: 'other' }]);
	});

	test('should use custom text domain', () => {
		const options = new DurationOptions({
			values: [1],
			unit: 'hours',
			textDomain: 'custom-domain',
		});

		// Just verify it doesn't throw - actual i18n testing would require more setup
		expect(() => options.getDurationOptions()).not.toThrow();
	});
});

describe('DurationOptions.getMatchingValue', () => {
	test('should return undefined for null or undefined value', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getMatchingValue(null)).toBe(undefined);
		expect(options.getMatchingValue(undefined)).toBe(undefined);
	});

	test('should return matching value within default tolerance', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getMatchingValue(1.005)).toBe(1);
		expect(options.getMatchingValue(0.505)).toBe(0.5);
		expect(options.getMatchingValue(1.495)).toBe(1.5);
	});

	test('should return undefined when value is outside tolerance', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getMatchingValue(1.02)).toBe(undefined);
		expect(options.getMatchingValue(2.25)).toBe(undefined);
	});

	test('should respect custom tolerance', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
			tolerance: 0.1,
		});

		expect(options.getMatchingValue(1.05)).toBe(1);
		expect(options.getMatchingValue(0.55)).toBe(0.5);
		expect(options.getMatchingValue(1.15)).toBe(undefined); // Outside 0.1
	});

	test('should work with minutes unit', () => {
		const options = new DurationOptions({
			values: [30, 60, 90],
			unit: 'minutes',
			tolerance: 1,
		});

		expect(options.getMatchingValue(60.5)).toBe(60);
		expect(options.getMatchingValue(90.9)).toBe(90);
	});
});

describe('DurationOptions.getCurrentSelection', () => {
	test('should return "other" for null or undefined value', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getCurrentSelection(null)).toBe('other');
		expect(options.getCurrentSelection(undefined)).toBe('other');
	});

	test('should return matching predefined value', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getCurrentSelection(1)).toBe(1);
		expect(options.getCurrentSelection(0.5)).toBe(0.5);
		expect(options.getCurrentSelection(1.5)).toBe(1.5);
	});

	test('should return matching value within tolerance', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getCurrentSelection(1.005)).toBe(1);
		expect(options.getCurrentSelection(0.505)).toBe(0.5);
	});

	test('should return "other" for custom values outside predefined list', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		expect(options.getCurrentSelection(2.25)).toBe('other');
		expect(options.getCurrentSelection(0.75)).toBe('other');
	});

	test('should work with minutes unit', () => {
		const options = new DurationOptions({
			values: [30, 60, 90, 120],
			unit: 'minutes',
		});

		expect(options.getCurrentSelection(60)).toBe(60);
		expect(options.getCurrentSelection(150)).toBe('other');
	});

	test('should work with days unit', () => {
		const options = new DurationOptions({
			values: [1, 2, 3],
			unit: 'days',
		});

		expect(options.getCurrentSelection(2)).toBe(2);
		expect(options.getCurrentSelection(5)).toBe('other');
	});
});

describe('DurationOptions setValue and auto-add behavior', () => {
	test('should add custom value when setValue is called with non-predefined value', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		// Set a custom value not in the list
		options.setValue(2.25);
		const result = options.getDurationOptions();

		expect(result).toHaveLength(5); // Other + 3 predefined + 1 custom
		expect(result[4]).toEqual({
			label: '2 hours, 15 minutes',
			value: 2.25,
		});

		// Should be sorted by value
		expect(result.map((opt) => opt.value)).toEqual([
			'other',
			0.5,
			1,
			1.5,
			2.25,
		]);
	});

	test('should not add duplicate when setValue is called with predefined value', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		// Set a value that exists in the list
		options.setValue(1);
		const result = options.getDurationOptions();

		expect(result).toHaveLength(4); // Other + 3 predefined
		expect(result.map((opt) => opt.value)).toEqual(['other', 0.5, 1, 1.5]);
	});

	test('should handle tolerance in setValue and not add duplicate', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		// Set a value very close to an existing one (within 0.01 tolerance)
		options.setValue(1.005);
		const result = options.getDurationOptions();

		// Should not add duplicate due to tolerance
		expect(result).toHaveLength(4); // Other + 3 predefined
		// selectedValue should be rounded to matching value
		expect(options.selectedValue).toBe(1);
	});

	test('should not add custom value if it is zero or negative', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		options.setValue(0);
		let result = options.getDurationOptions();
		expect(result).toHaveLength(4); // Other + 3 predefined

		options.setValue(-1);
		result = options.getDurationOptions();
		expect(result).toHaveLength(4); // Other + 3 predefined
	});

	test('should maintain sorted order when adding custom values', () => {
		const options = new DurationOptions({
			values: [1, 3, 4],
			unit: 'hours',
		});

		// Add a custom value in the middle
		options.setValue(2.5);
		const result = options.getDurationOptions();

		expect(result.map((opt) => opt.value)).toEqual(['other', 1, 2.5, 3, 4]);
	});

	test('should work without setValue - no custom value added', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5],
			unit: 'hours',
		});

		// Don't call setValue
		const result = options.getDurationOptions();

		expect(result).toHaveLength(4); // Other + 3 predefined
		expect(result.map((opt) => opt.value)).toEqual(['other', 0.5, 1, 1.5]);
	});

	test('should update custom value when setValue is called multiple times', () => {
		const options = new DurationOptions({
			values: [1, 2, 3],
			unit: 'hours',
		});

		options.setValue(1.5);
		let result = options.getDurationOptions();
		expect(result).toHaveLength(5); // Other + 3 predefined + 1 custom

		// Change to different custom value
		options.setValue(2.5);
		result = options.getDurationOptions();
		expect(result).toHaveLength(5); // Other + 3 predefined + 1 new custom
		expect(result.find((opt) => opt.value === 1.5)).toBeUndefined();
		expect(result.find((opt) => opt.value === 2.5)).toBeDefined();
	});
});

describe('DurationOptions real-world scenarios', () => {
	test('should match fair-calendar-button timed duration options', () => {
		const options = new DurationOptions({
			values: [30, 60, 90, 120, 150, 180, 240, 360, 480],
			unit: 'minutes',
			textDomain: 'fair-calendar-button',
		});

		const result = options.getDurationOptions();
		expect(result[0]).toEqual({ label: 'Other', value: 'other' });
		expect(result[1]).toEqual({ label: '30 minutes', value: 30 });
		expect(result[2]).toEqual({ label: '1 hour', value: 60 });
		expect(result[3]).toEqual({ label: '1 hour 30 minutes', value: 90 });
		expect(result[4]).toEqual({ label: '2 hours', value: 120 });
	});

	test('should match fair-calendar-button all-day length options', () => {
		const options = new DurationOptions({
			values: [1, 2, 3],
			unit: 'days',
			textDomain: 'fair-calendar-button',
		});

		const result = options.getDurationOptions();
		expect(result).toEqual([
			{ label: 'Other', value: 'other' },
			{ label: '1 day', value: 1 },
			{ label: '2 days', value: 2 },
			{ label: '3 days', value: 3 },
		]);
	});

	test('should match fair-timetable time slot length options', () => {
		const options = new DurationOptions({
			values: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4],
			unit: 'hours',
			textDomain: 'fair-timetable',
		});

		const result = options.getDurationOptions();
		expect(result).toHaveLength(9); // Other + 8 values
		expect(result[0]).toEqual({ label: 'Other', value: 'other' });
		expect(result[1]).toEqual({ label: '30 minutes', value: 0.5 });
		expect(result[8]).toEqual({ label: '4 hours', value: 4 });
	});

	test('should handle fair-timetable timetable length options (4-16h)', () => {
		const values = Array.from({ length: 13 }, (_, i) => i + 4); // [4, 5, ..., 16]
		const options = new DurationOptions({
			values,
			unit: 'hours',
			textDomain: 'fair-timetable',
		});

		const result = options.getDurationOptions();
		expect(result).toHaveLength(14); // Other + 13 values
		expect(result[1]).toEqual({ label: '4 hours', value: 4 });
		expect(result[13]).toEqual({ label: '16 hours', value: 16 });
	});
});
