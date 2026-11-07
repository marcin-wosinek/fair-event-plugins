/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import StatisticsPage from '../StatisticsPage.js';

jest.mock( '../EventStatistics.js', () => {
	return function MockEventStatistics( { eventDateId } ) {
		return <div>Statistics for { eventDateId }</div>;
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

		expect( screen.getByText( 'Statistics for 42' ) ).toBeInTheDocument();
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
} );
