/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StatisticsPage from '../StatisticsPage.js';

jest.mock( '../EventStatistics.js', () => {
	return function MockEventStatistics( { eventDateId, showEventHeading } ) {
		return (
			<div>
				Statistics for { eventDateId }
				{ showEventHeading ? ' with heading' : '' }
			</div>
		);
	};
} );

describe( 'StatisticsPage', () => {
	it( 'renders the statistics when they are available', () => {
		render(
			<StatisticsPage
				eventDateId={ 42 }
				statisticsAvailable
				manageEventUrl="http://example.com/wp-admin/admin.php?page=fair-events-manage-event"
			/>
		);

		expect( screen.getByText( /Statistics for 42/ ) ).toBeInTheDocument();
	} );

	it( 'explains how to make statistics available instead of loading charts', () => {
		render(
			<StatisticsPage
				eventDateId={ 42 }
				statisticsAvailable={ false }
				manageEventUrl="http://example.com/wp-admin/admin.php?page=fair-events-manage-event"
				paymentHistoryUrl="http://example.com/wp-admin/admin.php?page=fair-events-payment-history"
			/>
		);

		expect(
			screen.getByText( /Event statistics aren’t available yet/, {
				selector: 'p',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Open Payment history' } )
		).toHaveAttribute(
			'href',
			'http://example.com/wp-admin/admin.php?page=fair-events-payment-history'
		);
		expect(
			screen.getByRole( 'link', { name: 'Back to Manage Event' } )
		).toHaveAttribute(
			'href',
			'http://example.com/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42'
		);
		expect(
			screen.queryByText( /Statistics for/ )
		).not.toBeInTheDocument();
	} );

	it( 'wraps the statistics in a titled admin page with a way back', () => {
		const { container } = render(
			<StatisticsPage
				eventDateId={ 42 }
				statisticsAvailable
				manageEventUrl="http://example.com/wp-admin/admin.php?page=fair-events-manage-event"
			/>
		);

		expect( container.firstChild ).toHaveClass( 'wrap' );
		expect(
			screen.getByRole( 'heading', {
				level: 1,
				name: 'Event Statistics',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Back to Manage Event' } )
		).toHaveAttribute(
			'href',
			'http://example.com/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42'
		);
		expect(
			screen.getByText( 'Statistics for 42 with heading' )
		).toBeInTheDocument();
	} );

	it( 'explains a bookmark without an event instead of a blank page', () => {
		render(
			<StatisticsPage
				eventDateId={ 0 }
				statisticsAvailable
				manageEventUrl="http://example.com/wp-admin/admin.php?page=fair-events-manage-event"
				allEventsUrl="http://example.com/wp-admin/admin.php?page=fair-events-all-events"
			/>
		);

		expect(
			screen.getByText( /No event is selected/, { selector: 'p' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Go to All Events' } )
		).toHaveAttribute(
			'href',
			'http://example.com/wp-admin/admin.php?page=fair-events-all-events'
		);
		expect(
			screen.queryByRole( 'link', { name: 'Back to Manage Event' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( /Statistics for/ )
		).not.toBeInTheDocument();
	} );
} );
