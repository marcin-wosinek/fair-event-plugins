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

	describe('getEndTime', () => {
		test('should return formatted end time', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '12:30',
			});

			expect(hourlyRange.getEndTime()).toBe('12:30');
		});

		test('should handle midnight end time', () => {
			const hourlyRange = new HourlyRange({
				startTime: '22:00',
				endTime: '00:00',
			});

			expect(hourlyRange.getEndTime()).toBe('00:00');
		});

		test('should handle fractional end times', () => {
			const hourlyRange = new HourlyRange({
				startTime: '08:15',
				endTime: '14:45',
			});

			expect(hourlyRange.getEndTime()).toBe('14:45');
		});

		test('should handle end times past midnight', () => {
			const hourlyRange = new HourlyRange({
				startTime: '23:30',
				endTime: '01:15',
			});

			expect(hourlyRange.getEndTime()).toBe('01:15');
		});

		test('should return correct format after setDuration', () => {
			const hourlyRange = new HourlyRange({
				startTime: '10:00',
				endTime: '12:00',
			});

			hourlyRange.setDuration(2.5);

			expect(hourlyRange.getEndTime()).toBe('12:30');
		});

		test('should return correct format after setStartTime', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:30',
			});

			hourlyRange.setStartTime('14:15');

			expect(hourlyRange.getEndTime()).toBe('16:45');
		});

		test('should handle edge cases with rounding', () => {
			const hourlyRange = new HourlyRange({
				startTime: '00:00',
				endTime: '00:01',
			});

			expect(hourlyRange.getEndTime()).toBe('00:01');
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

	describe('setStartTime method', () => {
		test('should update start time while keeping duration constant', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:30',
			});

			hourlyRange.setStartTime('10:15');

			expect(hourlyRange.startHour).toBe(10.25);
			expect(hourlyRange.endHour).toBe(12.75);
			expect(hourlyRange.getDuration()).toBe(2.5);
			expect(hourlyRange.getTimeRangeString()).toBe('10:15—12:45');
		});

		test('should handle midnight crossover scenarios', () => {
			const hourlyRange = new HourlyRange({
				startTime: '22:00',
				endTime: '01:00',
			});

			hourlyRange.setStartTime('23:30');

			expect(hourlyRange.startHour).toBe(23.5);
			expect(hourlyRange.endHour).toBe(26.5);
			expect(hourlyRange.getDuration()).toBe(3);
			expect(hourlyRange.getTimeRangeString()).toBe('23:30—02:30');
		});

		test('should handle setting start time to midnight', () => {
			const hourlyRange = new HourlyRange({
				startTime: '14:00',
				endTime: '16:30',
			});

			hourlyRange.setStartTime('00:00');

			expect(hourlyRange.startHour).toBe(0);
			expect(hourlyRange.endHour).toBe(2.5);
			expect(hourlyRange.getDuration()).toBe(2.5);
			expect(hourlyRange.getTimeRangeString()).toBe('00:00—02:30');
		});

		test('should handle fractional start times', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '10:45',
			});

			hourlyRange.setStartTime('14:15');

			expect(hourlyRange.startHour).toBe(14.25);
			expect(hourlyRange.endHour).toBe(16);
			expect(hourlyRange.getDuration()).toBe(1.75);
			expect(hourlyRange.getTimeRangeString()).toBe('14:15—16:00');
		});

		test('should handle invalid start time inputs gracefully', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});
			const originalDuration = hourlyRange.getDuration();

			hourlyRange.setStartTime('');
			expect(hourlyRange.getDuration()).toBe(originalDuration);

			hourlyRange.setStartTime(null);
			expect(hourlyRange.getDuration()).toBe(originalDuration);

			hourlyRange.setStartTime('invalid');
			expect(hourlyRange.startHour).toBe(0);
			expect(hourlyRange.endHour).toBe(originalDuration);
		});

		test('should preserve duration across multiple setStartTime calls', () => {
			const hourlyRange = new HourlyRange({
				startTime: '08:30',
				endTime: '12:00',
			});
			const originalDuration = hourlyRange.getDuration();

			hourlyRange.setStartTime('10:00');
			expect(hourlyRange.getDuration()).toBe(originalDuration);

			hourlyRange.setStartTime('15:45');
			expect(hourlyRange.getDuration()).toBe(originalDuration);

			hourlyRange.setStartTime('23:15');
			expect(hourlyRange.getDuration()).toBe(originalDuration);
		});
	});

	describe('setDuration method', () => {
		test('should update duration while keeping start time constant', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:30',
			});

			hourlyRange.setDuration(3.5);

			expect(hourlyRange.startHour).toBe(9);
			expect(hourlyRange.endHour).toBe(12.5);
			expect(hourlyRange.getDuration()).toBe(3.5);
			expect(hourlyRange.getTimeRangeString()).toBe('09:00—12:30');
		});

		test('should handle setting duration to zero', () => {
			const hourlyRange = new HourlyRange({
				startTime: '14:15',
				endTime: '16:30',
			});

			hourlyRange.setDuration(0);

			expect(hourlyRange.startHour).toBe(14.25);
			expect(hourlyRange.endHour).toBe(14.25);
			expect(hourlyRange.getDuration()).toBe(0);
			expect(hourlyRange.getTimeRangeString()).toBe('14:15—14:15');
		});

		test('should handle fractional durations', () => {
			const hourlyRange = new HourlyRange({
				startTime: '08:00',
				endTime: '10:00',
			});

			hourlyRange.setDuration(1.75);

			expect(hourlyRange.startHour).toBe(8);
			expect(hourlyRange.endHour).toBe(9.75);
			expect(hourlyRange.getDuration()).toBe(1.75);
			expect(hourlyRange.getTimeRangeString()).toBe('08:00—09:45');
		});

		test('should handle durations that cross midnight', () => {
			const hourlyRange = new HourlyRange({
				startTime: '22:30',
				endTime: '23:30',
			});

			hourlyRange.setDuration(4);

			expect(hourlyRange.startHour).toBe(22.5);
			expect(hourlyRange.endHour).toBe(26.5);
			expect(hourlyRange.getDuration()).toBe(4);
			expect(hourlyRange.getTimeRangeString()).toBe('22:30—02:30');
		});

		test('should handle large durations', () => {
			const hourlyRange = new HourlyRange({
				startTime: '10:00',
				endTime: '12:00',
			});

			hourlyRange.setDuration(25.5);

			expect(hourlyRange.startHour).toBe(10);
			expect(hourlyRange.endHour).toBe(35.5);
			expect(hourlyRange.getDuration()).toBe(25.5);
			expect(hourlyRange.getTimeRangeString()).toBe('10:00—11:30');
		});

		test('should handle invalid duration inputs gracefully', () => {
			const hourlyRange = new HourlyRange({
				startTime: '09:00',
				endTime: '11:00',
			});
			const originalStartHour = hourlyRange.startHour;
			const originalEndHour = hourlyRange.endHour;

			hourlyRange.setDuration(-1);
			expect(hourlyRange.startHour).toBe(originalStartHour);
			expect(hourlyRange.endHour).toBe(originalEndHour);

			hourlyRange.setDuration('invalid');
			expect(hourlyRange.startHour).toBe(originalStartHour);
			expect(hourlyRange.endHour).toBe(originalEndHour);

			hourlyRange.setDuration(null);
			expect(hourlyRange.startHour).toBe(originalStartHour);
			expect(hourlyRange.endHour).toBe(originalEndHour);
		});

		test('should preserve start time across multiple setDuration calls', () => {
			const hourlyRange = new HourlyRange({
				startTime: '13:45',
				endTime: '15:15',
			});
			const originalStartHour = hourlyRange.startHour;

			hourlyRange.setDuration(2);
			expect(hourlyRange.startHour).toBe(originalStartHour);

			hourlyRange.setDuration(0.5);
			expect(hourlyRange.startHour).toBe(originalStartHour);

			hourlyRange.setDuration(8);
			expect(hourlyRange.startHour).toBe(originalStartHour);
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
