/**
 * Playwright API tests for occurrence timing overrides on
 * EventDatesController (#1819, stage 2).
 *
 * A date of a series owns its dates and its times (start time, end time
 * and all-day) as two independent groups. Covers: series edits keep each
 * overridden group and update inherited ones, a cleared time stays
 * cleared, a moved occurrence keeps its anchor, inherit_timing resets a
 * group, and a series change an overridden date cannot follow is refused
 * with 409 before anything is written.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const timingOf = ( body ) => ( {
	start_date: body.start_date,
	end_date: body.end_date,
	start_time: body.start_time,
	end_time: body.end_time,
	all_day: Boolean( body.all_day ),
} );

const timing = ( date, startTime, endTime, endDate = date ) => ( {
	start_date: date,
	end_date: endDate,
	start_time: startTime,
	end_time: endTime,
	all_day: false,
} );

test.describe( 'EventDatesController — occurrence timing overrides', () => {
	let api;
	const eventDateIds = [];

	const update = ( id, data ) =>
		api.put( `/wp-json/fair-events/v1/event-dates/${ id }`, {
			headers: adminHeaders,
			data,
		} );

	const read = async ( id ) => {
		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ id }`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		return response.json();
	};

	/**
	 * Create a weekly series of four dates from 2037-03-02, 18:00–20:00.
	 *
	 * @param {Object} data Extra fields.
	 * @return {Promise<{master: Object, children: Object[]}>} Created series.
	 */
	const createSeries = async ( data = {} ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Overrides ${ Date.now() }`,
					start_date: '2037-03-02',
					start_time: '18:00',
					end_time: '20:00',
					rrule: 'FREQ=WEEKLY;COUNT=4',
					...data,
				},
			}
		);
		expect( response.status() ).toBe( 201 );
		const { id } = await response.json();
		eventDateIds.push( id );
		const master = await read( id );
		return { master, children: master.generated_occurrences };
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of [ ...new Set( eventDateIds ) ] ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'keeps an occurrence’s own times through series edits', async () => {
		const { master, children } = await createSeries();
		expect( children[ 0 ].timing_overrides ).toEqual( {
			dates: false,
			times: false,
		} );

		const edited = await update( children[ 0 ].id, {
			start_time: '15:00',
		} );
		expect( edited.status() ).toBe( 200 );
		const editedBody = await edited.json();
		expect( editedBody.timing_overrides ).toEqual( {
			dates: false,
			times: true,
		} );

		// Sending unchanged values does not take over a group.
		const same = await (
			await update( children[ 1 ].id, {
				start_date: children[ 1 ].start_date,
				start_time: '18:00',
				end_time: '20:00',
			} )
		).json();
		expect( same.timing_overrides ).toEqual( {
			dates: false,
			times: false,
		} );

		const seriesEdit = await update( master.id, {
			start_time: '19:00',
			end_time: '21:00',
		} );
		expect( seriesEdit.status() ).toBe( 200 );
		const impact = ( await seriesEdit.json() ).recurrence_impact;
		expect( impact.unchanged.map( ( row ) => row.id ) ).toEqual( [
			children[ 0 ].id,
		] );
		expect( impact.shifted.map( ( row ) => row.id ) ).toEqual(
			children.slice( 1 ).map( ( child ) => child.id )
		);

		const after = ( await read( master.id ) ).generated_occurrences;
		expect( after.map( ( occ ) => occ.id ) ).toEqual(
			children.map( ( child ) => child.id )
		);
		// Both times stay the occurrence's own, not only the edited one.
		expect( timingOf( after[ 0 ] ) ).toEqual(
			timing( '2037-03-09', '15:00:00', '20:00:00' )
		);
		expect( timingOf( after[ 1 ] ) ).toEqual(
			timing( '2037-03-16', '19:00:00', '21:00:00' )
		);
	} );

	test( 'keeps a time cleared on an occurrence cleared', async () => {
		const { master, children } = await createSeries();

		const cleared = await (
			await update( children[ 0 ].id, { end_time: null } )
		).json();
		expect( cleared.end_time ).toBeNull();
		expect( cleared.timing_overrides.times ).toBe( true );

		await update( master.id, { end_time: '22:00' } );

		const after = ( await read( master.id ) ).generated_occurrences;
		expect( timingOf( after[ 0 ] ) ).toEqual(
			timing( '2037-03-09', '18:00:00', null )
		);
		expect( after[ 1 ].end_time ).toBe( '22:00:00' );
	} );

	test( 'keeps a moved occurrence on its date and anchor', async () => {
		const { master, children } = await createSeries();

		const moved = await (
			await update( children[ 0 ].id, {
				start_date: '2037-03-10',
				end_date: '2037-03-10',
			} )
		).json();
		expect( moved.timing_overrides ).toEqual( {
			dates: true,
			times: false,
		} );
		expect( moved.recurrence_anchor ).toBe( '2037-03-09' );

		await update( master.id, { start_time: '17:00' } );

		const after = ( await read( master.id ) ).generated_occurrences;
		expect( after[ 0 ].id ).toBe( children[ 0 ].id );
		expect( after[ 0 ].recurrence_anchor ).toBe( '2037-03-09' );
		expect( timingOf( after[ 0 ] ) ).toEqual(
			timing( '2037-03-10', '17:00:00', '20:00:00' )
		);

		// Cancelling addresses the scheduled date, not the shown one.
		const toggled = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2037-03-09' } }
		);
		expect( toggled.status() ).toBe( 200 );
		const toggledBody = await toggled.json();
		expect( toggledBody.cancelled_dates ).toEqual( [ '2037-03-09' ] );
		expect( toggledBody.generated_occurrences ).toHaveLength(
			children.length
		);
	} );

	test( 'resets a group to the series with inherit_timing', async () => {
		const { master, children } = await createSeries();
		await update( children[ 0 ].id, {
			start_date: '2037-03-11',
			end_date: '2037-03-11',
			start_time: null,
		} );

		const conflicting = await update( children[ 0 ].id, {
			start_time: '10:00',
			inherit_timing: [ 'times' ],
		} );
		expect( conflicting.status() ).toBe( 400 );
		expect( ( await conflicting.json() ).code ).toBe(
			'rest_inherit_timing_conflict'
		);

		const onMaster = await update( master.id, {
			inherit_timing: [ 'times' ],
		} );
		expect( onMaster.status() ).toBe( 400 );
		expect( ( await onMaster.json() ).code ).toBe(
			'rest_inherit_timing_not_supported'
		);

		const times = await (
			await update( children[ 0 ].id, { inherit_timing: [ 'times' ] } )
		).json();
		expect( times.timing_overrides ).toEqual( {
			dates: true,
			times: false,
		} );
		expect( timingOf( times ) ).toEqual(
			timing( '2037-03-11', '18:00:00', '20:00:00' )
		);

		const dates = await (
			await update( children[ 0 ].id, { inherit_timing: [ 'dates' ] } )
		).json();
		expect( dates.timing_overrides ).toEqual( {
			dates: false,
			times: false,
		} );
		expect( timingOf( dates ) ).toEqual(
			timing( '2037-03-09', '18:00:00', '20:00:00' )
		);

		// Inherited again: the next series edit reaches it.
		await update( master.id, { start_time: '16:00' } );
		const after = ( await read( master.id ) ).generated_occurrences;
		expect( after[ 0 ].start_time ).toBe( '16:00:00' );
	} );

	test( 'refuses a series change an overridden date cannot follow', async () => {
		const { master, children } = await createSeries();
		await update( children[ 1 ].id, {
			start_date: '2037-03-17',
			end_date: '2037-03-17',
		} );

		// Overnight series times on a date moved to a single day.
		const overnight = {
			end_date: '2037-03-03',
			start_time: '22:00',
			end_time: '02:00',
		};
		const refused = await update( master.id, overnight );
		expect( refused.status() ).toBe( 409 );
		const error = await refused.json();
		expect( error.code ).toBe( 'rest_occurrence_override_conflict' );
		expect( error.data.conflicts ).toEqual( [
			{
				id: children[ 1 ].id,
				start_date: '2037-03-17',
				reason: 'end_time_before_start',
			},
		] );

		// Nothing was written.
		const unchanged = await read( master.id );
		expect( timingOf( unchanged ) ).toEqual(
			timing( '2037-03-02', '18:00:00', '20:00:00' )
		);
		expect( unchanged.generated_occurrences[ 0 ].start_time ).toBe(
			'18:00:00'
		);

		await update( children[ 1 ].id, { inherit_timing: [ 'dates' ] } );
		const applied = await update( master.id, overnight );
		expect( applied.status() ).toBe( 200 );
		expect(
			timingOf( ( await read( master.id ) ).generated_occurrences[ 1 ] )
		).toEqual(
			timing( '2037-03-16', '22:00:00', '02:00:00', '2037-03-17' )
		);
	} );

	test( 'keeps overrides when a hand-picked series changes', async () => {
		const { master, children } = await createSeries( {
			rrule: undefined,
			recurrence_mode: 'manual',
			manual_dates: [ '2037-03-02', '2037-03-05', '2037-03-12' ],
		} );
		expect( children ).toHaveLength( 2 );

		await update( children[ 0 ].id, { start_time: null, end_time: null } );
		await update( master.id, { start_time: '09:00', end_time: '10:00' } );

		const after = ( await read( master.id ) ).generated_occurrences;
		expect( timingOf( after[ 0 ] ) ).toEqual(
			timing( '2037-03-05', null, null )
		);
		expect( timingOf( after[ 1 ] ) ).toEqual(
			timing( '2037-03-12', '09:00:00', '10:00:00' )
		);

		// Re-picking dates keeps the overridden date's row and its own timing.
		await update( master.id, {
			recurrence_mode: 'manual',
			manual_dates: [ '2037-03-02', '2037-03-05', '2037-03-19' ],
		} );
		const repicked = ( await read( master.id ) ).generated_occurrences;
		const kept = repicked.find( ( occ ) => occ.id === children[ 0 ].id );
		expect( kept.status ).toBe( 'active' );
		expect( timingOf( kept ) ).toEqual(
			timing( '2037-03-05', null, null )
		);
	} );
} );
