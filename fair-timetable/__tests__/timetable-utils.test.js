/**
 * Test suite for timetable-column utilities
 */

describe('Timetable Column Utils', () => {
	test('should have correct block names', () => {
		const timeSlotName = 'fair-timetable/time-slot';
		const columnBlockName = 'fair-timetable/timetable-column';

		expect(timeSlotName).toBe('fair-timetable/time-slot');
		expect(columnBlockName).toBe('fair-timetable/timetable-column');
	});

	test('should validate column title', () => {
		const validateTitle = (title) => {
			return typeof title === 'string' && title.trim().length > 0;
		};

		expect(validateTitle('Main Stage')).toBe(true);
		expect(validateTitle('Workshop Room A')).toBe(true);
		expect(validateTitle('')).toBe(false);
		expect(validateTitle('   ')).toBe(false);
		expect(validateTitle(null)).toBe(false);
	});

	test('should sort timetable items by time', () => {
		const sortByTime = (items) => {
			return items.sort((a, b) => {
				const timeA = a.time || '00:00';
				const timeB = b.time || '00:00';
				return timeA.localeCompare(timeB);
			});
		};

		const unsortedItems = [
			{ title: 'Lunch', time: '12:00' },
			{ title: 'Opening', time: '09:00' },
			{ title: 'Keynote', time: '10:00' },
		];

		const sortedItems = sortByTime([...unsortedItems]);

		expect(sortedItems[0].time).toBe('09:00');
		expect(sortedItems[1].time).toBe('10:00');
		expect(sortedItems[2].time).toBe('12:00');
	});
});
