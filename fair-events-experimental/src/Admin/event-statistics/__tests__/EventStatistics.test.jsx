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
import EventStatistics, {
	peoplePerActivity,
	activityCountDistribution,
} from '../EventStatistics.js';
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
	const Empty = () => null;
	return {
		ResponsiveContainer: Passthrough,
		BarChart: Passthrough,
		AreaChart,
		Bar: Empty,
		Area,
		ReferenceLine,
		XAxis: Empty,
		YAxis: Empty,
		Tooltip: Empty,
		CartesianGrid: Empty,
	};
} );

const signedUp = ( overrides ) => ( {
	label: 'signed_up',
	ticket_option_ids: [],
	ticket_option_names: [],
	created_at: null,
	...overrides,
} );

describe( 'peoplePerActivity', () => {
	it( 'counts confirmed participants per ticket option, sorted desc', () => {
		const participants = [
			signedUp( {
				ticket_option_ids: [ 1, 2 ],
				ticket_option_names: [ 'Yoga', 'Acro' ],
			} ),
			signedUp( {
				ticket_option_ids: [ 1 ],
				ticket_option_names: [ 'Yoga' ],
			} ),
			signedUp( {
				ticket_option_ids: [ 1, 3 ],
				ticket_option_names: [ 'Yoga', 'Thai' ],
			} ),
		];
		expect( peoplePerActivity( participants ) ).toEqual( [
			{ name: 'Yoga', count: 3 },
			{ name: 'Acro', count: 1 },
			{ name: 'Thai', count: 1 },
		] );
	} );

	it( 'falls back to #id when a name is missing', () => {
		const participants = [
			signedUp( { ticket_option_ids: [ 7 ], ticket_option_names: [] } ),
		];
		expect( peoplePerActivity( participants ) ).toEqual( [
			{ name: '#7', count: 1 },
		] );
	} );

	it( 'returns [] for no participants', () => {
		expect( peoplePerActivity( [] ) ).toEqual( [] );
	} );
} );

describe( 'activityCountDistribution', () => {
	it( 'buckets people by number of activities, continuous range', () => {
		const participants = [
			signedUp( { ticket_option_ids: [ 1 ] } ), // 1 activity
			signedUp( { ticket_option_ids: [ 1, 2 ] } ), // 2 activities
			signedUp( { ticket_option_ids: [ 1, 2, 3 ] } ), // 3 activities
			signedUp( { ticket_option_ids: [ 4, 5, 6 ] } ), // 3 activities
		];
		expect( activityCountDistribution( participants ) ).toEqual( [
			{ activities: 1, people: 1 },
			{ activities: 2, people: 1 },
			{ activities: 3, people: 2 },
		] );
	} );

	it( 'fills gaps in the range with zero', () => {
		const participants = [
			signedUp( { ticket_option_ids: [ 1 ] } ), // 1
			signedUp( { ticket_option_ids: [ 1, 2, 3 ] } ), // 3
		];
		expect( activityCountDistribution( participants ) ).toEqual( [
			{ activities: 1, people: 1 },
			{ activities: 2, people: 0 },
			{ activities: 3, people: 1 },
		] );
	} );
} );

