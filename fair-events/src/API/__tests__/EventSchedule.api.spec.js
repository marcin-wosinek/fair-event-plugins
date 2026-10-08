/**
 * Playwright API tests for the event schedule (#1767): enabling it, saving
 * and reloading workshops and program items, validation that never writes a
 * partial schedule, the link to ticket options, and the booking status it
 * gives them on the public get-tickets route.
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

const uniqueEmail = ( label ) =>
	`event-schedule-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Event schedule', () => {
	let api;
	const createdPostIds = [];
	const createdEventDateIds = [];

	const ticketsPayload = ( {
		activities,
		price = 0,
		scheduleEnabled,
		typeId,
	} ) => ( {
		capacity: null,
		ticket_types: [
			{
				// Without its ID the saved type would be replaced by a new one.
				...( typeId ? { id: typeId } : {} ),
				name: 'Regular',
				capacity: null,
				minimum_activities: 0,
				maximum_activities: null,
				activities_enabled: true,
				disable_at: null,
				recurrence_scope: 'single_instance',
				minimum_instances: 1,
				group_ids: [],
			},
		],
		sale_periods: [
			{
				name: 'Always on',
				sale_start: '2020-01-01 00:00:00',
				sale_end: '2099-01-01 00:00:00',
			},
		],
		prices: [ { ticket_type_index: 0, sale_period_index: 0, price } ],
		options: activities,
		settings: { schedule_enabled: scheduleEnabled },
	} );

	/**
	 * Create a post-linked event with one ticket type and its activities.
	 *
	 * @param {Object}   options
	 * @param {string[]} options.activities        Activity names.
	 * @param {boolean}  [options.scheduleEnabled] Whether the schedule starts enabled.
	 * @param {number}   [options.price]           Ticket price.
	 * @param {string}   [options.rrule]           Recurrence rule for a series.
	 * @param {string}   [options.start]           Start datetime.
	 * @param {string}   [options.end]             End datetime.
	 * @return {Promise<Object>} eventDateId, occurrenceIds, typeId, optionIds, config.
	 */
	async function createEvent( {
		activities,
		scheduleEnabled = true,
		price = 0,
		rrule,
		start = '2035-12-01 09:00:00',
		end = '2035-12-02 18:00:00',
	} ) {
		const title = `Event schedule ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		createdPostIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: start,
				end_datetime: end,
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const eventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const occurrenceIds = [
			eventDateId,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
		createdEventDateIds.push( ...occurrenceIds );

		const config = await saveTickets(
			eventDateId,
			ticketsPayload( {
				activities: activities.map( ( name ) => ( {
					name,
					price: 0,
					capacity: null,
				} ) ),
				price,
				scheduleEnabled,
			} )
		);
		expect( config.status, JSON.stringify( config.body ) ).toBe( 200 );

		const optionIds = {};
		for ( const option of config.body.options ) {
			optionIds[ option.name ] = option.id;
		}

		return {
			eventDateId,
			occurrenceIds,
			typeId: config.body.ticket_types[ 0 ].id,
			optionIds,
			config: config.body,
		};
	}

	async function saveTickets( eventDateId, data, path = 'tickets' ) {
		const res = await api.fetch(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/${ path }`,
			{
				method: path === 'tickets' ? 'PUT' : 'POST',
				headers: adminHeaders,
				data,
			}
		);
		return { status: res.status(), body: await res.json() };
	}

	async function getSchedule( eventDateId ) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/schedule`,
			{ headers: adminHeaders }
		);
		return { status: res.status(), body: await res.json() };
	}

	async function saveSchedule( eventDateId, items ) {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/schedule`,
			{ headers: adminHeaders, data: { items } }
		);
		return { status: res.status(), body: await res.json() };
	}

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function buy( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: { name: 'Schedule Buyer', _honeypot: '', ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		return { status: res.status(), body };
	}

	const workshop = ( optionId, overrides = {} ) => ( {
		ticket_option_id: optionId,
		bookable: true,
		start_datetime: '2035-12-01 10:00:00',
		end_datetime: '2035-12-01 11:30:00',
		description: '',
		location: '',
		...overrides,
	} );

	const programItem = ( title, overrides = {} ) => ( {
		ticket_option_id: null,
		bookable: false,
		title,
		start_datetime: '2035-12-01 13:00:00',
		end_datetime: '2035-12-01 14:00:00',
		description: '',
		location: '',
		...overrides,
	} );

	const errorFor = ( body, key, field ) =>
		( body.data?.errors || [] ).find(
			( error ) => error.key === key && error.field === field
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const dateId of createdEventDateIds ) {
			const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
				headers: adminHeaders,
				params: { event_date: dateId },
			} );
			for ( const signup of res.ok() ? await res.json() : [] ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const postId of createdPostIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test( 'requires a signed-in user who can edit events', async () => {
		const { eventDateId } = await createEvent( { activities: [ 'Yoga' ] } );
		const path = `/wp-json/fair-events/v1/event-dates/${ eventDateId }/schedule`;

		const read = await api.get( path );
		expect( read.status() ).toBe( 401 );

		const write = await api.put( path, { data: { items: [] } } );
		expect( write.status() ).toBe( 401 );

		const missing = await getSchedule( 999999999 );
		expect( missing.status ).toBe( 404 );
	} );

	test( 'is off until enabled, and an event without it keeps selling its activities', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Yoga' ],
			scheduleEnabled: false,
		} );

		const eventBefore = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( ( await eventBefore.json() ).schedule_enabled ).toBe( false );

		const before = await getSchedule( eventDateId );
		expect( before.status ).toBe( 200 );
		expect( before.body.schedule_enabled ).toBe( false );
		expect( before.body.items ).toEqual( [] );

		const refused = await saveSchedule( eventDateId, [
			workshop( optionIds.Yoga ),
		] );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'schedule_disabled' );

		const purchase = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'before-enabling' ),
			ticket_option_ids: [ optionIds.Yoga ],
		} );
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );

		const enabled = await saveTickets(
			eventDateId,
			ticketsPayload( {
				activities: [ { id: optionIds.Yoga, name: 'Yoga', price: 0 } ],
				scheduleEnabled: true,
				typeId,
			} )
		);
		expect( enabled.status ).toBe( 200 );
		expect( enabled.body.settings.schedule_enabled ).toBe( true );

		const eventAfter = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( ( await eventAfter.json() ).schedule_enabled ).toBe( true );
		expect(
			( await getSchedule( eventDateId ) ).body.schedule_enabled
		).toBe( true );
	} );

	test( 'saves and reloads workshops and program items, earliest first', async () => {
		const { eventDateId, optionIds } = await createEvent( {
			activities: [ 'Acro', 'Juggling' ],
		} );

		const saved = await saveSchedule( eventDateId, [
			programItem( 'Lunch break', {
				description: 'Soup and bread.\nBring your own cup.',
				location: 'Courtyard',
			} ),
			workshop( optionIds.Juggling, {
				start_datetime: '2035-12-01T15:00',
				end_datetime: '2035-12-01T16:00',
				bookable: false,
				location: 'Room B',
			} ),
			workshop( optionIds.Acro, {
				description: 'Bring a partner.',
				location: 'Main hall',
			} ),
		] );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );

		const { status, body } = await getSchedule( eventDateId );
		expect( status ).toBe( 200 );
		expect( body.read_only ).toBe( false );
		expect( body.warnings ).toEqual( [] );
		expect(
			body.items.map( ( item ) => ( { ...item, id: typeof item.id } ) )
		).toEqual( [
			{
				id: 'number',
				ticket_option_id: optionIds.Acro,
				bookable: true,
				title: 'Acro',
				start_datetime: '2035-12-01 10:00:00',
				end_datetime: '2035-12-01 11:30:00',
				description: 'Bring a partner.',
				location: 'Main hall',
			},
			{
				id: 'number',
				ticket_option_id: null,
				bookable: false,
				title: 'Lunch break',
				start_datetime: '2035-12-01 13:00:00',
				end_datetime: '2035-12-01 14:00:00',
				description: 'Soup and bread.\nBring your own cup.',
				location: 'Courtyard',
			},
			{
				id: 'number',
				ticket_option_id: optionIds.Juggling,
				bookable: false,
				title: 'Juggling',
				start_datetime: '2035-12-01 15:00:00',
				end_datetime: '2035-12-01 16:00:00',
				description: '',
				location: 'Room B',
			},
		] );
		expect( body.options ).toEqual( [
			{ id: optionIds.Acro, name: 'Acro', scheduled: true },
			{ id: optionIds.Juggling, name: 'Juggling', scheduled: true },
		] );

		// Editing an entry keeps its ID; an entry left out is removed.
		const [ acro, lunch ] = body.items;
		const edited = await saveSchedule( eventDateId, [
			{ ...acro, location: 'Studio 2' },
			{ ...lunch, title: 'Long lunch' },
		] );
		expect( edited.status, JSON.stringify( edited.body ) ).toBe( 200 );
		expect(
			edited.body.items.map( ( item ) => [
				item.id,
				item.title,
				item.location,
			] )
		).toEqual( [
			[ acro.id, 'Acro', 'Studio 2' ],
			[ lunch.id, 'Long lunch', 'Courtyard' ],
		] );
	} );

	test( 'accepts parallel and overnight entries, and warns about dates outside the event', async () => {
		const { eventDateId, optionIds } = await createEvent( {
			activities: [ 'Acro', 'Juggling' ],
		} );

		const saved = await saveSchedule( eventDateId, [
			// Same time, same room.
			workshop( optionIds.Acro, { location: 'Main hall' } ),
			workshop( optionIds.Juggling, { location: 'Main hall' } ),
			programItem( 'Night jam', {
				start_datetime: '2035-12-01 22:00:00',
				end_datetime: '2035-12-02 02:00:00',
			} ),
			programItem( 'Farewell brunch', {
				start_datetime: '2035-12-03 10:00:00',
				end_datetime: '2035-12-03 12:00:00',
			} ),
		] );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
		expect( saved.body.items ).toHaveLength( 4 );

		const jam = saved.body.items.find( ( i ) => i.title === 'Night jam' );
		expect( jam.end_datetime ).toBe( '2035-12-02 02:00:00' );

		// The event ends on 2 December: the brunch is kept, with a warning.
		const brunch = saved.body.items.find(
			( i ) => i.title === 'Farewell brunch'
		);
		expect( saved.body.warnings.map( ( w ) => w.id ) ).toEqual( [
			brunch.id,
		] );
	} );

	test( 'rejects invalid entries with a message per field and saves nothing', async () => {
		const { eventDateId, optionIds } = await createEvent( {
			activities: [ 'Acro' ],
		} );
		const other = await createEvent( { activities: [ 'Elsewhere' ] } );
		const otherSaved = await saveSchedule( other.eventDateId, [
			programItem( 'Other event break' ),
		] );
		expect( otherSaved.status ).toBe( 200 );

		const { status, body } = await saveSchedule( eventDateId, [
			{ key: 'valid', ...workshop( optionIds.Acro ) },
			{
				key: 'bad-date',
				...programItem( 'Impossible', {
					start_datetime: '2035-02-30 10:00:00',
					end_datetime: 'tomorrow',
				} ),
			},
			{
				key: 'backwards',
				...programItem( 'Backwards', {
					start_datetime: '2035-12-01 12:00:00',
					end_datetime: '2035-12-01 12:00:00',
				} ),
			},
			{ key: 'untitled', ...programItem( '   ' ) },
			{
				key: 'bookable-item',
				...programItem( 'Talk', { bookable: true } ),
			},
			{
				key: 'foreign-option',
				...workshop( other.optionIds.Elsewhere ),
			},
			{ key: 'twice', ...workshop( optionIds.Acro ) },
			{
				key: 'foreign-item',
				id: otherSaved.body.items[ 0 ].id,
				...programItem( 'Hijacked' ),
			},
		] );

		expect( status ).toBe( 400 );
		expect( body.code ).toBe( 'schedule_invalid' );
		expect( errorFor( body, 'valid', 'start_datetime' ) ).toBeUndefined();
		expect( errorFor( body, 'bad-date', 'start_datetime' ).code ).toBe(
			'invalid_datetime'
		);
		expect( errorFor( body, 'bad-date', 'end_datetime' ).code ).toBe(
			'invalid_datetime'
		);
		expect( errorFor( body, 'backwards', 'end_datetime' ) ).toMatchObject( {
			code: 'end_before_start',
			message: 'The end must be after the start.',
			index: 2,
		} );
		expect( errorFor( body, 'untitled', 'title' ).code ).toBe(
			'title_required'
		);
		expect( errorFor( body, 'bookable-item', 'bookable' ).code ).toBe(
			'bookable_requires_option'
		);
		expect(
			errorFor( body, 'foreign-option', 'ticket_option_id' ).code
		).toBe( 'invalid_option' );
		expect( errorFor( body, 'twice', 'ticket_option_id' ).code ).toBe(
			'duplicate_option'
		);
		expect( errorFor( body, 'foreign-item', 'id' ).code ).toBe(
			'invalid_item'
		);

		// Not even the valid entry was written, and the other event's entry
		// is untouched.
		expect( ( await getSchedule( eventDateId ) ).body.items ).toEqual( [] );
		expect(
			( await getSchedule( other.eventDateId ) ).body.items.map(
				( item ) => item.title
			)
		).toEqual( [ 'Other event break' ] );

		const notAList = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/schedule`,
			{ headers: adminHeaders, data: { items: 'everything' } }
		);
		expect( notAList.status() ).toBe( 400 );
	} );

	test( 'keeps a workshop entry when its add-on is renamed or reordered, and refuses to delete it', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Acro', 'Juggling', 'Spare' ],
		} );
		const saved = await saveSchedule( eventDateId, [
			workshop( optionIds.Acro, { location: 'Main hall' } ),
		] );
		expect( saved.status ).toBe( 200 );
		const entryId = saved.body.items[ 0 ].id;

		const reordered = await saveTickets(
			eventDateId,
			ticketsPayload( {
				activities: [
					{ id: optionIds.Juggling, name: 'Juggling', price: 0 },
					{ id: optionIds.Spare, name: 'Spare', price: 0 },
					{
						id: optionIds.Acro,
						name: 'Partner acrobatics',
						price: 0,
					},
				],
				scheduleEnabled: true,
				typeId,
			} )
		);
		expect( reordered.status, JSON.stringify( reordered.body ) ).toBe(
			200
		);

		const after = await getSchedule( eventDateId );
		expect( after.body.items ).toHaveLength( 1 );
		expect( after.body.items[ 0 ] ).toMatchObject( {
			id: entryId,
			ticket_option_id: optionIds.Acro,
			title: 'Partner acrobatics',
			location: 'Main hall',
			start_datetime: '2035-12-01 10:00:00',
		} );

		// Deleting an unscheduled add-on is fine; the scheduled one is
		// refused before anything is written.
		const withoutAcro = ticketsPayload( {
			activities: [
				{ id: optionIds.Juggling, name: 'Renamed in a refused save' },
			],
			scheduleEnabled: true,
			typeId,
		} );
		const refused = await saveTickets( eventDateId, withoutAcro );
		expect( refused.status ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_option_scheduled' );
		expect( refused.body.data.ticket_option_ids ).toEqual( [
			optionIds.Acro,
		] );
		expect( refused.body.message ).toContain( 'Partner acrobatics' );

		const imported = await saveTickets(
			eventDateId,
			withoutAcro,
			'tickets/import'
		);
		expect( imported.status ).toBe( 409 );
		expect( imported.body.code ).toBe( 'ticket_option_scheduled' );

		const config = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{ headers: adminHeaders }
		);
		expect(
			( await config.json() ).options.map( ( option ) => option.name )
		).toEqual( [ 'Juggling', 'Spare', 'Partner acrobatics' ] );

		// A workshop entry cannot be pointed at another add-on.
		const relinked = await saveSchedule( eventDateId, [
			{ ...after.body.items[ 0 ], ticket_option_id: optionIds.Spare },
		] );
		expect( relinked.status ).toBe( 400 );
		expect( relinked.body.data.errors[ 0 ].code ).toBe(
			'option_link_locked'
		);

		// Off the schedule, the add-on can be deleted again.
		expect( ( await saveSchedule( eventDateId, [] ) ).status ).toBe( 200 );
		expect( ( await saveTickets( eventDateId, withoutAcro ) ).status ).toBe(
			200
		);
	} );

	test( 'a not-bookable workshop cannot be bought, also by a crafted request or with the schedule hidden', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Acro', 'Juggling' ],
		} );
		const saved = await saveSchedule( eventDateId, [
			workshop( optionIds.Acro ),
			workshop( optionIds.Juggling, { bookable: false } ),
			programItem( 'Lunch break' ),
		] );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );

		const refused = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'not-bookable' ),
			ticket_option_ids: [ optionIds.Juggling ],
		} );
		expect( refused.status, JSON.stringify( refused.body ) ).toBe( 409 );
		expect( refused.body.code ).toBe( 'ticket_option_not_bookable' );

		const mixed = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'mixed' ),
			quantity: 2,
			ticket_activities: [ [ optionIds.Acro ], [ optionIds.Juggling ] ],
		} );
		expect( mixed.status ).toBe( 409 );
		expect( mixed.body.code ).toBe( 'ticket_option_not_bookable' );

		const allowed = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'bookable' ),
			ticket_option_ids: [ optionIds.Acro ],
		} );
		expect( allowed.status, JSON.stringify( allowed.body ) ).toBe( 200 );

		// Hiding the schedule keeps its entries and the restriction.
		const hidden = await saveTickets(
			eventDateId,
			ticketsPayload( {
				activities: [
					{ id: optionIds.Acro, name: 'Acro', price: 0 },
					{ id: optionIds.Juggling, name: 'Juggling', price: 0 },
				],
				scheduleEnabled: false,
				typeId,
			} )
		);
		expect( hidden.status ).toBe( 200 );

		const kept = await getSchedule( eventDateId );
		expect( kept.body.schedule_enabled ).toBe( false );
		expect( kept.body.items ).toHaveLength( 3 );

		const stillRefused = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'hidden' ),
			ticket_option_ids: [ optionIds.Juggling ],
		} );
		expect( stillRefused.status ).toBe( 409 );
		expect( stillRefused.body.code ).toBe( 'ticket_option_not_bookable' );
	} );

	test( 'a workshop with tickets cannot be marked not bookable, and its purchases stay', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Acro', 'Juggling' ],
		} );
		const first = await saveSchedule( eventDateId, [
			workshop( optionIds.Acro ),
		] );
		expect( first.status ).toBe( 200 );
		const [ acro ] = first.body.items;

		const email = uniqueEmail( 'holder' );
		const purchase = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email,
			ticket_option_ids: [ optionIds.Acro ],
		} );
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );

		// The blocked switch is reported for its entry; the valid entry sent
		// with it is not saved either.
		const blocked = await saveSchedule( eventDateId, [
			{ key: 'acro', ...acro, bookable: false },
			{ key: 'juggling', ...workshop( optionIds.Juggling ) },
		] );
		expect( blocked.status ).toBe( 409 );
		expect( blocked.body.code ).toBe( 'schedule_booking_locked' );
		expect( errorFor( blocked.body, 'acro', 'bookable' ) ).toMatchObject( {
			code: 'booking_has_dependents',
			id: acro.id,
		} );
		expect( blocked.body.message ).toContain( 'Acro' );

		const unchanged = await getSchedule( eventDateId );
		expect( unchanged.body.items ).toHaveLength( 1 );
		expect( unchanged.body.items[ 0 ].bookable ).toBe( true );

		const signups = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		const signup = ( await signups.json() ).find(
			( row ) => row.email === email
		);
		expect( signup.status ).toBe( 'confirmed' );

		// Other edits to the same entry still save.
		const moved = await saveSchedule( eventDateId, [
			{ ...acro, location: 'Main hall' },
		] );
		expect( moved.status ).toBe( 200 );

		// Linking a held add-on as not bookable is the same change.
		const {
			eventDateId: otherId,
			typeId: otherType,
			optionIds: otherOptions,
		} = await createEvent( { activities: [ 'Held' ] } );
		const held = await buy( {
			event_date_id: otherId,
			ticket_type_id: otherType,
			email: uniqueEmail( 'held' ),
			ticket_option_ids: [ otherOptions.Held ],
		} );
		expect( held.status ).toBe( 200 );
		const linkedOff = await saveSchedule( otherId, [
			workshop( otherOptions.Held, { bookable: false } ),
		] );
		expect( linkedOff.status ).toBe( 409 );
		expect( linkedOff.body.data.errors[ 0 ].code ).toBe(
			'booking_has_dependents'
		);
	} );

	test( 'a reservation awaiting payment also blocks marking its workshop not bookable', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Acro' ],
			price: 20,
		} );
		const saved = await saveSchedule( eventDateId, [
			workshop( optionIds.Acro ),
		] );
		expect( saved.status ).toBe( 200 );

		const reservation = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'reservation' ),
			ticket_option_ids: [ optionIds.Acro ],
		} );
		expect( reservation.status, JSON.stringify( reservation.body ) ).toBe(
			200
		);
		expect( reservation.body.status ).toBe( 'payment_required' );

		const blocked = await saveSchedule( eventDateId, [
			{ ...saved.body.items[ 0 ], bookable: false },
		] );
		expect( blocked.status ).toBe( 409 );
		expect( blocked.body.code ).toBe( 'schedule_booking_locked' );
	} );

	test( 'removing a not-bookable workshop entry makes the add-on bookable again', async () => {
		const { eventDateId, typeId, optionIds } = await createEvent( {
			activities: [ 'Acro' ],
		} );
		expect(
			(
				await saveSchedule( eventDateId, [
					workshop( optionIds.Acro, { bookable: false } ),
				] )
			).status
		).toBe( 200 );
		expect( ( await saveSchedule( eventDateId, [] ) ).status ).toBe( 200 );

		const purchase = await buy( {
			event_date_id: eventDateId,
			ticket_type_id: typeId,
			email: uniqueEmail( 'restored' ),
			ticket_option_ids: [ optionIds.Acro ],
		} );
		expect( purchase.status, JSON.stringify( purchase.body ) ).toBe( 200 );
	} );

	test( 'a series keeps one schedule and shifts it to each date on the wall clock', async () => {
		const settings = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		const originalTimezone = ( await settings.json() ).timezone;
		const setTimezone = async ( timezone ) => {
			const res = await api.post( '/wp-json/wp/v2/settings', {
				headers: adminHeaders,
				data: { timezone },
			} );
			expect( res.ok() ).toBeTruthy();
		};

		// Weekly across the last Sunday of March, when Madrid changes to
		// summer time: a 10:00 workshop stays at 10:00.
		await setTimezone( 'Europe/Madrid' );
		try {
			const { eventDateId, occurrenceIds, optionIds } = await createEvent(
				{
					activities: [ 'Acro' ],
					rrule: 'FREQ=WEEKLY;COUNT=3',
					start: '2035-03-20 09:00:00',
					end: '2035-03-20 18:00:00',
				}
			);
			const occurrences = occurrenceIds.filter(
				( id ) => id !== eventDateId
			);
			expect( occurrences ).toHaveLength( 2 );

			const saved = await saveSchedule( eventDateId, [
				workshop( optionIds.Acro, {
					start_datetime: '2035-03-20 10:00:00',
					end_datetime: '2035-03-20 11:30:00',
				} ),
				programItem( 'Night jam', {
					start_datetime: '2035-03-20 22:00:00',
					end_datetime: '2035-03-21 01:00:00',
				} ),
			] );
			expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
			// The overnight item ends the day after this one-day date.
			expect( saved.body.warnings ).toHaveLength( 1 );

			const second = await getSchedule( occurrences[ 1 ] );
			expect( second.status ).toBe( 200 );
			expect( second.body.read_only ).toBe( true );
			expect( second.body.schedule_event_date_id ).toBe( eventDateId );
			expect( second.body.schedule_enabled ).toBe( true );
			expect(
				second.body.items.map( ( item ) => [
					item.title,
					item.start_datetime,
					item.end_datetime,
				] )
			).toEqual( [
				[ 'Acro', '2035-04-03 10:00:00', '2035-04-03 11:30:00' ],
				[ 'Night jam', '2035-04-03 22:00:00', '2035-04-04 01:00:00' ],
			] );

			const eventRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ occurrences[ 0 ] }`,
				{ headers: adminHeaders }
			);
			expect( ( await eventRes.json() ).schedule_enabled ).toBe( true );

			const refused = await saveSchedule( occurrences[ 0 ], [] );
			expect( refused.status ).toBe( 409 );
			expect( refused.body.code ).toBe( 'schedule_managed_on_series' );
			expect(
				( await getSchedule( eventDateId ) ).body.items
			).toHaveLength( 2 );
		} finally {
			await setTimezone( originalTimezone || '' );
		}
	} );
} );
