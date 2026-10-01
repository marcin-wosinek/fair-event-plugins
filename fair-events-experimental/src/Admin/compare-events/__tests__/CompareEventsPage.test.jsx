/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { downloadElementAsPng } from 'fair-events/src/Admin/event-statistics/exportChartImage.js';
import CompareEventsPage from '../CompareEventsPage.js';

jest.mock( '@wordpress/api-fetch' );

// Image generation is covered in fair-events; here we only care which card is
// captured and under which filename.
jest.mock(
	'fair-events/src/Admin/event-statistics/exportChartImage.js',
	() => ( {
		...jest.requireActual(
			'fair-events/src/Admin/event-statistics/exportChartImage.js'
		),
		downloadElementAsPng: jest.fn(),
	} )
);

// recharts needs a sized container that jsdom doesn't provide. Stub the chart
// primitives so the tests can read the data and series each chart was given.
jest.mock( 'recharts', () => {
	const Passthrough = ( { children } ) => <div>{ children }</div>;
	const LineChart = ( { children, data } ) => (
		<div data-testid="line-chart" data-rows={ JSON.stringify( data ) }>
			{ children }
		</div>
	);
	const Line = ( props ) => (
		<div
			data-testid={ `${ props.dataKey }-line` }
			data-props={ JSON.stringify( props ) }
		/>
	);
	const ReferenceLine = ( props ) => (
		<div
			data-testid="future-reference-line"
			data-props={ JSON.stringify( props ) }
		/>
	);
	const Empty = () => null;
	return {
		ResponsiveContainer: Passthrough,
		LineChart,
		Line,
		ReferenceLine,
		XAxis: Empty,
		YAxis: Empty,
		Tooltip: Empty,
		CartesianGrid: Empty,
	};
} );

const PAGE = '/wp-admin/admin.php?page=fair-events-compare-events';
const LIST_PATH = '/fair-events/v1/event-dates/all';

const EVENTS = {
	5: {
		id: 5,
		title: 'Spring Ball',
		start_datetime: '2026-03-03 20:00:00',
		all_day: false,
		status: 'active',
	},
	7: {
		id: 7,
		title: 'Autumn Ball',
		start_datetime: '2026-09-10 20:00:00',
		all_day: false,
		status: 'active',
	},
	8: {
		id: 8,
		title: 'Winter Ball',
		start_datetime: '2026-12-05 20:00:00',
		all_day: false,
		status: 'active',
	},
	// Not part of the list the selectors load.
	99: {
		id: 99,
		title: 'Archive Gala',
		start_datetime: '2019-01-19 19:00:00',
		all_day: false,
		status: 'active',
	},
};

const LABELS = {
	5: 'Spring Ball — March 3, 2026 8:00 pm',
	7: 'Autumn Ball — September 10, 2026 8:00 pm',
	8: 'Winter Ball — December 5, 2026 8:00 pm',
	99: 'Archive Gala — January 19, 2019 7:00 pm',
};

function buildStatistics( overrides = {} ) {
	return {
		event_name: 'Event',
		total_tickets: 4,
		total_sales: 4,
		currency: 'EUR',
		total_sales_amount: 80,
		excluded_currencies: [],
		incomplete_ticket_backfills: 0,
		start_date: '2026-03-03',
		end_date: '2026-03-03',
		days_until_start: null,
		series: [
			{ date: '2026-03-01', label: '2 days before', total: 0 },
			{ date: '2026-03-02', label: '1 day before', total: 1 },
			{ date: '2026-03-03', label: 'Day of the event', total: 4 },
		],
		amount_series: [
			{ date: '2026-03-01', label: '2 days before', amount: 0 },
			{ date: '2026-03-02', label: '1 day before', amount: 20 },
			{ date: '2026-03-03', label: 'Day of the event', amount: 80 },
		],
		...overrides,
	};
}

// An event still to come: its last two days have no recorded value.
const UPCOMING = {
	total_tickets: 2,
	total_sales: 2,
	total_sales_amount: 50,
	start_date: '2026-09-10',
	end_date: '2026-09-10',
	days_until_start: 1,
	series: [
		{ date: '2026-09-08', label: '2 days before', total: 2 },
		{ date: '2026-09-09', label: '1 day before', total: null },
		{ date: '2026-09-10', label: 'Day of the event', total: null },
	],
	amount_series: [
		{ date: '2026-09-08', label: '2 days before', amount: 50 },
		{ date: '2026-09-09', label: '1 day before', amount: null },
		{ date: '2026-09-10', label: 'Day of the event', amount: null },
	],
};

