import { createEventData } from '../src/blocks/calendar-button/utils/calendar-handler.js';

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

		describe('all-day event date handling', () => {
			it('should make end date inclusive for multi-day all-day events', () => {
				const attributes = {
					start: '2024-12-21T00:00:00Z',
					end: '2024-12-22T00:00:00Z',
					title: 'Multi-day Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				// Start date should remain unchanged
				expect(result.start).toEqual(new Date('2024-12-21T00:00:00Z'));
				// End date should be increased by 1 day to make it inclusive
				expect(result.end).toEqual(new Date('2024-12-23T00:00:00Z'));
				expect(result.allDay).toBe(true);
			});

			it('should not modify end date for single-day all-day events', () => {
				const attributes = {
					start: '2024-12-21T00:00:00Z',
					end: '2024-12-21T00:00:00Z',
					title: 'Single-day Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				// Both dates should remain unchanged for single-day events
				expect(result.start).toEqual(new Date('2024-12-21T00:00:00Z'));
				expect(result.end).toEqual(new Date('2024-12-21T00:00:00Z'));
				expect(result.allDay).toBe(true);
			});

			it('should not modify end date for timed events even if allDay is false', () => {
				const attributes = {
					start: '2024-12-21T10:00:00Z',
					end: '2024-12-22T11:00:00Z',
					title: 'Timed Event',
					allDay: false,
				};

				const result = createEventData(attributes);

				// Dates should remain unchanged for timed events
				expect(result.start).toEqual(new Date('2024-12-21T10:00:00Z'));
				expect(result.end).toEqual(new Date('2024-12-22T11:00:00Z'));
				expect(result.allDay).toBe(false);
			});

			it('should handle week-long all-day events correctly', () => {
				const attributes = {
					start: '2024-12-21T00:00:00Z',
					end: '2024-12-28T00:00:00Z',
					title: 'Week-long Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				// Start date should remain unchanged
				expect(result.start).toEqual(new Date('2024-12-21T00:00:00Z'));
				// End date should be increased by 1 day to include the 28th
				expect(result.end).toEqual(new Date('2024-12-29T00:00:00Z'));
				expect(result.allDay).toBe(true);
			});

			it('should handle all-day events with different time zones', () => {
				const attributes = {
					start: '2024-12-21T08:00:00+08:00',
					end: '2024-12-22T08:00:00+08:00',
					title: 'Timezone Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				expect(result.start).toEqual(
					new Date('2024-12-21T08:00:00+08:00')
				);
				// End date should be increased by 1 day
				expect(result.end).toEqual(
					new Date('2024-12-23T08:00:00+08:00')
				);
				expect(result.allDay).toBe(true);
			});

			it('should handle edge case where end is undefined for all-day event', () => {
				const attributes = {
					start: '2024-12-21T00:00:00Z',
					title: 'No End Date Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				expect(result.start).toEqual(new Date('2024-12-21T00:00:00Z'));
				expect(result.end).toBeUndefined();
				expect(result.allDay).toBe(true);
			});

			it('should handle edge case where start is undefined', () => {
				const attributes = {
					end: '2024-12-22T00:00:00Z',
					title: 'No Start Date Event',
					allDay: true,
				};

				const result = createEventData(attributes);

				expect(result.start).toBeUndefined();
				// End date should not be modified when start is missing
				expect(result.end).toEqual(new Date('2024-12-22T00:00:00Z'));
				expect(result.allDay).toBe(true);
			});
		});
	});
});
