/**
 * Tests for date and time utility functions
 */

import { calculateDuration } from '../src/dateTime.js';

describe('calculateDuration', () => {
	it('should calculate duration between two valid datetime strings', () => {
		const startTime = '2024-10-08T10:00:00';
		const endTime = '2024-10-08T12:30:00';
		expect(calculateDuration(startTime, endTime)).toBe(150);
	});

	it('should return null for missing startTime', () => {
		const endTime = '2024-10-08T12:30:00';
		expect(calculateDuration(null, endTime)).toBeNull();
		expect(calculateDuration('', endTime)).toBeNull();
	});

	it('should return null for missing endTime', () => {
		const startTime = '2024-10-08T10:00:00';
		expect(calculateDuration(startTime, null)).toBeNull();
		expect(calculateDuration(startTime, '')).toBeNull();
	});

	it('should return null for invalid datetime strings', () => {
		expect(calculateDuration('invalid', '2024-10-08T12:30:00')).toBeNull();
		expect(calculateDuration('2024-10-08T10:00:00', 'invalid')).toBeNull();
		expect(calculateDuration('invalid', 'invalid')).toBeNull();
	});

	it('should handle duration spanning multiple days', () => {
		const startTime = '2024-10-08T22:00:00';
		const endTime = '2024-10-09T02:00:00';
		expect(calculateDuration(startTime, endTime)).toBe(240);
	});

	it('should handle negative duration (end before start)', () => {
		const startTime = '2024-10-08T12:00:00';
		const endTime = '2024-10-08T10:00:00';
		expect(calculateDuration(startTime, endTime)).toBe(-120);
	});

	it('should handle zero duration (same time)', () => {
		const startTime = '2024-10-08T10:00:00';
		const endTime = '2024-10-08T10:00:00';
		expect(calculateDuration(startTime, endTime)).toBe(0);
	});
});
