/**
 * Test suite for length utilities
 */
import { formatLengthLabel } from '../src/utils/lengths.js';

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