let statistics;
let overrides;

function notFound() {
	return Promise.reject( {
		code: 'rest_event_date_not_found',
		message: 'Event date not found.',
		data: { status: 404 },
	} );
}

function mockApi() {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( overrides[ path ] ) {
			return overrides[ path ]();
		}
		if ( path.startsWith( LIST_PATH ) ) {
			return Promise.resolve( [ EVENTS[ 8 ], EVENTS[ 7 ], EVENTS[ 5 ] ] );
		}
		const [ , id, isStatistics ] = path.match(
			/^\/fair-events\/v1\/event-dates\/(\d+)(\/statistics)?$/
		);
		if ( isStatistics ) {
			return Promise.resolve( statistics[ id ] );
		}
		return EVENTS[ id ] ? Promise.resolve( EVENTS[ id ] ) : notFound();
	} );
}

function open( query = '' ) {
	window.history.replaceState( null, '', `${ PAGE }${ query }` );
	return render( <CompareEventsPage statisticsAvailable /> );
}

function requestsTo( path ) {
	return apiFetch.mock.calls.filter(
		( [ options ] ) => options.path === path
	).length;
}

function getChartCard( title ) {
	return screen
		.getByRole( 'heading', { name: title } )
		.closest( '.fair-compare-events__chart-card' );
}

function getRows( title ) {
	return JSON.parse(
		within( getChartCard( title ) ).getByTestId( 'line-chart' ).dataset.rows
	);
}

async function choose( label, optionName ) {
	const input = screen.getByRole( 'combobox', { name: label } );
	fireEvent.focus( input );
	const option = await screen.findByRole( 'option', { name: optionName } );
	// Let the lookup the selection starts settle inside act().
	await act( async () => {
		fireEvent.click( option );
	} );
	await waitFor( () => expect( input ).toHaveValue( optionName ) );
}

