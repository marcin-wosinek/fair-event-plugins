/**
 * Test suite for dateTime utility functions
 */

import {
	calculateDaysInclusive,
	calculateEndDate,
} from '../src/blocks/calendar-button/utils/dateTime.js';

describe('dateTime utilities', () => {
	describe('calculateDaysInclusive', () => {
		it('should calculate inclusive days for same date', () => {
			const startDate = '2024-12-21';
			const endDate = '2024-12-21';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(1);
		});

		it('should calculate inclusive days for consecutive dates', () => {
			const startDate = '2024-12-21';
			const endDate = '2024-12-22';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(2);
		});

		it('should calculate inclusive days for three-day span', () => {
			const startDate = '2024-12-21';
			const endDate = '2024-12-23';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(3);
		});

		it('should calculate inclusive days across month boundary', () => {
			const startDate = '2024-11-30';
			const endDate = '2024-12-02';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(3);
		});

		it('should calculate inclusive days across year boundary', () => {
			const startDate = '2024-12-31';
			const endDate = '2025-01-01';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(2);
		});

		it('should return null for invalid start date', () => {
			const startDate = 'invalid-date';
			const endDate = '2024-12-22';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(null);
		});

		it('should return null for invalid end date', () => {
			const startDate = '2024-12-21';
			const endDate = 'invalid-date';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(null);
		});

		it('should return null for empty start date', () => {
			const startDate = '';
			const endDate = '2024-12-22';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(null);
		});

		it('should return null for empty end date', () => {
			const startDate = '2024-12-21';
			const endDate = '';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(null);
		});

		it('should handle end date before start date', () => {
			const startDate = '2024-12-22';
			const endDate = '2024-12-21';

			const result = calculateDaysInclusive(startDate, endDate);

			expect(result).toBe(0); // differenceInDays returns -1, plus 1 = 0
		});
	});

	describe('calculateEndDate', () => {
		it('should calculate end date for 1 day event', () => {
			const startDate = '2024-12-21';
			const days = '1';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-12-21');
		});

		it('should calculate end date for 2 day event', () => {
			const startDate = '2024-12-21';
			const days = '2';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-12-22');
		});

		it('should calculate end date for 3 day event', () => {
			const startDate = '2024-12-21';
			const days = '3';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-12-23');
		});

		it('should calculate end date across month boundary', () => {
			const startDate = '2024-11-30';
			const days = '3';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-12-02');
		});

		it('should calculate end date across year boundary', () => {
			const startDate = '2024-12-31';
			const days = '2';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2025-01-01');
		});

		it('should handle numeric days parameter', () => {
			const startDate = '2024-12-21';
			const days = 2;

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-12-22');
		});

		it('should return empty string for "other" days value', () => {
			const startDate = '2024-12-21';
			const days = 'other';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should return empty string for invalid start date', () => {
			const startDate = 'invalid-date';
			const days = '2';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should return empty string for empty start date', () => {
			const startDate = '';
			const days = '2';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should return empty string for empty days', () => {
			const startDate = '2024-12-21';
			const days = '';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should return empty string for null days', () => {
			const startDate = '2024-12-21';
			const days = null;

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should return empty string for undefined days', () => {
			const startDate = '2024-12-21';
			const days = undefined;

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('');
		});

		it('should handle leap year correctly', () => {
			const startDate = '2024-02-28';
			const days = '2';

			const result = calculateEndDate(startDate, days);

			expect(result).toBe('2024-02-29'); // 2024 is a leap year
		});
	});
});
