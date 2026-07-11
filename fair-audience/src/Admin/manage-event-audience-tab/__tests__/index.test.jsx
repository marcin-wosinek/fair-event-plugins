/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';

// `render` is never invoked in these tests (they only assert on the tab
// descriptor's `disabled` flag), so the mocked component is an unused stub.
jest.mock('../EventAudience.js', () => () => null);

// The tab is registered as a module side effect reading a module-level
// closure (audienceUrl). Use a fresh module registry per scenario
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

describe('audience tab registration', () => {
	afterEach(() => {
		delete window.fairEventsManageEventData;
	});

	const eventDate = { event_id: 1, start_datetime: '', end_datetime: '' };

	it('disables the Audience tab for external-URL events', () => {
		const { applyFilters } = loadModuleWithData({
			audienceUrl: 'http://example.com/audience/',
		});

		const ctx = {
			eventDate: { ...eventDate, link_type: 'external' },
			eventDateId: 1,
			eventTitle: 'Test Event',
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'audience').disabled).toBe(true);
	});

	it('keeps the Audience tab enabled for post-linked events', () => {
		const { applyFilters } = loadModuleWithData({
			audienceUrl: 'http://example.com/audience/',
		});

		const ctx = {
			eventDate: { ...eventDate, link_type: 'post' },
			eventDateId: 1,
			eventTitle: 'Test Event',
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'audience').disabled).toBeFalsy();
	});

	it('does not register the tab when audienceUrl is absent', () => {
		const { applyFilters } = loadModuleWithData({});

		const ctx = {
			eventDate,
			eventDateId: 1,
			eventTitle: 'Test Event',
		};

		const tabs = applyFilters('fairEvents.manageEvent.tabs', [], ctx);

		expect(tabs.find((t) => t.name === 'audience')).toBeUndefined();
	});
});
