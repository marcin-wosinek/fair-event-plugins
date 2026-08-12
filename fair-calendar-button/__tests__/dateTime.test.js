/**
 * Test suite for dateTime utility functions
 */

import {
	calculateDaysInclusive,
	calculateEndDate,
	validateDateTimeOrder,
	getDateTimeValidationError,
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

	describe('validateDateTimeOrder', () => {
		describe('valid date/time combinations', () => {
			it('should validate when end date is after start date', () => {
				const start = '2024-12-21';
				const end = '2024-12-22';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when end datetime is after start datetime', () => {
				const start = '2024-12-21T10:00:00';
				const end = '2024-12-21T11:00:00';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when start and end are the same', () => {
				const start = '2024-12-21T10:00:00';
				const end = '2024-12-21T10:00:00';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when start and end dates are the same', () => {
				const start = '2024-12-21';
				const end = '2024-12-21';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate datetime across date boundary', () => {
				const start = '2024-12-21T23:30:00';
				const end = '2024-12-22T01:00:00';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});
		});

		describe('invalid date/time combinations', () => {
			it('should invalidate when end date is before start date', () => {
				const start = '2024-12-22';
				const end = '2024-12-21';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(false);
			});

			it('should invalidate when end datetime is before start datetime', () => {
				const start = '2024-12-21T11:00:00';
				const end = '2024-12-21T10:00:00';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(false);
			});

			it('should invalidate when end datetime is on previous day', () => {
				const start = '2024-12-22T01:00:00';
				const end = '2024-12-21T23:30:00';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(false);
			});

			it('should invalidate when end date is several days before start', () => {
				const start = '2024-12-25';
				const end = '2024-12-20';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(false);
			});
		});

		describe('edge cases', () => {
			it('should validate when start is empty', () => {
				const start = '';
				const end = '2024-12-22';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when end is empty', () => {
				const start = '2024-12-21';
				const end = '';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when both are empty', () => {
				const start = '';
				const end = '';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when start is null', () => {
				const start = null;
				const end = '2024-12-22';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when end is undefined', () => {
				const start = '2024-12-21';
				const end = undefined;

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when start date is invalid', () => {
				const start = 'invalid-date';
				const end = '2024-12-22';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});

			it('should validate when end date is invalid', () => {
				const start = '2024-12-21';
				const end = 'invalid-date';

				const result = validateDateTimeOrder(start, end);

				expect(result).toBe(true);
			});
		});
	});

	describe('getDateTimeValidationError', () => {
		describe('valid scenarios - no error message', () => {
			it('should return null for valid date order', () => {
				const start = '2024-12-21';
				const end = '2024-12-22';

				const result = getDateTimeValidationError(start, end, true);

				expect(result).toBe(null);
			});

			it('should return null for valid datetime order', () => {
				const start = '2024-12-21T10:00:00';
				const end = '2024-12-21T11:00:00';

				const result = getDateTimeValidationError(start, end, false);

				expect(result).toBe(null);
			});

			it('should return null when start is empty', () => {
				const start = '';
				const end = '2024-12-22';

				const result = getDateTimeValidationError(start, end, true);

				expect(result).toBe(null);
			});

			it('should return null when end is empty', () => {
				const start = '2024-12-21';
				const end = '';

				const result = getDateTimeValidationError(start, end, false);

				expect(result).toBe(null);
			});

			it('should return null when both are empty', () => {
				const start = '';
				const end = '';

				const result = getDateTimeValidationError(start, end, true);

				expect(result).toBe(null);
			});
		});

		describe('invalid scenarios - error messages', () => {
			it('should return all-day error message when allDay is true', () => {
				const start = '2024-12-22';
				const end = '2024-12-21';

				const result = getDateTimeValidationError(start, end, true);

				expect(result).toBe('End date cannot be before start date');
			});

			it('should return datetime error message when allDay is false', () => {
				const start = '2024-12-21T11:00:00';
				const end = '2024-12-21T10:00:00';

				const result = getDateTimeValidationError(start, end, false);

				expect(result).toBe(
					'End date/time cannot be before start date/time'
				);
			});

			it('should return datetime error message when allDay is undefined', () => {
				const start = '2024-12-21T11:00:00';
				const end = '2024-12-21T10:00:00';

				const result = getDateTimeValidationError(start, end);

				expect(result).toBe(
					'End date/time cannot be before start date/time'
				);
			});

			it('should return all-day error for invalid date sequence', () => {
				const start = '2024-12-25';
				const end = '2024-12-20';

				const result = getDateTimeValidationError(start, end, true);

				expect(result).toBe('End date cannot be before start date');
			});
		});
	});
});