describe( 'CompareEventsPage', () => {
	beforeAll( () => {
		// The open dropdown scrolls its selected option into view, which
		// jsdom does not implement.
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
	} );

	beforeEach( () => {
		jest.resetAllMocks();
		statistics = {
			5: buildStatistics(),
			7: buildStatistics( UPCOMING ),
			8: buildStatistics( { total_tickets: 9, total_sales: 9 } ),
			99: buildStatistics(),
		};
		overrides = {};
		mockApi();
		window.fairEventsCompareEventsData = {
			manageEventUrl: '/wp-admin/admin.php?page=fair-events-manage-event',
		};
	} );

	it( 'explains the missing Fair Audience dependency instead of loading charts', () => {
		window.history.replaceState(
			null,
			'',
			`${ PAGE }&current_event_date_id=5&comparison_event_date_id=7`
		);
		render( <CompareEventsPage statisticsAvailable={ false } /> );

		expect(
			screen.getAllByText(
				/Comparing events needs the Fair Audience plugin/
			).length
		).toBeGreaterThan( 0 );
		expect( screen.queryByRole( 'combobox' ) ).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'asks for both events when nothing is selected', async () => {
		open();

		expect(
			screen.getAllByText(
				'Choose a current event and a comparison event to compare their sales.'
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getByRole( 'combobox', { name: 'Current event' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'combobox', { name: 'Comparison event' } )
		).toBeInTheDocument();
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toContain( LIST_PATH );
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
	} );

	it( 'asks for the missing event when only one is selected', async () => {
		open( '&current_event_date_id=5' );

		expect(
			screen.getAllByText(
				'Choose a comparison event to compare with the current event.'
			).length
		).toBeGreaterThan( 0 );
		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Current event' } )
			).toHaveValue( LABELS[ 5 ] )
		);
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
	} );

	it( 'restores both selections from the URL and overlays their statistics', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect( screen.getAllByText( 'Loading event sales…' ).length ).toBe(
			1
		);
		expect(
			await screen.findByRole( 'heading', {
				name: 'Cumulative tickets sold',
			} )
		).toBeInTheDocument();

		expect(
			screen.getByRole( 'combobox', { name: 'Current event' } )
		).toHaveValue( LABELS[ 5 ] );
		expect(
			screen.getByRole( 'combobox', { name: 'Comparison event' } )
		).toHaveValue( LABELS[ 7 ] );

		// Aligned by days relative to each event, with zeros kept and the
		// upcoming event's future days left empty.
		expect( getRows( 'Cumulative tickets sold' ) ).toEqual( [
			{
				offset: -2,
				label: '2 days before the event',
				current: 0,
				comparison: 2,
			},
			{
				offset: -1,
				label: '1 day before the event',
				current: 1,
				comparison: null,
			},
			{
				offset: 0,
				label: 'Day of the event',
				current: 4,
				comparison: null,
			},
		] );
		expect(
			getRows( 'Cumulative sales amount' ).map( ( row ) => [
				row.current,
				row.comparison,
			] )
		).toEqual( [
			[ 0, 50 ],
			[ 20, null ],
			[ 80, null ],
		] );

		// Each chart names both events in its legend, in distinct colours.
		[ 'Cumulative tickets sold', 'Cumulative sales amount' ].forEach(
			( title ) => {
				const card = within( getChartCard( title ) );
				expect( card.getByText( LABELS[ 5 ] ) ).toBeInTheDocument();
				expect( card.getByText( LABELS[ 7 ] ) ).toBeInTheDocument();
				const current = JSON.parse(
					card.getByTestId( 'current-line' ).dataset.props
				);
				const comparison = JSON.parse(
					card.getByTestId( 'comparison-line' ).dataset.props
				);
				expect( current.name ).toBe( LABELS[ 5 ] );
				expect( comparison.name ).toBe( LABELS[ 7 ] );
				expect( current.stroke ).not.toBe( comparison.stroke );
				expect( current.connectNulls ).toBe( false );
			}
		);

		// Totals match each event's own Statistics response.
		expect( screen.getByText( '4 tickets' ) ).toBeInTheDocument();
		expect( screen.getByText( '2 tickets' ) ).toBeInTheDocument();
		expect( screen.getByText( /€\s?80[.,]00/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( '1 day until the event' )
		).toBeInTheDocument();
		expect(
			screen
				.getAllByRole( 'link', { name: 'Open event statistics' } )
				.map( ( link ) => link.getAttribute( 'href' ) )
		).toEqual( [
			'/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=5&tab=statistics',
			'/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=7&tab=statistics',
		] );

		expect( requestsTo( '/fair-events/v1/event-dates/5/statistics' ) ).toBe(
			1
		);
		expect( requestsTo( '/fair-events/v1/event-dates/7/statistics' ) ).toBe(
			1
		);
	} );

	it( 'shows the future horizon only for the event that has days to come', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await screen.findByRole( 'heading', {
			name: 'Cumulative tickets sold',
		} );

		const card = within( getChartCard( 'Cumulative tickets sold' ) );
		const horizons = card
			.getAllByTestId( 'future-reference-line' )
			.map( ( line ) => JSON.parse( line.dataset.props ) );
		expect( horizons ).toHaveLength( 1 );
		expect( horizons[ 0 ].segment ).toEqual( [
			{ x: '2 days before the event', y: 2 },
			{ x: 'Day of the event', y: 2 },
		] );
		expect( horizons[ 0 ].strokeDasharray ).toBeTruthy();
		expect(
			card.getByText( /Dashed line: days that have not happened yet/ )
		).toBeInTheDocument();
	} );

	it( 'leaves the future note out when both events are over', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=8' );
		await screen.findByRole( 'heading', {
			name: 'Cumulative tickets sold',
		} );

		expect(
			screen.queryByTestId( 'future-reference-line' )
		).not.toBeInTheDocument();
		expect( screen.queryByText( /Dashed line/ ) ).not.toBeInTheDocument();
	} );

	it( 'restores an event that is outside the listed events', async () => {
		open( '&current_event_date_id=99&comparison_event_date_id=5' );

		await screen.findByRole( 'heading', {
			name: 'Cumulative tickets sold',
		} );
		expect(
			screen.getByRole( 'combobox', { name: 'Current event' } )
		).toHaveValue( LABELS[ 99 ] );
	} );

	it( 'changes one selection without resetting or reloading the other', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await screen.findByText( '2 tickets' );

		await choose( 'Comparison event', LABELS[ 8 ] );

		expect( window.location.search ).toBe(
			'?page=fair-events-compare-events&current_event_date_id=5&comparison_event_date_id=8'
		);
		expect( await screen.findByText( '9 tickets' ) ).toBeInTheDocument();
		expect( screen.queryByText( '2 tickets' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'combobox', { name: 'Current event' } )
		).toHaveValue( LABELS[ 5 ] );
		expect( requestsTo( '/fair-events/v1/event-dates/5/statistics' ) ).toBe(
			1
		);
		expect( requestsTo( '/fair-events/v1/event-dates/8/statistics' ) ).toBe(
			1
		);
	} );

	it( 'stores a first selection in the URL', async () => {
		open();

		await choose( 'Current event', LABELS[ 5 ] );

		expect( window.location.search ).toBe(
			'?page=fair-events-compare-events&current_event_date_id=5'
		);
		expect(
			screen.getAllByText(
				'Choose a comparison event to compare with the current event.'
			).length
		).toBeGreaterThan( 0 );
	} );

	it( 'follows the browser history', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await screen.findByText( '2 tickets' );

		act( () => {
			window.history.replaceState(
				null,
				'',
				`${ PAGE }&current_event_date_id=5&comparison_event_date_id=8`
			);
			window.dispatchEvent( new PopStateEvent( 'popstate' ) );
		} );

		expect( await screen.findByText( '9 tickets' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'combobox', { name: 'Comparison event' } )
		).toHaveValue( LABELS[ 8 ] );
	} );

	it( 'never shows a slower response for a selection that was replaced', async () => {
		let resolveReplaced;
		overrides[ '/fair-events/v1/event-dates/7/statistics' ] = () =>
			new Promise( ( resolve ) => {
				resolveReplaced = resolve;
			} );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await waitFor( () => expect( resolveReplaced ).toBeDefined() );

		await choose( 'Comparison event', LABELS[ 8 ] );
		expect( await screen.findByText( '9 tickets' ) ).toBeInTheDocument();

		// The replaced selection's response arrives last.
		await act( async () => {
			resolveReplaced(
				buildStatistics( { total_tickets: 77, total_sales: 77 } )
			);
		} );

		expect( screen.getByText( '9 tickets' ) ).toBeInTheDocument();
		expect( screen.queryByText( '77 tickets' ) ).not.toBeInTheDocument();
		expect(
			within( getChartCard( 'Cumulative tickets sold' ) ).getByText(
				LABELS[ 8 ]
			)
		).toBeInTheDocument();
	} );

	it( 'asks for a different comparison event when both selections match', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=5' );

		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Current event' } )
			).toHaveValue( LABELS[ 5 ] )
		);
		expect(
			screen.getAllByText(
				'Both selections are the same event. Choose a different comparison event.'
			).length
		).toBeGreaterThan( 0 );
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
	} );

	it( 'explains a link to an event that no longer exists', async () => {
		open( '&current_event_date_id=5&comparison_event_date_id=404' );

		expect(
			(
				await screen.findAllByText(
					'Comparison event: the event in this link no longer exists. Choose another event.'
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getByRole( 'combobox', { name: 'Comparison event' } )
		).toHaveValue( '' );
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
		expect(
			requestsTo( '/fair-events/v1/event-dates/404/statistics' )
		).toBe( 0 );
	} );

	it( 'explains a link to a cancelled event', async () => {
		overrides[ '/fair-events/v1/event-dates/7' ] = () =>
			Promise.resolve( { ...EVENTS[ 7 ], status: 'cancelled' } );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect(
			(
				await screen.findAllByText(
					`Comparison event: ${ LABELS[ 7 ] } was cancelled, so it cannot be compared. Choose another event.`
				)
			).length
		).toBeGreaterThan( 0 );
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
		expect( requestsTo( '/fair-events/v1/event-dates/7/statistics' ) ).toBe(
			0
		);
	} );

	it( 'explains a link with an invalid event ID', async () => {
		open( '&current_event_date_id=abc&comparison_event_date_id=7' );

		expect(
			screen.getAllByText(
				'Current event: this link does not point to a valid event. Choose an event from the list.'
			).length
		).toBeGreaterThan( 0 );
		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Comparison event' } )
			).toHaveValue( LABELS[ 7 ] )
		);
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();
	} );

	it( 'leaves cancelled events out of the choices', async () => {
		overrides[
			`${ LIST_PATH }?per_page=100&orderby=start_datetime&order=desc`
		] = () =>
			Promise.resolve( [
				EVENTS[ 5 ],
				{ ...EVENTS[ 7 ], status: 'cancelled' },
			] );
		open();

		fireEvent.focus(
			screen.getByRole( 'combobox', { name: 'Current event' } )
		);

		expect(
			await screen.findByRole( 'option', { name: LABELS[ 5 ] } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: LABELS[ 7 ] } )
		).not.toBeInTheDocument();
	} );

	it( 'reports failed statistics and loads them again on request', async () => {
		let fail = true;
		overrides[ '/fair-events/v1/event-dates/7/statistics' ] = () =>
			fail
				? Promise.reject( { message: 'Statistics are unavailable.' } )
				: Promise.resolve( statistics[ 7 ] );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect(
			(
				await screen.findAllByText(
					'Comparison event: Statistics are unavailable.'
				)
			).length
		).toBeGreaterThan( 0 );
		expect( screen.queryByTestId( 'line-chart' ) ).not.toBeInTheDocument();

		fail = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		expect( await screen.findByText( '2 tickets' ) ).toBeInTheDocument();
		expect(
			screen.queryByText(
				'Comparison event: Statistics are unavailable.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'reports a failed event list without hiding the restored comparison', async () => {
		overrides[
			`${ LIST_PATH }?per_page=100&orderby=start_datetime&order=desc`
		] = () => Promise.reject( {} );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect(
			(
				await screen.findAllByText(
					'The list of events could not be loaded.'
				)
			).length
		).toBeGreaterThan( 0 );
		expect( await screen.findByText( '2 tickets' ) ).toBeInTheDocument();
	} );

	it( 'keeps the currency and ticket-record warnings, named per event', async () => {
		statistics[ 7 ] = buildStatistics( {
			...UPCOMING,
			excluded_currencies: [ 'USD', 'GBP' ],
			incomplete_ticket_backfills: 2,
		} );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect(
			(
				await screen.findAllByText(
					`${ LABELS[ 7 ] }: some payments were excluded because they use different currencies: USD, GBP.`
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getAllByText(
				new RegExp(
					`^${ LABELS[ 7 ] }: 2 purchases have fewer ticket records`
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.queryByText(
				new RegExp( `^${ LABELS[ 5 ] }: some payments` )
			)
		).not.toBeInTheDocument();
	} );

	it( 'says when an event has no sales and still charts its zeros', async () => {
		statistics[ 7 ] = buildStatistics( {
			total_tickets: 0,
			total_sales: 0,
			total_sales_amount: 0,
			start_date: '2026-09-10',
			series: [
				{ date: '2026-09-09', total: 0 },
				{ date: '2026-09-10', total: 0 },
			],
			amount_series: [
				{ date: '2026-09-09', amount: 0 },
				{ date: '2026-09-10', amount: 0 },
			],
		} );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );

		expect(
			await screen.findByText( 'No sales recorded for this event yet.' )
		).toBeInTheDocument();
		expect( screen.getByText( '0 tickets' ) ).toBeInTheDocument();
		expect(
			getRows( 'Cumulative tickets sold' ).map(
				( row ) => row.comparison
			)
		).toEqual( [ undefined, 0, 0 ] );
	} );

	it( 'downloads a chart card under a filename naming both events', async () => {
		downloadElementAsPng.mockResolvedValue();
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await screen.findByRole( 'heading', {
			name: 'Cumulative sales amount',
		} );

		const card = getChartCard( 'Cumulative sales amount' );
		await act( async () => {
			fireEvent.click(
				within( card ).getByRole( 'button', { name: 'Download PNG' } )
			);
		} );

		expect( downloadElementAsPng ).toHaveBeenCalledTimes( 1 );
		expect( downloadElementAsPng ).toHaveBeenCalledWith(
			card,
			'spring-ball-2026-03-03-vs-autumn-ball-2026-09-10-cumulative-sales-amount.png'
		);
		// The captured card carries the title and the legend of both events.
		expect( within( card ).getByText( LABELS[ 5 ] ) ).toBeInTheDocument();
		expect( within( card ).getByText( LABELS[ 7 ] ) ).toBeInTheDocument();
	} );

	it( 'reports a failed download', async () => {
		downloadElementAsPng.mockRejectedValue( new Error( 'canvas' ) );
		open( '&current_event_date_id=5&comparison_event_date_id=7' );
		await screen.findByRole( 'heading', {
			name: 'Cumulative tickets sold',
		} );

		await act( async () => {
			fireEvent.click(
				within( getChartCard( 'Cumulative tickets sold' ) ).getByRole(
					'button',
					{ name: 'Download PNG' }
				)
			);
		} );

		expect(
			screen.getAllByText(
				'The chart image could not be downloaded. Please try again.'
			).length
		).toBeGreaterThan( 0 );
	} );
} );
