/**
 * Test suite for TimeColumn class
 */
import { TimeColumn } from '../src/models/TimeColumn.js';
import { TimeSlot } from '../src/models/TimeSlot.js';

describe('TimeColumn', () => {
	describe('Constructor', () => {
		test('should create TimeColumn with valid time range', () => {
			const timeColumn = new TimeColumn({
				startTime: '09:00',
				endTime: '17:00',
			});

			expect(timeColumn.getStartHour()).toBe(9);
			expect(timeColumn.getEndHour()).toBe(17);
			expect(timeColumn.timeSlots).toEqual([]);
		});

		test('should create TimeColumn with time slots array', () => {
			const timeSlotsData = [
				{ startTime: '09:00', endTime: '10:30' },
				{ startTime: '11:00', endTime: '12:00' },
			];

			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				timeSlotsData
			);

			expect(timeColumn.timeSlots).toHaveLength(2);
			expect(timeColumn.timeSlots[0]).toBeInstanceOf(TimeSlot);
			expect(timeColumn.timeSlots[1]).toBeInstanceOf(TimeSlot);
		});

		test('should handle existing TimeSlot instances in array', () => {
			const existingTimeSlot = new TimeSlot(
				{ startTime: '10:00', endTime: '11:00' },
				'09:00'
			);

			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[existingTimeSlot]
			);

			expect(timeColumn.timeSlots).toHaveLength(1);
			expect(timeColumn.timeSlots[0]).toBe(existingTimeSlot);
		});

		test('should handle mixed array of data and TimeSlot instances', () => {
			const existingTimeSlot = new TimeSlot(
				{ startTime: '10:00', endTime: '11:00' },
				'09:00'
			);
			const mixedArray = [
				{ startTime: '09:00', endTime: '10:00' },
				existingTimeSlot,
				{ startTime: '11:00', endTime: '12:00' },
			];

			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				mixedArray
			);

			expect(timeColumn.timeSlots).toHaveLength(3);
			expect(timeColumn.timeSlots[0]).toBeInstanceOf(TimeSlot);
			expect(timeColumn.timeSlots[1]).toBe(existingTimeSlot);
			expect(timeColumn.timeSlots[2]).toBeInstanceOf(TimeSlot);
		});
	});

	describe('HourlyRange delegation', () => {
		let timeColumn;

		beforeEach(() => {
			timeColumn = new TimeColumn({
				startTime: '09:30',
				endTime: '16:45',
			});
		});

		test('should delegate getStartHour to HourlyRange', () => {
			expect(timeColumn.getStartHour()).toBe(9.5);
		});

		test('should delegate getEndHour to HourlyRange', () => {
			expect(timeColumn.getEndHour()).toBe(16.75);
		});

		test('should delegate getDuration to HourlyRange', () => {
			expect(timeColumn.getDuration()).toBe(7.25);
		});

		test('should delegate getStartTime to HourlyRange', () => {
			expect(timeColumn.getStartTime()).toBe('09:30');
		});

		test('should delegate getEndTime to HourlyRange', () => {
			expect(timeColumn.getEndTime()).toBe('16:45');
		});

		test('should delegate getTimeRangeString to HourlyRange', () => {
			expect(timeColumn.getTimeRangeString()).toBe('09:30—16:45');
		});
	});

	describe('Cross-midnight scenarios', () => {
		test('should handle cross-midnight time column', () => {
			const timeColumn = new TimeColumn({
				startTime: '22:00',
				endTime: '06:00',
			});

			expect(timeColumn.getStartHour()).toBe(22);
			expect(timeColumn.getEndHour()).toBe(6);
			expect(timeColumn.getDuration()).toBe(8); // 22:00 to 06:00 = 8 hours
		});

		test('should create time slots with correct timetable start for cross-midnight', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '23:00',
					endTime: '07:00',
				},
				[{ startTime: '00:30', endTime: '02:00' }]
			);

			const timeSlot = timeColumn.timeSlots[0];
			expect(timeSlot.timetableStartTime).toBe('23:00');
			expect(timeSlot.getTimeFromTimetableStart()).toBe(1.5); // 00:30 is 1.5 hours after 23:00
		});
	});

	describe('TimeSlot timetable start time', () => {
		test('should set column start time as timetable start for new time slots', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '10:15',
					endTime: '18:30',
				},
				[
					{ startTime: '11:00', endTime: '12:30' },
					{ startTime: '14:00', endTime: '15:00' },
				]
			);

			timeColumn.timeSlots.forEach((timeSlot) => {
				expect(timeSlot.timetableStartTime).toBe('10:15');
			});
		});

		test('should preserve existing TimeSlot timetable start time', () => {
			const existingTimeSlot = new TimeSlot(
				{ startTime: '11:00', endTime: '12:00' },
				'08:00' // Different timetable start
			);

			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[existingTimeSlot]
			);

			// Should preserve the original timetable start time
			expect(timeColumn.timeSlots[0].timetableStartTime).toBe('08:00');
		});
	});

	describe('Edge cases', () => {
		test('should handle empty time slots array', () => {
			const timeColumn = new TimeColumn({
				startTime: '09:00',
				endTime: '17:00',
			});

			expect(timeColumn.timeSlots).toEqual([]);
			expect(timeColumn.getDuration()).toBe(8);
		});

		test('should handle midnight times', () => {
			const timeColumn = new TimeColumn({
				startTime: '00:00',
				endTime: '23:59',
			});

			expect(timeColumn.getStartHour()).toBe(0);
			expect(timeColumn.getEndHour()).toBeCloseTo(23.983333333333334, 5);
		});

		test('should work with fractional hours', () => {
			const timeColumn = new TimeColumn({
				startTime: '09:15',
				endTime: '17:45',
			});

			expect(timeColumn.getStartHour()).toBe(9.25);
			expect(timeColumn.getEndHour()).toBe(17.75);
			expect(timeColumn.getDuration()).toBe(8.5);
		});
	});

	describe('getFirstAvailableHour', () => {
		test('should return startHour when no time slots exist', () => {
			const timeColumn = new TimeColumn({
				startTime: '09:00',
				endTime: '17:00',
			});

			expect(timeColumn.getFirstAvailableHour()).toBe(9);
		});

		test('should return startHour with fractional hours when no time slots exist', () => {
			const timeColumn = new TimeColumn({
				startTime: '09:30',
				endTime: '17:45',
			});

			expect(timeColumn.getFirstAvailableHour()).toBe(9.5);
		});

		test('should return latest endHour when time slots exist', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[
					{ startTime: '09:00', endTime: '10:30' },
					{ startTime: '11:00', endTime: '12:00' },
					{ startTime: '13:00', endTime: '14:15' },
				]
			);

			// Latest end time is 14:15 = 14.25 hours
			expect(timeColumn.getFirstAvailableHour()).toBe(14.25);
		});

		test('should handle single time slot', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[{ startTime: '10:00', endTime: '11:30' }]
			);

			expect(timeColumn.getFirstAvailableHour()).toBe(11.5);
		});

		test('should handle time slots with fractional hours', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '08:15',
					endTime: '18:45',
				},
				[
					{ startTime: '09:30', endTime: '10:45' },
					{ startTime: '12:15', endTime: '13:30' },
					{ startTime: '15:00', endTime: '16:45' },
				]
			);

			// Latest end time is 16:45 = 16.75 hours
			expect(timeColumn.getFirstAvailableHour()).toBe(16.75);
		});

		test('should handle unordered time slots', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[
					{ startTime: '13:00', endTime: '14:00' }, // Not the latest
					{ startTime: '09:00', endTime: '10:30' }, // Not the latest
					{ startTime: '11:00', endTime: '12:15' }, // Latest end time
				]
			);

			// Latest end time is 14:00 = 14 hours (not 12:15)
			expect(timeColumn.getFirstAvailableHour()).toBe(14);
		});

		test('should handle cross-midnight scenarios', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '22:00',
					endTime: '06:00',
				},
				[
					{ startTime: '23:00', endTime: '01:30' },
					{ startTime: '02:00', endTime: '03:45' },
				]
			);

			// Latest end time is 03:45 = 3.75 hours
			expect(timeColumn.getFirstAvailableHour()).toBe(3.75);
		});

		test('should handle overlapping time slots', () => {
			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[
					{ startTime: '10:00', endTime: '12:00' },
					{ startTime: '11:00', endTime: '13:30' }, // Overlaps and extends later
					{ startTime: '14:00', endTime: '15:00' },
				]
			);

			// Latest end time is 15:00 = 15 hours
			expect(timeColumn.getFirstAvailableHour()).toBe(15);
		});

		test('should work with existing TimeSlot instances', () => {
			const existingTimeSlot = new TimeSlot(
				{ startTime: '11:00', endTime: '12:45' },
				'09:00'
			);

			const timeColumn = new TimeColumn(
				{
					startTime: '09:00',
					endTime: '17:00',
				},
				[{ startTime: '09:30', endTime: '10:15' }, existingTimeSlot]
			);

			// Latest end time is 12:45 = 12.75 hours
			expect(timeColumn.getFirstAvailableHour()).toBe(12.75);
		});
	});
});
