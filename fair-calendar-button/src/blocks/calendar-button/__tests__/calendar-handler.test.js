import { createEventData } from '../utils/calendar-handler.js';

describe('calendar-handler', () => {
	describe('createEventData', () => {
		it('should convert block attributes to event data', () => {
			const attributes = {
				start: '2024-12-01T10:00:00Z',
				end: '2024-12-01T11:00:00Z',
				title: 'Test Event',
				description: 'Test description',
				location: 'Test location',
				allDay: true,
				recurring: false,
			};

			const result = createEventData(attributes);

			expect(result.start).toBeInstanceOf(Date);
			expect(result.end).toBeInstanceOf(Date);
			expect(result.title).toBe('Test Event');
			expect(result.description).toBe('Test description');
			expect(result.location).toBe('Test location');
			expect(result.allDay).toBe(true);
		});
	});
});
