/**
 * Test suite for HourlyRange class
 */
import { HourlyRange } from '../src/utils/hourly-range.js';

describe('HourlyRange', () => {
	describe('Constructor', () => {
		test('should create HourlyRange with valid string inputs', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:30',
				endTime: '11:00',
			});

			expect(hourlyRange.startHour).toBe(9.5);
			expect(hourlyRange.endHour).toBe(11);
			expect(hourlyRange.getDuration()).toBe(1.5);
		});

		test('should handle midnight times', () => {
			const hourlyRange = new HourlyRange({
				startTime: '00:00',
				endTime: '01:30',
			});

			expect(hourlyRange.startHour).toBe(0);
			expect(hourlyRange.endHour).toBe(1.5);
			expect(hourlyRange.getDuration()).toBe(1.5);
		});

		test('should handle cross-midnight scenarios', () => {
			const hourlyRange = new HourlyRange({
				startTime: '23:00',
				endTime: '01:00',
			});

			expect(hourlyRange.startHour).toBe(23);
			expect(hourlyRange.endHour).toBe(1);
			expect(hourlyRange.getDuration()).toBe(2); // 23:00 to 01:00 = 2 hours
		});

		test('should throw error for missing startHour', () => {
			expect(() => {
				new HourlyRange({ endTime: '11:00' });
			}).toThrow('HourlyRange requires both startTime and endTime');
		});

		test('should throw error for missing endHour', () => {
			expect(() => {
				new HourlyRange({ startTime: '09:00' });
			}).toThrow('HourlyRange requires both startTime and endTime');
		});

		test('should throw error for empty parameters', () => {
			expect(() => {
				new HourlyRange({});
			}).toThrow('HourlyRange requires both startTime and endTime');
		});
	});

	describe('Time Parsing', () => {
		test('should parse various time formats correctly', () => {
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
				const hourlyRange = new HourlyRange({
					startTime: input,
					endTime: '23:59',
				});
				expect(hourlyRange.startHour).toBeCloseTo(expected, 5);
			});
		});

		test('should handle invalid time strings gracefully', () => {
			const hourlyRange = new HourlyRange({
				startTime: 'invalid',
				endTime: '11:00',
			});

			expect(hourlyRange.startHour).toBe(0);
			expect(hourlyRange.endHour).toBe(11);
		});
	});

	describe('overlapsWith', () => {
		test('should detect overlapping time ranges', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '10:00',
				endTime: '12:00',
			});

			expect(hourlyRange1.overlapsWith(hourlyRange2)).toBe(true);
			expect(hourlyRange2.overlapsWith(hourlyRange1)).toBe(true);
		});

		test('should detect non-overlapping time ranges', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '10:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '11:00',
				endTime: '12:00',
			});

			expect(hourlyRange1.overlapsWith(hourlyRange2)).toBe(false);
			expect(hourlyRange2.overlapsWith(hourlyRange1)).toBe(false);
		});

		test('should detect touching time ranges as non-overlapping', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '10:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '10:00',
				endTime: '11:00',
			});

			expect(hourlyRange1.overlapsWith(hourlyRange2)).toBe(false);
			expect(hourlyRange2.overlapsWith(hourlyRange1)).toBe(false);
		});

		test('should handle non-HourlyRange parameters', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});

			expect(hourlyRange.overlapsWith(null)).toBe(false);
			expect(hourlyRange.overlapsWith({})).toBe(false);
			expect(hourlyRange.overlapsWith('invalid')).toBe(false);
		});
	});

	describe('isBefore', () => {
		test('should detect when this time is before another', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '10:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '11:00',
				endTime: '12:00',
			});

			expect(hourlyRange1.isBefore(hourlyRange2)).toBe(true);
			expect(hourlyRange2.isBefore(hourlyRange1)).toBe(false);
		});

		test('should handle same start times', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '10:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});

			expect(hourlyRange1.isBefore(hourlyRange2)).toBe(false);
			expect(hourlyRange2.isBefore(hourlyRange1)).toBe(false);
		});

		test('should handle non-HourlyRange parameters', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});

			expect(hourlyRange.isBefore(null)).toBe(false);
			expect(hourlyRange.isBefore({})).toBe(false);
		});
	});

	describe('isAfter', () => {
		test('should detect when this time is after another', () => {
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '10:00',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '11:00',
				endTime: '12:00',
			});

			expect(hourlyRange1.isAfter(hourlyRange2)).toBe(false);
			expect(hourlyRange2.isAfter(hourlyRange1)).toBe(true);
		});

		test('should handle non-HourlyRange parameters', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});

			expect(hourlyRange.isAfter(null)).toBe(false);
			expect(hourlyRange.isAfter({})).toBe(false);
		});
	});

	describe('getTimeRangeString', () => {
		test('should format time range string correctly', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:30',
				endTime: '11:15',
			});

			expect(hourlyRange.getTimeRangeString()).toBe('09:30—11:15');
		});

		test('should handle midnight times', () => {
			const hourlyRange = new HourlyRange({
				startTime: '00:00',
				endTime: '01:30',
			});

			expect(hourlyRange.getTimeRangeString()).toBe('00:00—01:30');
		});

		test('should handle cross-midnight scenario', () => {
			const hourlyRange = new HourlyRange({
				startTime: '23:30',
				endTime: '01:00',
			});

			expect(hourlyRange.getTimeRangeString()).toBe('23:30—01:00');
		});
	});

	describe('getDuration', () => {
		test('should return correct duration', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:30',
			});

			expect(hourlyRange.getDuration()).toBe(2.5);
		});

		test('should handle cross-midnight duration', () => {
			const hourlyRange = new HourlyRange({
				startTime: '23:00',
				endTime: '02:00',
			});

			expect(hourlyRange.getDuration()).toBe(3); // 23:00 to 02:00 = 3 hours
		});
	});

	describe('toObject', () => {
		test('should return plain object representation', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:30',
				endTime: '11:00',
			});

			const plainObj = hourlyRange.toObject();

			expect(plainObj).toEqual({
				startHour: 9.5,
				endHour: 11,
				duration: 1.5,
			});
		});
	});

	describe('getDebugInfo', () => {
		test('should return debug information', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:30',
				endTime: '11:15',
			});

			const debugInfo = hourlyRange.getDebugInfo();

			expect(debugInfo).toEqual({
				timeRange: '09:30—11:15',
				startHour: 9.5,
				endHour: 11.25,
				duration: 1.75,
			});
		});
	});

	describe('Edge Cases', () => {
		test('should handle 24-hour format edge cases', () => {
			const hourlyRange = new HourlyRange({
				startTime: '00:01',
				endTime: '23:59',
			});

			expect(hourlyRange.getDuration()).toBeCloseTo(
				23.966666666666665,
				5
			);
		});

		test('should handle same start and end time', () => {
			const hourlyRange = new HourlyRange({
				startTime: '12:00',
				endTime: '12:00',
			});

			expect(hourlyRange.getDuration()).toBe(0);
		});

		test('should handle fractional minutes correctly', () => {
			// Testing edge cases with seconds that round to different minutes
			const hourlyRange1 = new HourlyRange({
				startTime: '09:00',
				endTime: '09:01',
			});
			const hourlyRange2 = new HourlyRange({
				startTime: '09:00',
				endTime: '09:59',
			});

			expect(hourlyRange1.getDuration()).toBeCloseTo(
				0.016666666666666666,
				5
			);
			expect(hourlyRange2.getDuration()).toBeCloseTo(
				0.9833333333333333,
				5
			);
		});
	});

	describe('Static calculateEndTime method', () => {
		test('should calculate end time from start time and duration', () => {
			expect(HourlyRange.calculateEndTime('09:00', 2.5)).toBe('11:30');
			expect(HourlyRange.calculateEndTime('14:15', 1.75)).toBe('16:00');
			expect(HourlyRange.calculateEndTime('23:30', 1.5)).toBe('01:00');
		});

		test('should handle midnight crossover', () => {
			expect(HourlyRange.calculateEndTime('23:00', 3)).toBe('02:00');
			expect(HourlyRange.calculateEndTime('22:45', 2.5)).toBe('01:15');
		});

		test('should handle edge cases', () => {
			expect(HourlyRange.calculateEndTime('00:00', 24)).toBe('00:00');
			expect(HourlyRange.calculateEndTime('12:00', 0)).toBe('12:00');
			expect(HourlyRange.calculateEndTime('09:30', 0.5)).toBe('10:00');
		});

		test('should handle invalid inputs', () => {
			expect(HourlyRange.calculateEndTime('', 2)).toBe('00:00');
			expect(HourlyRange.calculateEndTime(null, 2)).toBe('00:00');
			expect(HourlyRange.calculateEndTime('09:00', -1)).toBe('09:00');
			expect(HourlyRange.calculateEndTime('09:00', 'invalid')).toBe(
				'09:00'
			);
		});

		test('should handle fractional hours precisely', () => {
			expect(HourlyRange.calculateEndTime('09:00', 1.25)).toBe('10:15');
			expect(HourlyRange.calculateEndTime('15:30', 0.75)).toBe('16:15');
			expect(HourlyRange.calculateEndTime('08:45', 2.25)).toBe('11:00');
		});
	});
});
