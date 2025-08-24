/**
 * Test suite for time-block utilities
 */
import { format } from 'date-fns';

describe('Time Block Utils', () => {
	test('should format time correctly', () => {
		const formatTime = (timeString) => {
			const [hours, minutes] = timeString.split(':');
			const date = new Date();
			date.setHours(parseInt(hours), parseInt(minutes));
			return format(date, 'h:mm a');
		};

		expect(formatTime('14:30')).toBe('2:30 PM');
		expect(formatTime('09:00')).toBe('9:00 AM');
		expect(formatTime('12:00')).toBe('12:00 PM');
	});

	test('should validate time format', () => {
		const isValidTimeFormat = (timeString) => {
			const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
			return timeRegex.test(timeString);
		};

		expect(isValidTimeFormat('14:30')).toBe(true);
		expect(isValidTimeFormat('09:00')).toBe(true);
		expect(isValidTimeFormat('25:00')).toBe(false);
		expect(isValidTimeFormat('14:65')).toBe(false);
		expect(isValidTimeFormat('invalid')).toBe(false);
	});

	test('should calculate duration in minutes', () => {
		const calculateDuration = (startTime, endTime) => {
			const [startHours, startMinutes] = startTime.split(':').map(Number);
			const [endHours, endMinutes] = endTime.split(':').map(Number);

			const startTotalMinutes = startHours * 60 + startMinutes;
			const endTotalMinutes = endHours * 60 + endMinutes;

			return endTotalMinutes - startTotalMinutes;
		};

		expect(calculateDuration('09:00', '10:30')).toBe(90);
		expect(calculateDuration('14:30', '15:00')).toBe(30);
		expect(calculateDuration('23:00', '23:59')).toBe(59);
	});
});
