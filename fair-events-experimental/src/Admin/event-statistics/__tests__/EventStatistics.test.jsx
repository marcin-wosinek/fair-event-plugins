/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventStatistics, {
	peoplePerActivity,
	activityCountDistribution,
} from '../EventStatistics.js';

jest.mock( '@wordpress/api-fetch' );

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
		<div data-testid="sales-area" data-props={ JSON.stringify( props ) } />
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
				days_until_start: 5,
				series: [
					{ date: '2026-06-14', label: '1 day before', total: 0 },
					{ date: '2026-06-15', label: 'Day of event', total: 1 },
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
		expect( screen.getByText( '1 sale' ) ).toBeInTheDocument();
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
			days_until_start: null,
			series: [ { date: '2026-06-15', label: 'Day of event', total: 0 } ],
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

		const chart = await screen.findByTestId( 'area-chart' );
		const chartSeries = JSON.parse( chart.dataset.series );
		expect( chartSeries ).toEqual( series );
		expect( chartSeries.at( -1 ).date ).toBe( '2026-06-16' );
		expect(
			JSON.parse( screen.getByTestId( 'sales-area' ).dataset.props )
		).toMatchObject( { dataKey: 'total' } );
		expect(
			JSON.parse(
				screen.getByTestId( 'future-reference-line' ).dataset.props
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

		await screen.findByTestId( 'area-chart' );
		expect(
			screen.queryByTestId( 'future-reference-line' )
		).not.toBeInTheDocument();
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
