import { getEventDisplayTitle, isLinkOnlyEvent } from '../event-utils.js';

describe('getEventDisplayTitle', () => {
	test('returns the trimmed title when present', () => {
		expect(getEventDisplayTitle('  My Event  ')).toBe('My Event');
	});

	test('falls back for an empty title', () => {
		expect(getEventDisplayTitle('')).toBe('(untitled event)');
	});

	test('falls back for a whitespace-only title', () => {
		expect(getEventDisplayTitle('   ')).toBe('(untitled event)');
	});

	test('falls back for a null or undefined title', () => {
		expect(getEventDisplayTitle(null)).toBe('(untitled event)');
		expect(getEventDisplayTitle(undefined)).toBe('(untitled event)');
	});
});

describe('isLinkOnlyEvent', () => {
	test('true when link_type is external', () => {
		expect(isLinkOnlyEvent({ link_type: 'external' })).toBe(true);
	});

	test('false otherwise', () => {
		expect(isLinkOnlyEvent({ link_type: 'post' })).toBe(false);
		expect(isLinkOnlyEvent(undefined)).toBe(false);
	});
});