describe( 'EventStatistics component', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	function mockApi( participants, statistics = {} ) {
		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.path.endsWith( '/participants' ) ) {
				return Promise.resolve( participants );
			}
			return Promise.resolve( {
				total_sales: 1,
				currency: 'EUR',
				total_sales_amount: 12.5,
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
				...statistics,
			} );
		} );
	}

	it( 'renders the three views and the exclusion note', async () => {
		mockApi( [
			signedUp( {
				ticket_option_ids: [ 1 ],
				ticket_option_names: [ 'Yoga' ],
			} ),
			// Excluded rows: not signed_up.
			{ label: 'pending_payment', ticket_option_ids: [ 1 ] },
			{ label: 'interested', ticket_option_ids: [] },
		] );

		render( <EventStatistics eventDateId={ 42 } /> );

		await waitFor( () =>
			expect(
				screen.getByText( 'People per activity' )
			).toBeInTheDocument()
		);
		expect(
			screen.getByText( 'Activities per person' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Cumulative sales' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Cumulative sales amount' )
		).toBeInTheDocument();
		expect( screen.getByText( '1 sale' ) ).toBeInTheDocument();
		expect( screen.getByText( /€\s?12[.,]50/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( '5 days until the event' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/event-dates/42/statistics',
		} );
		// 2 of the 3 rows are excluded (pending_payment + interested).
		// getAllByText: WordPress Notice mirrors its text into an a11y live region.
		expect( screen.getAllByText( /2 excluded/ ).length ).toBeGreaterThan(
			0
		);
	} );

	it( 'renders zero sales while retaining the activity charts', async () => {
		mockApi( [ { label: 'interested', ticket_option_ids: [] } ], {
			total_sales: 0,
			total_sales_amount: 0,
			days_until_start: null,
			series: [ { date: '2026-06-15', label: 'Day of event', total: 0 } ],
			amount_series: [
				{ date: '2026-06-15', label: 'Day of event', amount: 0 },
			],
		} );

		render( <EventStatistics eventDateId={ 42 } /> );

		await waitFor( () =>
			expect( screen.getByText( '0 sales' ) ).toBeInTheDocument()
		);
		expect( screen.getByText( 'People per activity' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Activities per person' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( /until the event/ )
		).not.toBeInTheDocument();
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
		mockApi( [], {
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
		mockApi( [], {
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
		mockApi( [], {
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

	it( 'shows statistics failures independently', async () => {
		apiFetch.mockImplementation( ( opts ) =>
			opts.path.endsWith( '/participants' )
				? Promise.resolve( [ signedUp( {} ) ] )
				: Promise.reject( new Error( 'Statistics unavailable' ) )
		);

		render( <EventStatistics eventDateId={ 42 } /> );

		await waitFor( () =>
			expect(
				screen.getAllByText( 'Statistics unavailable' ).length
			).toBeGreaterThan( 0 )
		);
		expect( screen.getByText( 'People per activity' ) ).toBeInTheDocument();
	} );
} );

describe( 'EventStatistics chart downloads', () => {
	const salesResponse = {
		event_name: 'Summer Retreat',
		total_sales: 1,
		currency: 'EUR',
		total_sales_amount: 12.5,
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
		apiFetch.mockImplementation( ( opts ) =>
			Promise.resolve(
				opts.path.endsWith( '/participants' )
					? [
							signedUp( {
								ticket_option_ids: [ 1 ],
								ticket_option_names: [ 'Yoga' ],
							} ),
					  ]
					: { ...salesResponse, ...statistics }
			)
		);
	}

	const cardFor = ( title ) =>
		screen
			.getByRole( 'heading', { name: title } )
			.closest( '.fair-event-statistics__chart-card' );

	async function renderStatistics( props = {} ) {
		render( <EventStatistics eventDateId={ 42 } { ...props } /> );
		await screen.findByText( 'Cumulative sales' );
	}

	it( 'labels both sales charts with the live event title', async () => {
		mockApi();
		await renderStatistics( { eventTitle: 'Live Edited Title' } );

		expect(
			within( cardFor( 'Cumulative sales' ) ).getByText(
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
		await screen.findByText( 'Cumulative sales' );
		expect( screen.getAllByText( 'Summer Retreat' ) ).toHaveLength( 2 );
		unmount();

		mockApi( { event_name: '' } );
		render( <EventStatistics eventDateId={ 42 } eventTitle="   " /> );
		await screen.findByText( 'Cumulative sales' );
		expect( screen.getAllByText( '(untitled event)' ) ).toHaveLength( 2 );
	} );

	it( 'offers exactly two independent downloads, on the sales charts only', async () => {
		mockApi();
		await renderStatistics();

		expect(
			screen.getAllByRole( 'button', { name: 'Download PNG' } )
		).toHaveLength( 2 );
		[ 'Cumulative sales', 'Cumulative sales amount' ].forEach(
			( title ) => {
				expect(
					within( cardFor( title ) ).getAllByRole( 'button', {
						name: 'Download PNG',
					} )
				).toHaveLength( 1 );
			}
		);
		[ 'People per activity', 'Activities per person' ].forEach(
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
		expect( element ).not.toBe( cardFor( 'Cumulative sales' ) );
		expect( filename ).toBe(
			'clase-de-ceramica-2026-cumulative-sales-amount.png'
		);

		fireEvent.click(
			within( cardFor( 'Cumulative sales' ) ).getByRole( 'button', {
				name: 'Download PNG',
			} )
		);
		await waitFor( () =>
			expect( downloadElementAsPng ).toHaveBeenCalledTimes( 2 )
		);
		expect( downloadElementAsPng.mock.calls[ 1 ][ 0 ] ).toBe(
			cardFor( 'Cumulative sales' )
		);
		expect( downloadElementAsPng.mock.calls[ 1 ][ 1 ] ).toBe(
			'clase-de-ceramica-2026-cumulative-sales.png'
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

	it( 'exports zero-sales charts with their identifying labels', async () => {
		mockApi( {
			total_sales: 0,
			total_sales_amount: 0,
			days_until_start: null,
			series: [ { date: '2026-06-15', label: 'Day of event', total: 0 } ],
			amount_series: [
				{ date: '2026-06-15', label: 'Day of event', amount: 0 },
			],
		} );
		await renderStatistics();

		const card = cardFor( 'Cumulative sales' );
		expect(
			within( card ).getByText( 'Summer Retreat' )
		).toBeInTheDocument();
		fireEvent.click(
			within( card ).getByRole( 'button', { name: 'Download PNG' } )
		);

		await waitFor( () =>
			expect( downloadElementAsPng ).toHaveBeenCalledWith(
				card,
				'summer-retreat-cumulative-sales.png'
			)
		);
	} );

	it( 'reports a failed export without leaving the page', async () => {
		mockApi();
		downloadElementAsPng.mockRejectedValue( new Error( 'canvas tainted' ) );
		const originalHref = window.location.href;
		await renderStatistics();

		fireEvent.click(
			within( cardFor( 'Cumulative sales' ) ).getByRole( 'button', {
				name: 'Download PNG',
			} )
		);

		expect(
			( await screen.findAllByText( /could not be downloaded/ ) ).length
		).toBeGreaterThan( 0 );
		expect( window.location.href ).toBe( originalHref );
		// The tab stays usable: charts remain and another attempt is possible.
		expect( screen.getByText( 'People per activity' ) ).toBeInTheDocument();
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
		const button = within( cardFor( 'Cumulative sales' ) ).getByRole(
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
