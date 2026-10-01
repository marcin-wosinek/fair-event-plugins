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
import EventStatistics from '../EventStatistics.js';
import { downloadElementAsPng } from '../exportChartImage.js';

jest.mock( '@wordpress/api-fetch' );

// Image generation is covered in exportChartImage.test.js; here we only care
// which card is captured and under which filename.
jest.mock( '../exportChartImage.js', () => ( {
	...jest.requireActual( '../exportChartImage.js' ),
	downloadElementAsPng: jest.fn(),
} ) );

// recharts needs ResizeObserver / a sized container that jsdom doesn't provide,
// and renders SVG internals that aren't this component's concern. Stub the
// chart primitives so the test can focus on our headings, notice, and states.
jest.mock( 'recharts', () => {
	const Passthrough = ( { children } ) => <div>{ children }</div>;
	const AreaChart = ( { children, data } ) => (
		<div data-testid="area-chart" data-series={ JSON.stringify( data ) }>
			{ children }
		</div>
	);
	const Area = ( props ) => (
		<div
			data-testid={ `${ props.dataKey }-area` }
			data-props={ JSON.stringify( props ) }
		/>
	);
	const ReferenceLine = ( props ) => (
		<div
			data-testid="future-reference-line"
			data-props={ JSON.stringify( props ) }
		/>
	);
	const BarChart = ( { children, data } ) => (
		<div data-testid="bar-chart" data-series={ JSON.stringify( data ) }>
			{ children }
		</div>
	);
	const Bar = ( props ) => (
		<div
			data-testid={ `${ props.dataKey }-bar` }
			data-props={ JSON.stringify( props ) }
		/>
	);
	const Empty = () => null;
	return {
		ResponsiveContainer: Passthrough,
		BarChart,
		AreaChart,
		Bar,
		Area,
		ReferenceLine,
		XAxis: Empty,
		YAxis: Empty,
		Tooltip: Empty,
		CartesianGrid: Empty,
	};
} );

