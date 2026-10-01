import {
	alignSeries,
	buildComparisonFilename,
	flattenOccurrences,
	getDayOffset,
	getEventLabel,
	getFutureHorizon,
	getOffsetLabel,
	parseEventDateId,
	readSelection,
	writeSelection,
} from '../comparison.js';

describe( 'URL selection', () => {
	it( 'reads positive integer IDs and flags anything else as invalid', () => {
		expect( parseEventDateId( null ) ).toEqual( {
			id: null,
			invalid: false,
		} );
		expect( parseEventDateId( '' ) ).toEqual( {
			id: null,
			invalid: false,
		} );
		expect( parseEventDateId( '42' ) ).toEqual( {
			id: 42,
			invalid: false,
		} );
		[ '0', '-3', '4.5', 'abc', '7x' ].forEach( ( raw ) => {
			expect( parseEventDateId( raw ) ).toEqual( {
				id: null,
				invalid: true,
			} );
		} );
	} );

	it( 'reads both selections from the query string', () => {
		expect(
			readSelection(
				'?page=fair-events-compare-events&current_event_date_id=5&comparison_event_date_id=nope'
			)
		).toEqual( {
			current: { id: 5, invalid: false },
			comparison: { id: null, invalid: true },
		} );
	} );

	it( 'changes one selection and keeps every other parameter', () => {
		const search =
			'?page=fair-events-compare-events&current_event_date_id=5&comparison_event_date_id=7';

		expect( writeSelection( search, 'comparison', 9 ) ).toBe(
			'?page=fair-events-compare-events&current_event_date_id=5&comparison_event_date_id=9'
		);
		expect( writeSelection( search, 'current', null ) ).toBe(
			'?page=fair-events-compare-events&comparison_event_date_id=7'
		);
	} );
} );

describe( 'event labels', () => {
	it( 'names an occurrence by its title and site-local start', () => {
		expect(
			getEventLabel( {
				title: ' Spring Ball ',
				start_datetime: '2026-04-11 20:00:00',
				all_day: false,
			} )
		).toBe( 'Spring Ball — April 11, 2026 8:00 pm' );
	} );

	it( 'leaves the time out for an all-day event and falls back for a missing title', () => {
		expect(
			getEventLabel( {
				title: '',
				start_datetime: '2026-04-11 00:00:00',
				all_day: true,
			} )
		).toBe( '(untitled event) — April 11, 2026' );
	} );
} );

describe( 'flattenOccurrences', () => {
	it( 'lists every date of a series under the series name, without cancelled dates', () => {
		const occurrences = flattenOccurrences( [
			{
				id: 1,
				title: 'Single',
				start_datetime: '2026-05-01 10:00:00',
				status: 'active',
			},
			{
				id: 2,
				title: 'Weekly class',
				start_datetime: '2026-06-01 10:00:00',
				status: 'active',
				occurrence_type: 'master',
				children: [
					{
						id: 3,
						title: null,
						start_datetime: '2026-06-08 10:00:00',
						status: 'active',
					},
					{
						id: 4,
						title: null,
						start_datetime: '2026-06-15 10:00:00',
						status: 'cancelled',
					},
				],
			},
		] );

		expect( occurrences.map( ( { id, title } ) => [ id, title ] ) ).toEqual(
			[
				[ 3, 'Weekly class' ],
				[ 2, 'Weekly class' ],
				[ 1, 'Single' ],
			]
		);
	} );

	it( 'returns an empty list while nothing is loaded', () => {
		expect( flattenOccurrences( null ) ).toEqual( [] );
	} );
} );

describe( 'event-relative timeline', () => {
	it( 'counts calendar days from the event start', () => {
		expect( getDayOffset( '2026-03-01', '2026-03-03' ) ).toBe( -2 );
		expect( getDayOffset( '2026-03-03', '2026-03-03' ) ).toBe( 0 );
		// Across a month end and a daylight-saving change.
		expect( getDayOffset( '2026-04-01', '2026-03-28' ) ).toBe( 4 );
	} );

	it( 'labels days before, on, and during the event', () => {
		expect( getOffsetLabel( -1, false ) ).toBe( '1 day before the event' );
		expect( getOffsetLabel( -27, false ) ).toBe(
			'27 days before the event'
		);
		expect( getOffsetLabel( 0, false ) ).toBe( 'Day of the event' );
		expect( getOffsetLabel( 0, true ) ).toBe( 'Day 1 of the event' );
		expect( getOffsetLabel( 2, true ) ).toBe( 'Day 3 of the event' );
	} );

	const statistics = {
		// Single-day event that has finished.
		current: {
			start_date: '2026-03-03',
			series: [
				{ date: '2026-03-01', total: 0 },
				{ date: '2026-03-02', total: 0 },
				{ date: '2026-03-03', total: 4 },
			],
		},
		// Two-day event still to come, with a shorter recorded window.
		comparison: {
			start_date: '2026-09-10',
			series: [
				{ date: '2026-09-09', total: 2 },
				{ date: '2026-09-10', total: null },
				{ date: '2026-09-11', total: null },
			],
		},
	};

	it( 'aligns both events by days relative to their own start', () => {
		expect( alignSeries( statistics, 'series', 'total' ) ).toEqual( [
			// Outside the comparison event's window: no value is inferred.
			{ offset: -2, label: '2 days before the event', current: 0 },
			{
				offset: -1,
				label: '1 day before the event',
				current: 0,
				comparison: 2,
			},
			{
				offset: 0,
				label: 'Day 1 of the event',
				current: 4,
				comparison: null,
			},
			{ offset: 1, label: 'Day 2 of the event', comparison: null },
		] );
	} );

	it( 'returns no rows when neither event has a series', () => {
		expect(
			alignSeries( { current: {}, comparison: null }, 'series', 'total' )
		).toEqual( [] );
	} );

	it( 'marks the days still to come at the last recorded value', () => {
		const rows = alignSeries( statistics, 'series', 'total' );

		expect( getFutureHorizon( rows, 'current' ) ).toBeNull();
		expect( getFutureHorizon( rows, 'comparison' ) ).toEqual( [
			{ x: '1 day before the event', y: 2 },
			{ x: 'Day 2 of the event', y: 2 },
		] );
	} );
} );

describe( 'buildComparisonFilename', () => {
	it( 'identifies both events, their dates, and the chart', () => {
		expect(
			buildComparisonFilename(
				{
					current: { title: 'Bal de Printemps: Édition 2' },
					comparison: { title: '' },
				},
				{
					current: { start_date: '2026-04-11' },
					comparison: { start_date: '2026-10-03' },
				},
				'Cumulative tickets sold'
			)
		).toBe(
			'bal-de-printemps-edition-2-2026-04-11-vs-event-2026-10-03-cumulative-tickets-sold.png'
		);
	} );
} );
