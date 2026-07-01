/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('../../event-statistics/EventStatistics.js', () => {
	return function EventStatisticsMock({ eventDateId }) {
		return (
			<div data-testid="event-statistics">Stats for {eventDateId}</div>
		);
	};
});

// The tab is registered as a module side effect, and its `render` reads
// `statisticsUrl` from a module-level closure. Use a fresh module registry
// per scenario (including `@wordpress/hooks`) so each import sees its own
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

describe('statistics tab registration', () => {
	afterEach(() => {
		delete window.fairEventsManageEventData;
	});

	it('does not register the tab when statisticsUrl is absent', () => {
		const { applyFilters } = loadModuleWithData({});

		const tabs = applyFilters('fairEvents.manageEvent.tabs', []);
		expect(tabs).toHaveLength(0);
	});

	it('renders EventStatistics inline instead of navigating away', async () => {
		const { applyFilters } = loadModuleWithData({
			statisticsUrl:
				'admin.php?page=fair-events-event-statistics&event_date_id=',
		});

		const tabs = applyFilters('fairEvents.manageEvent.tabs', []);
		const statisticsTab = tabs.find((tab) => tab.name === 'statistics');
		expect(statisticsTab).toBeDefined();

		const originalHref = window.location.href;
		render(statisticsTab.render({ eventDateId: 42 }));

		expect(await screen.findByTestId('event-statistics')).toHaveTextContent(
			'Stats for 42'
		);
		expect(window.location.href).toBe(originalHref);
	});
});
