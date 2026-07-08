/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';

// `render` is never invoked in these tests (they only assert on the tab
// descriptor's `disabled` flag), so the mocked components are unused stubs.
jest.mock('../EventAudience.js', () => () => null);
jest.mock('../GroupRules.js', () => () => null);
jest.mock('../EventMailings.js', () => () => null);

// The tabs are registered as module side effects reading module-level
// closures (audienceUrl). Use a fresh module registry per scenario
// (including `@wordpress/hooks`) so each import sees its own
// `window.fairEventsManageEventData` and its own filter store.
function loadModuleWithData(data) {
	let hooks;
	jest.isolateModules(() => {
		window.fairEventsManageEventData = data;
		hooks = require('@wordpress/hooks');
		require('../index.js');
	});
	return hooks;
}

describe('audience/groups/mailings tab registration', () => {
	afterEach(() => {
		delete window.fairEventsManageEventData;
	});

	const eventDate = { event_id: 1, start_datetime: '', end_datetime: '' };

	it('disables Audience, Groups, and Mailings tabs for external-URL events', () => {
		const { applyFilters } = loadModuleWithData({
			audienceUrl: 'http://example.com/audience/',
		});

		const ctx = {
			eventDate: { ...eventDate, link_type: 'external' },
			eventDateId: 1,
			eventTitle: 'Test Event',
			enabledFeatures: { ticketing: true, mailings: true },
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'audience').disabled).toBe(true);
		expect(tabs.find((t) => t.name === 'groups').disabled).toBe(true);
		expect(tabs.find((t) => t.name === 'mailings').disabled).toBe(true);
	});

	it('keeps Audience, Groups, and Mailings tabs enabled for post-linked events', () => {
		const { applyFilters } = loadModuleWithData({
			audienceUrl: 'http://example.com/audience/',
		});

		const ctx = {
			eventDate: { ...eventDate, link_type: 'post' },
			eventDateId: 1,
			eventTitle: 'Test Event',
			enabledFeatures: { ticketing: true, mailings: true },
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'audience').disabled).toBeFalsy();
		expect(tabs.find((t) => t.name === 'groups').disabled).toBeFalsy();
		expect(tabs.find((t) => t.name === 'mailings').disabled).toBeFalsy();
	});

	it('still disables Groups for generated occurrences regardless of link type', () => {
		const { applyFilters } = loadModuleWithData({
			audienceUrl: 'http://example.com/audience/',
		});

		const ctx = {
			eventDate: {
				...eventDate,
				link_type: 'post',
				occurrence_type: 'generated',
			},
			eventDateId: 1,
			eventTitle: 'Test Event',
			enabledFeatures: { ticketing: true, mailings: true },
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'groups').disabled).toBe(true);
	});
});
