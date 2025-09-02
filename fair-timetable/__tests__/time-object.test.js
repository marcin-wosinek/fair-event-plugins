/**
 * Test suite for TimeObject class
 */
import { TimeObject } from '../src/utils/time-object.js';

describe('TimeObject', () => {
	describe('Constructor', () => {
		test('should create TimeObject with valid string inputs', () => {
			const timeObj = new TimeObject({
				startHour: '09:30',
				endHour: '11:00',
			});

			expect(timeObj.startHour).toBe(9.5);
			expect(timeObj.endHour).toBe(11);
			expect(timeObj.duration).toBe(1.5);
		});

		test('should handle midnight times', () => {
			const timeObj = new TimeObject({
				startHour: '00:00',
				endHour: '01:30',
			});

			expect(timeObj.startHour).toBe(0);
			expect(timeObj.endHour).toBe(1.5);
			expect(timeObj.duration).toBe(1.5);
		});

		test('should handle cross-midnight scenarios', () => {
			const timeObj = new TimeObject({
				startHour: '23:00',
				endHour: '01:00',
			});

			expect(timeObj.startHour).toBe(23);
			expect(timeObj.endHour).toBe(1);
			expect(timeObj.duration).toBe(2); // 23:00 to 01:00 = 2 hours
		});

		test('should throw error for missing startHour', () => {
			expect(() => {
				new TimeObject({ endHour: '11:00' });
			}).toThrow('TimeObject requires both startHour and endHour');
		});

		test('should throw error for missing endHour', () => {
			expect(() => {
				new TimeObject({ startHour: '09:00' });
			}).toThrow('TimeObject requires both startHour and endHour');
		});

		test('should throw error for empty parameters', () => {
			expect(() => {
				new TimeObject({});
			}).toThrow('TimeObject requires both startHour and endHour');
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
				const timeObj = new TimeObject({
					startHour: input,
					endHour: '23:59',
				});
				expect(timeObj.startHour).toBeCloseTo(expected, 5);
			});
		});

		test('should handle invalid time strings gracefully', () => {
			const timeObj = new TimeObject({
				startHour: 'invalid',
				endHour: '11:00',
			});

			expect(timeObj.startHour).toBe(0);
			expect(timeObj.endHour).toBe(11);
		});
	});

	describe('overlapsWith', () => {
		test('should detect overlapping time ranges', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '11:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '10:00',
				endHour: '12:00',
			});

			expect(timeObj1.overlapsWith(timeObj2)).toBe(true);
			expect(timeObj2.overlapsWith(timeObj1)).toBe(true);
		});

		test('should detect non-overlapping time ranges', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '10:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '11:00',
				endHour: '12:00',
			});

			expect(timeObj1.overlapsWith(timeObj2)).toBe(false);
			expect(timeObj2.overlapsWith(timeObj1)).toBe(false);
		});

		test('should detect touching time ranges as non-overlapping', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '10:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '10:00',
				endHour: '11:00',
			});

			expect(timeObj1.overlapsWith(timeObj2)).toBe(false);
			expect(timeObj2.overlapsWith(timeObj1)).toBe(false);
		});

		test('should handle non-TimeObject parameters', () => {
			const timeObj = new TimeObject({
				startHour: '09:00',
				endHour: '11:00',
			});

			expect(timeObj.overlapsWith(null)).toBe(false);
			expect(timeObj.overlapsWith({})).toBe(false);
			expect(timeObj.overlapsWith('invalid')).toBe(false);
		});
	});

	describe('isBefore', () => {
		test('should detect when this time is before another', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '10:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '11:00',
				endHour: '12:00',
			});

			expect(timeObj1.isBefore(timeObj2)).toBe(true);
			expect(timeObj2.isBefore(timeObj1)).toBe(false);
		});

		test('should handle same start times', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '10:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '09:00',
				endHour: '11:00',
			});

			expect(timeObj1.isBefore(timeObj2)).toBe(false);
			expect(timeObj2.isBefore(timeObj1)).toBe(false);
		});

		test('should handle non-TimeObject parameters', () => {
			const timeObj = new TimeObject({
				startHour: '09:00',
				endHour: '11:00',
			});

			expect(timeObj.isBefore(null)).toBe(false);
			expect(timeObj.isBefore({})).toBe(false);
		});
	});

	describe('isAfter', () => {
		test('should detect when this time is after another', () => {
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '10:00',
			});
			const timeObj2 = new TimeObject({
				startHour: '11:00',
				endHour: '12:00',
			});

			expect(timeObj1.isAfter(timeObj2)).toBe(false);
			expect(timeObj2.isAfter(timeObj1)).toBe(true);
		});

		test('should handle non-TimeObject parameters', () => {
			const timeObj = new TimeObject({
				startHour: '09:00',
				endHour: '11:00',
			});

			expect(timeObj.isAfter(null)).toBe(false);
			expect(timeObj.isAfter({})).toBe(false);
		});
	});

	describe('getRange', () => {
		test('should format time range string correctly', () => {
			const timeObj = new TimeObject({
				startHour: '09:30',
				endHour: '11:15',
			});

			expect(timeObj.getRange()).toBe('09:30—11:15');
		});

		test('should handle midnight times', () => {
			const timeObj = new TimeObject({
				startHour: '00:00',
				endHour: '01:30',
			});

			expect(timeObj.getRange()).toBe('00:00—01:30');
		});

		test('should handle cross-midnight scenario', () => {
			const timeObj = new TimeObject({
				startHour: '23:30',
				endHour: '01:00',
			});

			expect(timeObj.getRange()).toBe('23:30—01:00');
		});
	});

	describe('getDuration', () => {
		test('should return correct duration', () => {
			const timeObj = new TimeObject({
				startHour: '09:00',
				endHour: '11:30',
			});

			expect(timeObj.getDuration()).toBe(2.5);
		});

		test('should handle cross-midnight duration', () => {
			const timeObj = new TimeObject({
				startHour: '23:00',
				endHour: '02:00',
			});

			expect(timeObj.getDuration()).toBe(3); // 23:00 to 02:00 = 3 hours
		});
	});

	describe('toObject', () => {
		test('should return plain object representation', () => {
			const timeObj = new TimeObject({
				startHour: '09:30',
				endHour: '11:00',
			});

			const plainObj = timeObj.toObject();

			expect(plainObj).toEqual({
				startHour: 9.5,
				endHour: 11,
				duration: 1.5,
			});
		});
	});

	describe('getDebugInfo', () => {
		test('should return debug information', () => {
			const timeObj = new TimeObject({
				startHour: '09:30',
				endHour: '11:15',
			});

			const debugInfo = timeObj.getDebugInfo();

			expect(debugInfo).toEqual({
				range: '09:30—11:15',
				startHour: 9.5,
				endHour: 11.25,
				duration: 1.75,
			});
		});
	});

	describe('Edge Cases', () => {
		test('should handle 24-hour format edge cases', () => {
			const timeObj = new TimeObject({
				startHour: '00:01',
				endHour: '23:59',
			});

			expect(timeObj.duration).toBeCloseTo(23.966666666666665, 5);
		});

		test('should handle same start and end time', () => {
			const timeObj = new TimeObject({
				startHour: '12:00',
				endHour: '12:00',
			});

			expect(timeObj.duration).toBe(0);
		});

		test('should handle fractional minutes correctly', () => {
			// Testing edge cases with seconds that round to different minutes
			const timeObj1 = new TimeObject({
				startHour: '09:00',
				endHour: '09:01',
			});
			const timeObj2 = new TimeObject({
				startHour: '09:00',
				endHour: '09:59',
			});

			expect(timeObj1.duration).toBeCloseTo(0.016666666666666666, 5);
			expect(timeObj2.duration).toBeCloseTo(0.9833333333333333, 5);
		});
	});
});
