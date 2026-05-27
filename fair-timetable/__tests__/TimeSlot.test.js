/**
 * Test suite for TimeSlot class
 */
import { TimeSlot } from '../src/models/TimeSlot.js';

describe('TimeSlot', () => {
	describe('Constructor', () => {
		test('should create TimeSlot with valid inputs', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '10:30',
					endTime: '12:00',
				},
				'09:00'
			);

			expect(timeSlot.startHour).toBe(10.5);
			expect(timeSlot.endHour).toBe(12);
			expect(timeSlot.timetableStartTime).toBe('09:00');
			expect(timeSlot.timetableStartHour).toBe(9);
		});

		test('should use default timetable start time when not provided', () => {
			const timeSlot = new TimeSlot({
				startTime: '10:30',
				endTime: '12:00',
			});

			expect(timeSlot.timetableStartTime).toBe('09:00');
			expect(timeSlot.timetableStartHour).toBe(9);
		});

		test('should handle midnight times', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '00:00',
					endTime: '01:30',
				},
				'23:00'
			);

			expect(timeSlot.startHour).toBe(0);
			expect(timeSlot.endHour).toBe(1.5);
			expect(timeSlot.timetableStartHour).toBe(23);
		});
	});

	describe('Time range delegation', () => {
		test('should delegate getDuration to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:30',
			});

			expect(timeSlot.getDuration()).toBe(2.5);
		});

		test('should delegate getTimeRangeString to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:30',
				endTime: '11:15',
			});

			expect(timeSlot.getTimeRangeString()).toBe('09:30—11:15');
		});

		test('should delegate getStartTime to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:30',
				endTime: '12:00',
			});

			expect(timeSlot.getStartTime()).toBe('09:30');
		});

		test('should delegate getEndTime to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '12:30',
			});

			expect(timeSlot.getEndTime()).toBe('12:30');
		});
	});

	describe('Setter methods', () => {
		test('should delegate setStartTime to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:30',
			});

			timeSlot.setStartTime('10:15');

			expect(timeSlot.startHour).toBe(10.25);
			expect(timeSlot.endHour).toBe(12.75);
			expect(timeSlot.getDuration()).toBe(2.5);
		});

		test('should delegate setDuration to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:30',
			});

			timeSlot.setDuration(3.5);

			expect(timeSlot.startHour).toBe(9);
			expect(timeSlot.endHour).toBe(12.5);
			expect(timeSlot.getDuration()).toBe(3.5);
		});

		test('should delegate setEndTime to HourlyRange', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:30',
			});

			timeSlot.setEndTime('13:45');

			expect(timeSlot.startHour).toBe(9);
			expect(timeSlot.endHour).toBe(13.75);
			expect(timeSlot.getDuration()).toBe(4.75);
		});
	});

	describe('getTimeFromTimetableStart', () => {
		test('should return 0 when slot starts at same time as timetable', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '09:00',
					endTime: '10:00',
				},
				'09:00'
			);

			expect(timeSlot.getTimeFromTimetableStart()).toBe(0);
		});

		test('should calculate correct time when slot starts after timetable', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '11:30',
					endTime: '13:00',
				},
				'09:00'
			);

			expect(timeSlot.getTimeFromTimetableStart()).toBe(2.5);
		});

		test('should handle next day scenario when slot starts before timetable', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '08:00',
					endTime: '09:30',
				},
				'09:00'
			);

			// 8 - 9 + 24 = 23 hours
			expect(timeSlot.getTimeFromTimetableStart()).toBe(23);
		});

		test('should handle fractional hours correctly', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '14:45',
					endTime: '16:00',
				},
				'09:15'
			);

			// 14.75 - 9.25 = 5.5 hours
			expect(timeSlot.getTimeFromTimetableStart()).toBe(5.5);
		});

		test('should handle cross-midnight scenarios', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '23:30',
					endTime: '01:00',
				},
				'08:00'
			);

			// 23.5 - 8 = 15.5 hours
			expect(timeSlot.getTimeFromTimetableStart()).toBe(15.5);
		});

		test('should handle early morning slot with late timetable start', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '00:30',
					endTime: '02:00',
				},
				'10:00'
			);

			// 0.5 - 10 + 24 = 14.5 hours
			expect(timeSlot.getTimeFromTimetableStart()).toBe(14.5);
		});
	});

	describe('setTimetableStartTime', () => {
		test('should update timetable start time and recalculate', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '11:00',
					endTime: '12:00',
				},
				'09:00'
			);

			expect(timeSlot.getTimeFromTimetableStart()).toBe(2);

			timeSlot.setTimetableStartTime('10:00');

			expect(timeSlot.timetableStartTime).toBe('10:00');
			expect(timeSlot.timetableStartHour).toBe(10);
			expect(timeSlot.getTimeFromTimetableStart()).toBe(1);
		});

		test('should handle setting timetable start to midnight', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '01:00',
					endTime: '02:00',
				},
				'09:00'
			);

			timeSlot.setTimetableStartTime('00:00');

			expect(timeSlot.timetableStartHour).toBe(0);
			expect(timeSlot.getTimeFromTimetableStart()).toBe(1);
		});

		test('should handle invalid timetable start time gracefully', () => {
			const timeSlot = new TimeSlot(
				{
					startTime: '11:00',
					endTime: '12:00',
				},
				'09:00'
			);

			timeSlot.setTimetableStartTime('invalid');

			expect(timeSlot.timetableStartTime).toBe('invalid');
			expect(timeSlot.timetableStartHour).toBe(0);
		});
	});

	describe('Property getters', () => {
		test('should provide access to startHour and endHour', () => {
			const timeSlot = new TimeSlot({
				startTime: '14:15',
				endTime: '16:45',
			});

			expect(timeSlot.startHour).toBe(14.25);
			expect(timeSlot.endHour).toBe(16.75);
		});

		test('should reflect changes when time range is modified', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:00',
			});

			timeSlot.setStartTime('10:30');

			expect(timeSlot.startHour).toBe(10.5);
			expect(timeSlot.endHour).toBe(12.5);
		});
	});

	describe('Integration with HourlyRange', () => {
		test('should maintain consistency with HourlyRange behavior', () => {
			const timeSlot = new TimeSlot({
				startTime: '09:00',
				endTime: '11:30',
			});

			// Test cross-midnight duration calculation
			timeSlot.setEndTime('01:00');
			expect(timeSlot.getDuration()).toBe(16); // 9:00 to 1:00 next day

			// Test duration preservation with start time change
			timeSlot.setStartTime('22:00');
			expect(timeSlot.getDuration()).toBe(16); // Duration should remain the same
			expect(timeSlot.getEndTime()).toBe('14:00'); // 22:00 + 16 hours = 14:00 next day
		});
	});
});