describe( 'EventStatistics component', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	function mockApi( statistics = {} ) {
		apiFetch.mockImplementation( () =>
			Promise.resolve( {
				total_tickets: 3,
				total_sales: 3,
				currency: 'EUR',
				total_sales_amount: 12.5,
				excluded_currencies: [],
				days_until_start: 5,
				series: [
					{ date: '2026-06-14', label: '1 day before', total: 0 },
					{ date: '2026-06-15', label: 'Day of event', total: 3 },
				],
				amount_series: [
					{ date: '2026-06-14', label: '1 day before', amount: 0 },
					{ date: '2026-06-15', label: 'Day of event', amount: 12.5 },
				],
				tickets_per_activity: [
					{ id: 1, name: 'Yoga', count: 2 },
					{ id: 7, name: '', count: 1 },
				],
				activities_per_ticket: [
					{ activities: 0, tickets: 1 },
					{ activities: 1, tickets: 1 },
					{ activities: 2, tickets: 1 },
				],
				tickets_without_activity_assignment: 0,
				incomplete_ticket_backfills: 0,
				...statistics,
			} )
		);
	}

	it( 'renders ticket totals and both activity charts from one request', async () => {
		mockApi();

		render( <EventStatistics eventDateId={ 42 } /> );

		expect( await screen.findByText( '3 tickets' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Tickets per activity' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Activities per ticket' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Cumulative tickets sold' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Cumulative sales amount' )
		).toBeInTheDocument();
		expect( screen.getByText( /€\s?12[.,]50/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( '5 days until the event' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/42/statistics',
		} );
		// getAllByText: WordPress Notice mirrors its text into an a11y live region.
		expect(
			screen.getAllByText( /Counts confirmed tickets only/ ).length
		).toBeGreaterThan( 0 );

		const [ activityChart, distributionChart ] =
			screen.getAllByTestId( 'bar-chart' );
		expect( JSON.parse( activityChart.dataset.series ) ).toEqual( [
			{ name: 'Yoga', count: 2 },
			{ name: '#7', count: 1 },
		] );
		expect( JSON.parse( distributionChart.dataset.series ) ).toEqual( [
			{ activities: 0, tickets: 1 },
			{ activities: 1, tickets: 1 },
			{ activities: 2, tickets: 1 },
		] );
		expect(
			JSON.parse( screen.getByTestId( 'count-bar' ).dataset.props )
		).toMatchObject( { name: 'Tickets' } );
		expect(
			JSON.parse( screen.getByTestId( 'tickets-bar' ).dataset.props )
		).toMatchObject( { name: 'Tickets' } );
		expect(
			JSON.parse( screen.getByTestId( 'total-area' ).dataset.props )
		).toMatchObject( { name: 'Tickets' } );
		expect(
			screen.queryByText( /left out of the activity charts/ )
		).toBeNull();
		expect( screen.queryByText( /fewer ticket records/ ) ).toBeNull();
	} );

	it( 'falls back to the older total_sales field', async () => {
		mockApi( { total_tickets: undefined, total_sales: 1 } );

		render( <EventStatistics eventDateId={ 42 } /> );

		expect( await screen.findByText( '1 ticket' ) ).toBeInTheDocument();
	} );

	it( 'renders zero tickets with activity empty states', async () => {
		mockApi( {
			total_tickets: 0,
			total_sales: 0,
			total_sales_amount: 0,
			days_until_start: null,
			series: [ { date: '2026-06-15', label: 'Day of event', total: 0 } ],
			amount_series: [
				{ date: '2026-06-15', label: 'Day of event', amount: 0 },
			],
			tickets_per_activity: [],
			activities_per_ticket: [],
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		expect( await screen.findByText( '0 tickets' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'No activities recorded for confirmed tickets.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'No confirmed tickets to chart.' )
		).toBeInTheDocument();
		expect( screen.queryByTestId( 'bar-chart' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /until the event/ )
		).not.toBeInTheDocument();
	} );

	it( 'shows a zero-activity bucket while no ticket chose an activity', async () => {
		mockApi( {
			tickets_per_activity: [],
			activities_per_ticket: [ { activities: 0, tickets: 3 } ],
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		const [ distributionChart ] =
			await screen.findAllByTestId( 'bar-chart' );
		expect( JSON.parse( distributionChart.dataset.series ) ).toEqual( [
			{ activities: 0, tickets: 3 },
		] );
		expect(
			screen.getByText( 'No activities recorded for confirmed tickets.' )
		).toBeInTheDocument();
	} );

	it( 'explains tickets left out of the activity charts, with plurals', async () => {
		mockApi( {
			tickets_without_activity_assignment: 2,
			incomplete_ticket_backfills: 1,
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		expect(
			(
				await screen.findAllByText(
					'2 tickets are left out of the activity charts because their activities were recorded for the participant rather than for each ticket.'
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getAllByText(
				'1 purchase has fewer ticket records than tickets bought. Its missing tickets are not counted until their records are created.'
			).length
		).toBeGreaterThan( 0 );
	} );

	it( 'uses the singular warning for one left-out ticket', async () => {
		mockApi( { tickets_without_activity_assignment: 1 } );

		render( <EventStatistics eventDateId={ 42 } /> );

		expect(
			(
				await screen.findAllByText(
					/^1 ticket is left out of the activity charts/
				)
			).length
		).toBeGreaterThan( 0 );
	} );

	it( 'renders future points with a dashed horizon after the solid area', async () => {
		const series = [
			{ date: '2026-06-12', label: '4 days before the event', total: 1 },
			{ date: '2026-06-13', label: '3 days before the event', total: 2 },
			{
				date: '2026-06-14',
				label: '2 days before the event',
				total: null,
			},
			{ date: '2026-06-16', label: 'Day of the event', total: null },
		];
		mockApi( {
			total_sales: 2,
			days_until_start: 3,
			series,
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		const chart = ( await screen.findAllByTestId( 'area-chart' ) )[ 0 ];
		const chartSeries = JSON.parse( chart.dataset.series );
		expect( chartSeries ).toEqual( series );
		expect( chartSeries.at( -1 ).date ).toBe( '2026-06-16' );
		expect(
			JSON.parse( screen.getByTestId( 'total-area' ).dataset.props )
		).toMatchObject( { dataKey: 'total' } );
		expect(
			JSON.parse(
				screen.getAllByTestId( 'future-reference-line' )[ 0 ].dataset
					.props
			)
		).toMatchObject( {
			segment: [
				{ x: '3 days before the event', y: 2 },
				{ x: 'Day of the event', y: 2 },
			],
			strokeDasharray: '5 5',
		} );
	} );

	it( 'omits the dashed horizon for a completed series', async () => {
		mockApi( {
			days_until_start: null,
			series: [
				{ date: '2026-06-15', label: '1st day', total: 1 },
				{ date: '2026-06-16', label: '2nd day', total: 2 },
			],
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		await screen.findAllByTestId( 'area-chart' );
		expect(
			screen.queryByTestId( 'future-reference-line' )
		).not.toBeInTheDocument();
	} );

	it( 'renders the amount series, zero, and currency warning', async () => {
		const amountSeries = [
			{ date: '2026-06-14', label: '1 day before', amount: 0 },
			{ date: '2026-06-15', label: 'Day of event', amount: null },
		];
		mockApi( {
			total_sales_amount: 0,
			amount_series: amountSeries,
			excluded_currencies: [ 'USD' ],
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		expect( await screen.findByText( /€\s?0[.,]00/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( /different currencies: USD/ )
		).toBeInTheDocument();
		expect(
			JSON.parse( screen.getByTestId( 'amount-area' ).dataset.props )
		).toMatchObject( { dataKey: 'amount', name: 'Net sales amount' } );
		expect(
			JSON.parse(
				screen.getAllByTestId( 'area-chart' )[ 1 ].dataset.series
			)
		).toEqual( amountSeries );
	} );

	it( 'shows statistics failures', async () => {
		apiFetch.mockRejectedValue( new Error( 'Statistics unavailable' ) );

		render( <EventStatistics eventDateId={ 42 } /> );

		await waitFor( () =>
			expect(
				screen.getAllByText( 'Statistics unavailable' ).length
			).toBeGreaterThan( 0 )
		);
		expect( screen.queryByText( 'Tickets per activity' ) ).toBeNull();
	} );
} );

describe( 'EventStatistics chart downloads', () => {
	const salesResponse = {
		event_name: 'Summer Retreat',
		total_tickets: 1,
		total_sales: 1,
		currency: 'EUR',
		total_sales_amount: 12.5,
		tickets_per_activity: [ { id: 1, name: 'Yoga', count: 1 } ],
		activities_per_ticket: [ { activities: 1, tickets: 1 } ],
		excluded_currencies: [],
		days_until_start: 5,
		series: [
			{ date: '2026-06-14', label: '1 day before', total: 0 },
			{ date: '2026-06-15', label: 'Day of event', total: 1 },
		],
		amount_series: [
			{ date: '2026-06-14', label: '1 day before', amount: 0 },
			{ date: '2026-06-15', label: 'Day of event', amount: 12.5 },
		],
	};

	beforeEach( () => {
		jest.resetAllMocks();
		downloadElementAsPng.mockResolvedValue( undefined );
	} );

	function mockApi( statistics = {} ) {
		apiFetch.mockImplementation( () =>
			Promise.resolve( { ...salesResponse, ...statistics } )
		);
	}

	const cardFor = ( title ) =>
		screen
			.getByRole( 'heading', { name: title } )
			.closest( '.fair-event-statistics__chart-card' );

	async function renderStatistics( props = {} ) {
		render( <EventStatistics eventDateId={ 42 } { ...props } /> );
		await screen.findByText( 'Cumulative tickets sold' );
	}

	it( 'labels both sales charts with the live event title', async () => {
		mockApi();
		await renderStatistics( { eventTitle: 'Live Edited Title' } );

		expect(
			within( cardFor( 'Cumulative tickets sold' ) ).getByText(
				'Live Edited Title'
			)
		).toBeInTheDocument();
		expect(
			within( cardFor( 'Cumulative sales amount' ) ).getByText(
				'Live Edited Title'
			)
		).toBeInTheDocument();
	} );

	it( 'falls back to the API event name, then to the untitled label', async () => {
		mockApi();
		const { unmount } = render( <EventStatistics eventDateId={ 42 } /> );
		await screen.findByText( 'Cumulative tickets sold' );
		expect( screen.getAllByText( 'Summer Retreat' ) ).toHaveLength( 2 );
		unmount();

		mockApi( { event_name: '' } );
		render( <EventStatistics eventDateId={ 42 } eventTitle="   " /> );
		await screen.findByText( 'Cumulative tickets sold' );
		expect( screen.getAllByText( '(untitled event)' ) ).toHaveLength( 2 );
	} );

	it( 'offers exactly two independent downloads, on the sales charts only', async () => {
		mockApi();
		await renderStatistics();

		expect(
			screen.getAllByRole( 'button', { name: 'Download PNG' } )
		).toHaveLength( 2 );
		[ 'Cumulative tickets sold', 'Cumulative sales amount' ].forEach(
			( title ) => {
				expect(
					within( cardFor( title ) ).getAllByRole( 'button', {
						name: 'Download PNG',
					} )
				).toHaveLength( 1 );
			}
		);
		[ 'Tickets per activity', 'Activities per ticket' ].forEach(
			( title ) => {
				const card = cardFor( title );
				expect(
					within( card ).queryByRole( 'button' )
				).not.toBeInTheDocument();
				expect(
					within( card ).queryByText( 'Summer Retreat' )
				).toBeNull();
			}
		);
	} );

	it( 'downloads only the selected card under a safe filename', async () => {
		mockApi();
		await renderStatistics( { eventTitle: 'Clase de Cerámica / 2026' } );

		fireEvent.click(
			within( cardFor( 'Cumulative sales amount' ) ).getByRole(
				'button',
				{
					name: 'Download PNG',
				}
			)
		);

		await waitFor( () =>
			expect( downloadElementAsPng ).toHaveBeenCalledTimes( 1 )
		);
		const [ element, filename ] = downloadElementAsPng.mock.calls[ 0 ];
		expect( element ).toBe( cardFor( 'Cumulative sales amount' ) );
		expect( element ).not.toBe( cardFor( 'Cumulative tickets sold' ) );
		expect( filename ).toBe(
			'clase-de-ceramica-2026-cumulative-sales-amount.png'
		);

		fireEvent.click(
			within( cardFor( 'Cumulative tickets sold' ) ).getByRole(
				'button',
				{
					name: 'Download PNG',
				}
			)
		);
		await waitFor( () =>
			expect( downloadElementAsPng ).toHaveBeenCalledTimes( 2 )
		);
		expect( downloadElementAsPng.mock.calls[ 1 ][ 0 ] ).toBe(
			cardFor( 'Cumulative tickets sold' )
		);
		expect( downloadElementAsPng.mock.calls[ 1 ][ 1 ] ).toBe(
			'clase-de-ceramica-2026-cumulative-tickets-sold.png'
		);
	} );

	it( 'marks the download control so it is left out of the image', async () => {
		mockApi();
		await renderStatistics();

		screen
			.getAllByRole( 'button', { name: 'Download PNG' } )
			.forEach( ( button ) => {
				expect( button ).toHaveAttribute( 'data-chart-export-ignore' );
			} );
	} );

	it( 'exports zero-ticket charts with their identifying labels', async () => {
		mockApi( {
			total_tickets: 0,
			total_sales: 0,
			total_sales_amount: 0,
			days_until_start: null,
			series: [ { date: '2026-06-15', label: 'Day of event', total: 0 } ],
			amount_series: [
				{ date: '2026-06-15', label: 'Day of event', amount: 0 },
			],
		} );
		await renderStatistics();

		const card = cardFor( 'Cumulative tickets sold' );
		expect(
			within( card ).getByText( 'Summer Retreat' )
		).toBeInTheDocument();
		fireEvent.click(
			within( card ).getByRole( 'button', { name: 'Download PNG' } )
		);

		await waitFor( () =>
			expect( downloadElementAsPng ).toHaveBeenCalledWith(
				card,
				'summer-retreat-cumulative-tickets-sold.png'
			)
		);
	} );

	it( 'reports a failed export without leaving the page', async () => {
		mockApi();
		downloadElementAsPng.mockRejectedValue( new Error( 'canvas tainted' ) );
		const originalHref = window.location.href;
		await renderStatistics();

		fireEvent.click(
			within( cardFor( 'Cumulative tickets sold' ) ).getByRole(
				'button',
				{
					name: 'Download PNG',
				}
			)
		);

		expect(
			( await screen.findAllByText( /could not be downloaded/ ) ).length
		).toBeGreaterThan( 0 );
		expect( window.location.href ).toBe( originalHref );
		// The tab stays usable: charts remain and another attempt is possible.
		expect(
			screen.getByText( 'Tickets per activity' )
		).toBeInTheDocument();
		screen
			.getAllByRole( 'button', { name: 'Download PNG' } )
			.forEach( ( button ) => expect( button ).not.toBeDisabled() );
	} );

	it( 'clears the error after a later successful export', async () => {
		mockApi();
		downloadElementAsPng.mockRejectedValueOnce(
			new Error( 'first fails' )
		);
		await renderStatistics();
		const button = within( cardFor( 'Cumulative tickets sold' ) ).getByRole(
			'button',
			{ name: 'Download PNG' }
		);

		fireEvent.click( button );
		await screen.findAllByText( /could not be downloaded/ );

		fireEvent.click( button );
		// Query the notice itself: Notice mirrors its text into a persistent
		// a11y live region that outlives the visible message.
		await waitFor( () =>
			expect(
				document.querySelector( '.components-notice.is-error' )
			).toBeNull()
		);
	} );

	it( 'ignores repeated activation while an export is running', async () => {
		mockApi();
		let finishExport;
		downloadElementAsPng.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishExport = resolve;
				} )
		);
		await renderStatistics();
		const [ first, second ] = screen.getAllByRole( 'button', {
			name: 'Download PNG',
		} );

		fireEvent.click( first );
		fireEvent.click( first );
		fireEvent.click( second );

		expect( downloadElementAsPng ).toHaveBeenCalledTimes( 1 );
		await waitFor( () =>
			expect( first ).toHaveAttribute( 'aria-disabled' )
		);
		expect( second ).toHaveAttribute( 'aria-disabled' );

		await act( async () => finishExport() );

		await waitFor( () =>
			expect( first ).not.toHaveAttribute( 'aria-disabled', 'true' )
		);
		fireEvent.click( second );
		expect( downloadElementAsPng ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'EventStatistics capacity', () => {
	const baseResponse = {
		event_name: 'Summer Retreat',
		total_tickets: 3,
		total_sales: 3,
		currency: 'EUR',
		total_sales_amount: 12.5,
		excluded_currencies: [],
		days_until_start: 5,
		series: [ { date: '2026-06-15', label: 'Day of event', total: 3 } ],
		amount_series: [
			{ date: '2026-06-15', label: 'Day of event', amount: 12.5 },
		],
		tickets_per_activity: [ { id: 1, name: 'Yoga', count: 2 } ],
		activities_per_ticket: [ { activities: 1, tickets: 3 } ],
		tickets_without_activity_assignment: 0,
		incomplete_ticket_backfills: 0,
		event_capacity: { taken: 29, capacity: 40, remaining: 11, over: 0 },
		ticket_type_capacity: [
			{
				id: 1,
				name: 'Standard',
				series_wide: false,
				taken: 5,
				capacity: 5,
				remaining: 0,
				over: 0,
			},
			{
				id: 2,
				name: 'VIP',
				series_wide: false,
				taken: 7,
				capacity: 5,
				remaining: 0,
				over: 2,
			},
			{
				id: 3,
				name: 'Volunteer',
				series_wide: false,
				taken: 4,
				capacity: null,
				remaining: null,
				over: 0,
			},
		],
		activity_capacity: [
			{
				id: 11,
				name: 'Yoga',
				taken: 3,
				capacity: 12,
				remaining: 9,
				over: 0,
			},
			{
				id: 12,
				name: '',
				taken: 2,
				capacity: 1,
				remaining: 0,
				over: 1,
			},
		],
	};

	beforeEach( () => {
		jest.resetAllMocks();
	} );

	function mockApi( statistics = {} ) {
		apiFetch.mockImplementation( () =>
			Promise.resolve( { ...baseResponse, ...statistics } )
		);
	}

	const cardFor = ( title ) =>
		screen
			.getByRole( 'heading', { name: title } )
			.closest( '.fair-event-statistics__chart-card' );

	const rowFor = ( title, name ) => {
		const card = cardFor( title );
		return name
			? within( card ).getByText( name ).closest( 'li' )
			: card.querySelector( 'li' );
	};

	// Reads a row's labelled figures back as { label: value }.
	const figuresOf = ( row ) =>
		Object.fromEntries(
			[ ...row.querySelectorAll( 'dl > div' ) ].map( ( pair ) => [
				pair.querySelector( 'dt' ).textContent,
				pair.querySelector( 'dd' ).textContent,
			] )
		);

	async function renderStatistics() {
		render( <EventStatistics eventDateId={ 42 } /> );
		await screen.findByText( 'Cumulative tickets sold' );
	}

	it( 'places the three capacity cards between the sales and activity charts', async () => {
		mockApi();
		await renderStatistics();

		expect(
			screen
				.getAllByRole( 'heading', { level: 3 } )
				.map( ( heading ) => heading.textContent )
		).toEqual( [
			'Cumulative tickets sold',
			'Cumulative sales amount',
			'Event capacity',
			'Capacity by ticket type',
			'Capacity by activity',
			'Tickets per activity',
			'Activities per ticket',
		] );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect(
			screen.getByText(
				/tickets held while their payment is in progress/
			)
		).toBeInTheDocument();
		// Capacity cards are not exported as images.
		expect(
			screen.getAllByRole( 'button', { name: 'Download PNG' } )
		).toHaveLength( 2 );
	} );

	it( 'shows places taken, capacity and remaining for the event', async () => {
		mockApi();
		await renderStatistics();

		const row = rowFor( 'Event capacity' );
		expect( row ).toHaveAttribute( 'data-capacity-state', 'available' );
		expect( figuresOf( row ) ).toEqual( {
			'Places taken': '29',
			Capacity: '40',
			Remaining: '11',
		} );
		expect(
			row.querySelector( '.fair-event-statistics__capacity-fill' )
		).toHaveStyle( { width: '72.5%' } );
		expect( within( row ).queryByText( 'Full' ) ).toBeNull();
		expect( within( row ).queryByText( /Over capacity/ ) ).toBeNull();
	} );

	it( 'marks full and over-capacity ticket types differently', async () => {
		mockApi();
		await renderStatistics();

		const full = rowFor( 'Capacity by ticket type', 'Standard' );
		expect( full ).toHaveAttribute( 'data-capacity-state', 'full' );
		expect( within( full ).getByText( 'Full' ) ).toBeInTheDocument();
		expect( figuresOf( full ) ).toEqual( {
			'Places taken': '5',
			Capacity: '5',
			Remaining: '0',
		} );

		const over = rowFor( 'Capacity by ticket type', 'VIP' );
		expect( over ).toHaveAttribute( 'data-capacity-state', 'over' );
		expect(
			within( over ).getByText( 'Over capacity by 2 places' )
		).toBeInTheDocument();
		expect( within( over ).queryByText( 'Full' ) ).toBeNull();
		expect( figuresOf( over ) ).toEqual( {
			'Places taken': '7',
			Capacity: '5',
			Remaining: '0',
		} );
		expect(
			over.querySelector( '.fair-event-statistics__capacity-fill' )
		).toHaveStyle( { width: '100%' } );
	} );

	it( 'shows an unlimited scope without a bar or remaining count', async () => {
		mockApi( {
			event_capacity: {
				taken: 8,
				capacity: null,
				remaining: null,
				over: 0,
			},
		} );
		await renderStatistics();

		for ( const row of [
			rowFor( 'Event capacity' ),
			rowFor( 'Capacity by ticket type', 'Volunteer' ),
		] ) {
			expect( row ).toHaveAttribute( 'data-capacity-state', 'unlimited' );
			expect( figuresOf( row ) ).toEqual( {
				'Places taken': expect.any( String ),
				Capacity: 'Unlimited',
			} );
			expect(
				row.querySelector( '.fair-event-statistics__capacity-bar' )
			).toBeNull();
			expect( row.textContent ).not.toMatch( /%|NaN|Infinity/ );
		}
		expect(
			figuresOf( rowFor( 'Event capacity' ) )[ 'Places taken' ]
		).toBe( '8' );
	} );

	it( 'lists activities, with singular overflow and a fallback name', async () => {
		mockApi();
		await renderStatistics();

		expect( figuresOf( rowFor( 'Capacity by activity', 'Yoga' ) ) ).toEqual(
			{
				'Places taken': '3',
				Capacity: '12',
				Remaining: '9',
			}
		);
		const unnamed = rowFor( 'Capacity by activity', '#12' );
		expect(
			within( unnamed ).getByText( 'Over capacity by 1 place' )
		).toBeInTheDocument();
	} );

	it( 'treats a zero limit as full, not as a division by zero', async () => {
		mockApi( {
			event_capacity: { taken: 0, capacity: 0, remaining: 0, over: 0 },
		} );
		await renderStatistics();

		const row = rowFor( 'Event capacity' );
		expect( row ).toHaveAttribute( 'data-capacity-state', 'full' );
		expect(
			row.querySelector( '.fair-event-statistics__capacity-fill' )
		).toHaveStyle( { width: '100%' } );
		expect( row.textContent ).not.toMatch( /NaN|Infinity/ );
	} );

	it( 'renders empty ticket-type and activity lists with no sales', async () => {
		mockApi( {
			total_tickets: 0,
			total_sales: 0,
			total_sales_amount: 0,
			tickets_per_activity: [],
			activities_per_ticket: [],
			event_capacity: { taken: 0, capacity: 20, remaining: 20, over: 0 },
			ticket_type_capacity: [],
			activity_capacity: [],
		} );
		await renderStatistics();

		expect( figuresOf( rowFor( 'Event capacity' ) ) ).toEqual( {
			'Places taken': '0',
			Capacity: '20',
			Remaining: '20',
		} );
		expect(
			within( cardFor( 'Capacity by ticket type' ) ).getByText(
				'This event has no ticket types.'
			)
		).toBeInTheDocument();
		expect(
			within( cardFor( 'Capacity by activity' ) ).getByText(
				'This event has no activities.'
			)
		).toBeInTheDocument();
		expect(
			cardFor( 'Capacity by ticket type' ).querySelector( 'li' )
		).toBeNull();
	} );

	it( 'explains series-wide ticket type limits only for a series', async () => {
		mockApi();
		const { unmount } = render( <EventStatistics eventDateId={ 42 } /> );
		await screen.findByText( 'Capacity by ticket type' );
		expect(
			screen.queryByText( /one limit for the whole series/ )
		).toBeNull();
		unmount();

		mockApi( {
			ticket_type_capacity: baseResponse.ticket_type_capacity.map(
				( row ) => ( { ...row, series_wide: true } )
			),
		} );
		render( <EventStatistics eventDateId={ 42 } /> );
		expect(
			await screen.findByText( /one limit for the whole series/ )
		).toBeInTheDocument();
	} );

	it( 'shows no capacity cards while loading or after a failed request', async () => {
		let fail;
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve, reject ) => {
					fail = reject;
				} )
		);
		render( <EventStatistics eventDateId={ 42 } /> );

		expect(
			document.querySelector( '.components-spinner' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Event capacity' ) ).toBeNull();

		await act( async () => fail( new Error( 'Statistics unavailable' ) ) );

		expect(
			screen.getAllByText( 'Statistics unavailable' ).length
		).toBeGreaterThan( 0 );
		expect( screen.queryByText( 'Event capacity' ) ).toBeNull();
		expect( screen.queryByText( 'Capacity by activity' ) ).toBeNull();
	} );

	it( 'omits the capacity cards for a response without capacity data', async () => {
		mockApi( {
			event_capacity: undefined,
			ticket_type_capacity: undefined,
			activity_capacity: undefined,
		} );
		await renderStatistics();

		expect( screen.queryByText( 'Event capacity' ) ).toBeNull();
		expect( screen.queryByText( 'Capacity by ticket type' ) ).toBeNull();
		expect(
			screen.getByText( 'Tickets per activity' )
		).toBeInTheDocument();
	} );
} );
