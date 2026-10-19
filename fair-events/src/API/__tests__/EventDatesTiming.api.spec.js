/**
 * Playwright API tests for optional event times on EventDatesController
 * (#1819, stage 1).
 *
 * Covers the canonical timing fields (start_date, end_date, start_time,
 * end_time): round trips of all four time combinations, genuine midnight
 * versus an absent time, all-day and multi-day events, omitted-versus-null
 * updates, validation, the deprecated datetime fields, and series with
 * missing times. Occurrence overrides are covered in
 * EventDatesOverrides.api.spec.js.
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

test.describe( 'EventDatesController — optional event times', () => {
	let api;
	const eventDateIds = [];

	const create = async ( data ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: { title: `Timing ${ Date.now() }`, ...data },
			}
		);
		if ( response.ok() ) {
			eventDateIds.push( ( await response.json() ).id );
		}
		return response;
	};

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

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of [ ...new Set( eventDateIds.filter( Boolean ) ) ] ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	const combinations = [
		{ name: 'both times', start_time: '18:00', end_time: '20:30' },
		{ name: 'start time only', start_time: '18:00', end_time: null },
		{ name: 'end time only', start_time: null, end_time: '20:30' },
		{ name: 'no times', start_time: null, end_time: null },
	];

	for ( const combination of combinations ) {
		test( `round-trips ${ combination.name }`, async () => {
			const response = await create( {
				start_date: '2036-05-04',
				start_time: combination.start_time,
				end_time: combination.end_time,
			} );
			expect( response.status() ).toBe( 201 );
			const created = await response.json();

			const expected = {
				start_date: '2036-05-04',
				end_date: '2036-05-04',
				start_time: combination.start_time
					? `${ combination.start_time }:00`
					: null,
				end_time: combination.end_time
					? `${ combination.end_time }:00`
					: null,
				all_day: false,
			};
			expect( timingOf( created ) ).toEqual( expected );
			expect( timingOf( await read( created.id ) ) ).toEqual( expected );
		} );
	}

	test( 'keeps genuine midnight distinct from an absent time', async () => {
		const midnight = await (
			await create( {
				start_date: '2036-05-05',
				end_date: '2036-05-06',
				start_time: '00:00',
				end_time: '00:00',
			} )
		).json();
		const absent = await (
			await create( { start_date: '2036-05-05', end_date: '2036-05-06' } )
		).json();

		expect( timingOf( await read( midnight.id ) ) ).toEqual( {
			start_date: '2036-05-05',
			end_date: '2036-05-06',
			start_time: '00:00:00',
			end_time: '00:00:00',
			all_day: false,
		} );
		expect( timingOf( await read( absent.id ) ) ).toEqual( {
			start_date: '2036-05-05',
			end_date: '2036-05-06',
			start_time: null,
			end_time: null,
			all_day: false,
		} );
	} );

	test( 'stores all-day events without times', async () => {
		const created = await (
			await create( {
				start_date: '2036-05-07',
				end_date: '2036-05-09',
				all_day: true,
			} )
		).json();

		expect( timingOf( await read( created.id ) ) ).toEqual( {
			start_date: '2036-05-07',
			end_date: '2036-05-09',
			start_time: null,
			end_time: null,
			all_day: true,
		} );
	} );

	test( 'distinguishes omitted fields from explicit null on update', async () => {
		const created = await (
			await create( {
				start_date: '2036-05-10',
				start_time: '10:00',
				end_time: '12:00',
			} )
		).json();

		// Omitted fields are unchanged.
		let response = await update( created.id, { title: 'Renamed timing' } );
		expect( response.ok() ).toBeTruthy();
		expect( timingOf( await response.json() ) ).toEqual( {
			start_date: '2036-05-10',
			end_date: '2036-05-10',
			start_time: '10:00:00',
			end_time: '12:00:00',
			all_day: false,
		} );

		// Explicit null clears only that time.
		response = await update( created.id, { end_time: null } );
		expect( response.ok() ).toBeTruthy();
		expect( timingOf( await read( created.id ) ) ).toEqual( {
			start_date: '2036-05-10',
			end_date: '2036-05-10',
			start_time: '10:00:00',
			end_time: null,
			all_day: false,
		} );

		// Turning all-day off does not invent times.
		response = await update( created.id, { all_day: true } );
		expect( response.ok() ).toBeTruthy();
		response = await update( created.id, { all_day: false } );
		expect( response.ok() ).toBeTruthy();
		expect( timingOf( await read( created.id ) ) ).toEqual( {
			start_date: '2036-05-10',
			end_date: '2036-05-10',
			start_time: null,
			end_time: null,
			all_day: false,
		} );
	} );

	test( 'keeps an all-day event all-day when other fields change', async () => {
		const created = await (
			await create( {
				start_date: '2036-05-11',
				end_date: '2036-05-12',
				all_day: true,
			} )
		).json();

		const response = await update( created.id, {
			title: 'Still all day',
		} );
		expect( response.ok() ).toBeTruthy();
		expect( timingOf( await read( created.id ) ).all_day ).toBe( true );
	} );

	test( 'rejects invalid and reversed ranges', async () => {
		const cases = [
			[
				{ start_date: '2036-05-12', end_date: '2036-05-11' },
				'end_date_before_start',
			],
			[
				{
					start_date: '2036-05-12',
					start_time: '20:00',
					end_time: '19:00',
				},
				'end_time_before_start',
			],
			[ { start_date: '2036-02-30' }, 'invalid_date' ],
			[
				{ start_date: '2036-05-12', start_time: '25:00' },
				'invalid_time',
			],
			[
				{
					start_date: '2036-05-12',
					all_day: true,
					start_time: '10:00',
				},
				'all_day_times',
			],
		];

		for ( const [ data, reason ] of cases ) {
			const response = await create( data );
			expect( response.status(), reason ).toBe( 400 );
			const body = await response.json();
			expect( body.code ).toBe( 'rest_invalid_event_timing' );
			expect( body.data.reason ).toBe( reason );
		}
	} );

	test( 'does not compare a missing time against midnight', async () => {
		const response = await create( {
			start_date: '2036-05-13',
			start_time: '23:00',
		} );
		expect( response.status() ).toBe( 201 );

		const endOnly = await create( {
			start_date: '2036-05-13',
			end_time: '00:30',
		} );
		expect( endOnly.status() ).toBe( 201 );
	} );

	test( 'accepts a multi-day event ending earlier in the day', async () => {
		const response = await create( {
			start_date: '2036-05-14',
			end_date: '2036-05-15',
			start_time: '22:00',
			end_time: '02:00',
		} );
		expect( response.status() ).toBe( 201 );
	} );

	test( 'rejects the retired datetime fields', async () => {
		const legacy = await create( {
			start_datetime: '2036-05-17 19:00:00',
			end_datetime: '2036-05-17 21:00:00',
		} );
		expect( legacy.status() ).toBe( 400 );
		const legacyBody = await legacy.json();
		expect( legacyBody.code ).toBe( 'rest_retired_timing_fields' );
		expect( legacyBody.data.fields ).toEqual( [
			'start_datetime',
			'end_datetime',
		] );

		const mixed = await create( {
			start_date: '2036-05-16',
			start_time: '10:00:00',
			end_datetime: '2036-05-16 12:00:00',
		} );
		expect( mixed.status() ).toBe( 400 );
		expect( ( await mixed.json() ).code ).toBe(
			'rest_retired_timing_fields'
		);

		// Even a null retired field is refused rather than ignored, and the
		// date stays as it was.
		const created = await (
			await create( {
				start_date: '2036-05-17',
				start_time: '19:00',
				end_time: '21:00',
			} )
		).json();
		const cleared = await update( created.id, { end_datetime: null } );
		expect( cleared.status() ).toBe( 400 );
		expect( ( await cleared.json() ).code ).toBe(
			'rest_retired_timing_fields'
		);
		expect( timingOf( await read( created.id ) ) ).toEqual( {
			start_date: '2036-05-17',
			end_date: '2036-05-17',
			start_time: '19:00:00',
			end_time: '21:00:00',
			all_day: false,
		} );
	} );

	test( 'returns no retired datetime fields', async () => {
		const title = `Timing retired ${ Date.now() }`;
		const created = await (
			await create( {
				title,
				start_date: '2036-05-18',
				start_time: '19:00',
				rrule: 'FREQ=WEEKLY;COUNT=2',
			} )
		).json();
		expect( created ).not.toHaveProperty( 'start_datetime' );
		expect( created ).not.toHaveProperty( 'end_datetime' );

		const master = await read( created.id );
		expect( master.generated_occurrences.length ).toBeGreaterThan( 0 );
		for ( const occurrence of master.generated_occurrences ) {
			expect( occurrence ).not.toHaveProperty( 'start_datetime' );
			expect( occurrence ).toHaveProperty( 'start_date' );
		}

		const siblings = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ created.id }/siblings`,
			{ headers: adminHeaders }
		);
		expect( siblings.ok() ).toBeTruthy();
		for ( const sibling of await siblings.json() ) {
			expect( sibling ).not.toHaveProperty( 'start_datetime' );
			expect( sibling.start_time ).toBe( '19:00:00' );
		}

		// The list sorts by start date; the retired sort key is refused.
		const list = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?orderby=start_date&order=asc&search=${ encodeURIComponent(
				title
			) }`,
			{ headers: adminHeaders }
		);
		expect( list.ok() ).toBeTruthy();
		const [ row ] = await list.json();
		expect( row ).not.toHaveProperty( 'start_datetime' );
		expect( row.children[ 0 ] ).not.toHaveProperty( 'start_datetime' );

		const retiredSort = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?orderby=start_datetime',
			{ headers: adminHeaders }
		);
		expect( retiredSort.status() ).toBe( 400 );
	} );

	test( 'generates series with missing times without inventing any', async () => {
		const series = [
			{ start_time: null, end_time: '19:00' },
			{ start_time: '18:00', end_time: null },
			{ start_time: null, end_time: null },
		];

		for ( const times of series ) {
			const response = await create( {
				start_date: '2036-06-01',
				...times,
				rrule: 'FREQ=WEEKLY;COUNT=3',
			} );
			expect( response.status() ).toBe( 201 );
			const master = await read( ( await response.json() ).id );
			expect( master.generated_occurrences ).toHaveLength( 2 );
			expect( timingOf( master.generated_occurrences[ 1 ] ) ).toEqual( {
				start_date: '2036-06-15',
				end_date: '2036-06-15',
				start_time: times.start_time
					? `${ times.start_time }:00`
					: null,
				end_time: times.end_time ? `${ times.end_time }:00` : null,
				all_day: false,
			} );
		}

		const multiDay = await (
			await create( {
				start_date: '2036-06-05',
				end_date: '2036-06-07',
				start_time: '18:00',
				recurrence_mode: 'manual',
				manual_dates: [ '2036-06-05', '2036-06-19' ],
			} )
		).json();
		expect(
			timingOf( ( await read( multiDay.id ) ).generated_occurrences[ 0 ] )
		).toEqual( {
			start_date: '2036-06-19',
			end_date: '2036-06-21',
			start_time: '18:00:00',
			end_time: null,
			all_day: false,
		} );

		// Clearing the series start time clears it on every inherited date.
		const timed = await (
			await create( {
				start_date: '2036-06-02',
				start_time: '18:00',
				end_time: '19:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			} )
		).json();
		const cleared = await update( timed.id, { start_time: null } );
		expect( cleared.status() ).toBe( 200 );
		const after = await read( timed.id );
		expect(
			after.generated_occurrences.map( ( occ ) => occ.start_time )
		).toEqual( [ null, null ] );
		expect(
			after.generated_occurrences.map( ( occ ) => occ.end_time )
		).toEqual( [ '19:00:00', '19:00:00' ] );
	} );

	test( 'lists canonical timing in the All Events summary', async () => {
		const title = `Timing summary ${ Date.now() }`;
		const created = await (
			await create( {
				title,
				start_date: '2036-05-19',
				end_time: '08:00',
			} )
		).json();

		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${ encodeURIComponent(
				title
			) }`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		const row = ( await response.json() ).find(
			( item ) => item.id === created.id
		);
		expect( timingOf( row ) ).toEqual( {
			start_date: '2036-05-19',
			end_date: '2036-05-19',
			start_time: null,
			end_time: '08:00:00',
			all_day: false,
		} );
		// Copying keeps the start time missing, so it is offered.
		expect( row.copy_url ).toMatch( /_wpnonce=/ );
	} );
} );
