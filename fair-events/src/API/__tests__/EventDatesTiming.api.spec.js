/**
 * Playwright API tests for optional event times on EventDatesController
 * (#1819, stage 1).
 *
 * Covers the canonical timing fields (start_date, end_date, start_time,
 * end_time): round trips of all four time combinations, genuine midnight
 * versus an absent time, all-day and multi-day events, omitted-versus-null
 * updates, validation, the deprecated datetime fields, and the temporary
 * refusal of missing times on a series.
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

	test( 'refuses mixing canonical and deprecated fields', async () => {
		const response = await create( {
			start_date: '2036-05-16',
			start_datetime: '2036-05-16 10:00:00',
		} );
		expect( response.status() ).toBe( 400 );
		expect( ( await response.json() ).code ).toBe(
			'rest_mixed_timing_fields'
		);
	} );

	test( 'still accepts the deprecated datetime fields', async () => {
		const response = await create( {
			start_datetime: '2036-05-17 19:00:00',
			end_datetime: '2036-05-17 21:00:00',
		} );
		expect( response.status() ).toBe( 201 );
		const created = await response.json();
		expect( timingOf( created ) ).toEqual( {
			start_date: '2036-05-17',
			end_date: '2036-05-17',
			start_time: '19:00:00',
			end_time: '21:00:00',
			all_day: false,
		} );
		expect( created.start_datetime ).toBe( '2036-05-17 19:00:00' );
		expect( created.end_datetime ).toBe( '2036-05-17 21:00:00' );

		// An empty deprecated start is ignored; a null (or empty) end is
		// what the event form sends for "no end time".
		const noEnd = await update( created.id, {
			start_datetime: null,
			end_datetime: null,
		} );
		expect( noEnd.ok() ).toBeTruthy();
		expect( timingOf( await noEnd.json() ) ).toEqual( {
			start_date: '2036-05-17',
			end_date: '2036-05-17',
			start_time: '19:00:00',
			end_time: null,
			all_day: false,
		} );
	} );

	test( 'moves an open end with a deprecated start-only update', async () => {
		const created = await (
			await create( { start_datetime: '2036-05-18 19:00:00' } )
		).json();
		expect( created.end_datetime ).toBeNull();

		const response = await update( created.id, {
			start_datetime: '2036-05-25 19:00:00',
		} );
		expect( response.ok() ).toBeTruthy();
		expect( timingOf( await response.json() ) ).toEqual( {
			start_date: '2036-05-25',
			end_date: '2036-05-25',
			start_time: '19:00:00',
			end_time: null,
			all_day: false,
		} );
	} );

	test( 'refuses series timings the datetimes cannot hold, for now', async () => {
		const noStart = await create( {
			start_date: '2036-06-01',
			end_time: '19:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( noStart.status() ).toBe( 400 );
		expect( ( await noStart.json() ).code ).toBe(
			'rest_series_times_required'
		);

		const multiDayOpenEnd = await create( {
			start_date: '2036-06-01',
			end_date: '2036-06-02',
			start_time: '18:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( multiDayOpenEnd.status() ).toBe( 400 );

		// A start time without an end was always possible on a series.
		const openEnd = await create( {
			start_date: '2036-06-03',
			start_time: '18:00',
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		expect( openEnd.status() ).toBe( 201 );

		const timed = await create( {
			start_date: '2036-06-01',
			start_time: '18:00',
			end_time: '19:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( timed.status() ).toBe( 201 );
		const master = await timed.json();
		expect( master.generated_occurrences ).toHaveLength( 2 );
		expect( master.generated_occurrences[ 0 ] ).toMatchObject( {
			start_date: '2036-06-08',
			start_time: '18:00:00',
			end_time: '19:00:00',
		} );

		const cleared = await update( master.id, { start_time: null } );
		expect( cleared.status() ).toBe( 400 );
		expect( ( await cleared.json() ).code ).toBe(
			'rest_series_times_required'
		);

		const allDay = await create( {
			start_date: '2036-06-02',
			all_day: true,
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		expect( allDay.status() ).toBe( 201 );
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
		// Copying would invent the missing start time, so it is not offered yet.
		expect( row.copy_url ).toBeUndefined();

		// A start time without an end could always be copied.
		const openEnd = await (
			await create( {
				title: `${ title } open end`,
				start_date: '2036-05-19',
				start_time: '08:00',
			} )
		).json();
		const openEndList = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${ encodeURIComponent(
				`${ title } open end`
			) }`,
			{ headers: adminHeaders }
		);
		const openEndRow = ( await openEndList.json() ).find(
			( item ) => item.id === openEnd.id
		);
		expect( openEndRow.copy_url ).toMatch( /_wpnonce=/ );
	} );
} );
