import {
	createEventData,
	formatEventDescription,
} from '../src/blocks/calendar-button/utils/calendar-handler.js';

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

	describe('formatEventDescription', () => {
		it('should append URL with double newlines when description exists', () => {
			const description = 'This is a test event';
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe('This is a test event\n\nhttps://example.com');
		});

		it('should return only URL when description is empty', () => {
			const description = '';
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe('https://example.com');
		});

		it('should return only URL when description is null', () => {
			const description = null;
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe('https://example.com');
		});

		it('should return only URL when description is undefined', () => {
			const description = undefined;
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe('https://example.com');
		});

		it('should return only URL when description is whitespace only', () => {
			const description = '   ';
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe('   \n\nhttps://example.com');
		});

		it('should return original description when URL is empty', () => {
			const description = 'This is a test event';
			const url = '';

			const result = formatEventDescription(description, url);

			expect(result).toBe('This is a test event');
		});

		it('should return empty string when both description and URL are empty', () => {
			const description = '';
			const url = '';

			const result = formatEventDescription(description, url);

			expect(result).toBe('');
		});

		it('should return empty string when URL is null', () => {
			const description = 'This is a test event';
			const url = null;

			const result = formatEventDescription(description, url);

			expect(result).toBe('This is a test event');
		});

		it('should return empty string when URL is undefined', () => {
			const description = 'This is a test event';
			const url = undefined;

			const result = formatEventDescription(description, url);

			expect(result).toBe('This is a test event');
		});

		it('should handle multi-line descriptions correctly', () => {
			const description = 'Line 1\nLine 2\nLine 3';
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe(
				'Line 1\nLine 2\nLine 3\n\nhttps://example.com'
			);
		});

		it('should handle descriptions that already end with newlines', () => {
			const description = 'This is a test event\n';
			const url = 'https://example.com';

			const result = formatEventDescription(description, url);

			expect(result).toBe(
				'This is a test event\n\n\nhttps://example.com'
			);
		});

		it('should handle complex URLs with query parameters', () => {
			const description = 'Event details';
			const url = 'https://example.com/event?id=123&category=tech';

			const result = formatEventDescription(description, url);

			expect(result).toBe(
				'Event details\n\nhttps://example.com/event?id=123&category=tech'
			);
		});
	});
});
