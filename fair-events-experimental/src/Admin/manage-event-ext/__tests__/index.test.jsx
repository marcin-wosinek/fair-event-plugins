/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';

// The module registers its filters as an import side effect and reads its
// URLs once, so the localized data must exist before it loads. It includes
// the statistics keys older fair-events versions localized, which must no
// longer add a tab here.
beforeAll( () => {
	window.fairEventsManageEventData = {
		statisticsUrl:
			'admin.php?page=fair-events-event-statistics&event_date_id=',
		statisticsAvailable: true,
		duplicateEventUrl:
			'admin.php?page=fair-events-duplicate-event&event_date_id=',
		mergeEventUrl: 'admin.php?page=fair-events-merge-event&event_date_id=',
	};
	require( '../index.js' );
} );

afterAll( () => {
	delete window.fairEventsManageEventData;
} );

describe( 'manage-event extensions', () => {
	it( 'leaves the Statistics tab to fair-events', () => {
		const builtIn = [ { name: 'statistics', order: 60 } ];
		expect(
			applyFilters( 'fairEvents.manageEvent.tabs', builtIn, {} )
		).toBe( builtIn );
	} );

	it( 'adds the Duplicate and Merge admin actions', () => {
		const actions = applyFilters(
			'fairEvents.manageEvent.adminActions',
			[],
			{
				eventDateId: 42,
			}
		);
		render( <div>{ actions }</div> );

		expect(
			screen.getByRole( 'link', { name: 'Duplicate Event' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-duplicate-event&event_date_id=42'
		);
		expect(
			screen.getByRole( 'link', { name: 'Merge Event' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-merge-event&event_date_id=42'
		);
	} );
} );
