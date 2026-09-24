/**
 * Playwright API tests for individual ticket units (#1531).
 *
 * New signups are created through the public get-tickets route. Legacy
 * signups, payment-driven transitions, and backfill batches use the
 * test-only fair-e2e/v1/ticket-units routes (e2e/mu-plugins), since this
 * environment has no live payment provider and no pre-unit data.
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
	`ticket-units-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe( 'Ticket units', () => {
	let api;
	let eventPostId;
	let eventDateId;
	let seriesPostId;
	let seriesMasterId;
	let seriesOccurrenceIds;
	let seriesTicketTypeId;

	async function createPostLinkedEventDate( data ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: data.title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: { ...data, link_type: 'post' },
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();

		// The create endpoint doesn't wire event_id through; link with a PUT.
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		return { postId, eventDate: edBody };
	}

	async function listSignups( forEventDateId ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: forEventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	// Each purchase is a separate visitor: fair-audience's session cookie
	// would otherwise make later buyers resolve to the first participant.
	async function postAsVisitor( data ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data,
		} );
		const body = await res.json();
		await visitor.dispose();
		return { res, body };
	}

	async function buyFreeTickets( email, quantity ) {
		const { res, body } = await postAsVisitor( {
			event_date_id: eventDateId,
			name: 'Ticket Units Buyer',
			email,
			quantity,
			_honeypot: '',
		} );
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.status ).toBe( 'confirmed' );

		const signups = ( await listSignups( eventDateId ) ).filter(
			( signup ) => signup.email === email
		);
		return signups
			.map( ( signup ) => Number( signup.id ) )
			.sort( ( a, b ) => a - b );
	}

	async function unitsOf( signupId ) {
		const res = await api.get(
			`/wp-json/fair-e2e/v1/ticket-units/${ signupId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function transition( signupId, action, extra = {} ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/ticket-units/transition',
			{
				headers: adminHeaders,
				data: { signup_id: signupId, action, ...extra },
			}
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	async function backfill( data ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/ticket-units/backfill',
			{ headers: adminHeaders, data }
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body;
	}

	async function seedLegacySignups( email, signups ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/ticket-units/legacy-signups',
			{
				headers: adminHeaders,
				data: { event_date_id: eventDateId, email, signups },
			}
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).signup_ids;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const single = await createPostLinkedEventDate( {
			title: `Ticket units ${ Date.now() }`,
			start_datetime: '2035-08-01 10:00:00',
			end_datetime: '2035-08-01 12:00:00',
		} );
		eventPostId = single.postId;
		eventDateId = single.eventDate.id;

		const series = await createPostLinkedEventDate( {
			title: `Ticket units series ${ Date.now() }`,
			start_datetime: '2035-09-01 10:00:00',
			end_datetime: '2035-09-01 12:00:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		seriesPostId = series.postId;
		seriesMasterId = series.eventDate.id;
		seriesOccurrenceIds = [
			seriesMasterId,
			...series.eventDate.generated_occurrences.map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ seriesMasterId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Pick your sessions',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'multiple_instances',
							minimum_instances: 2,
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
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 0,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		seriesTicketTypeId = ticketsBody.ticket_types?.[ 0 ]?.id;
		expect( seriesTicketTypeId ).toBeTruthy();
	} );

	test.afterAll( async () => {
		for ( const dateId of [
			eventDateId,
			...( seriesOccurrenceIds || [] ),
		] ) {
			if ( ! dateId ) {
				continue;
			}
			for ( const signup of await listSignups( dateId ) ) {
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const postId of [ eventPostId, seriesPostId ] ) {
			if ( postId ) {
				await api.delete(
					`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
					{ headers: adminHeaders }
				);
			}
		}
		await api.dispose();
	} );

	test( 'a quantity-1 signup owns exactly one unit linked to its purchaser', async () => {
		const [ signupId ] = await buyFreeTickets( uniqueEmail( 'one' ), 1 );
		const { signup, tickets } = await unitsOf( signupId );

		expect( tickets ).toHaveLength( 1 );
		const [ unit ] = tickets;
		expect( Number( unit.unit_position ) ).toBe( 1 );
		expect( Number( unit.event_date_id ) ).toBe( eventDateId );
		expect( unit.ticket_type_id ).toBeNull();
		expect( unit.status ).toBe( 'confirmed' );
		expect( unit.reference ).toMatch( /^[0-9a-f]{32}$/ );
		expect( signup.participant_id ).toBeTruthy();
		expect( unit.purchaser_participant_id ).toBe( signup.participant_id );
		expect( unit.holder_participant_id ).toBe( signup.participant_id );
	} );

	test( 'a quantity-3 signup owns three distinct units without duplicating participants', async () => {
		const email = uniqueEmail( 'three' );
		const [ signupId ] = await buyFreeTickets( email, 3 );
		const state = await unitsOf( signupId );

		expect( state.tickets ).toHaveLength( 3 );
		expect(
			state.tickets.map( ( unit ) => Number( unit.unit_position ) )
		).toEqual( [ 1, 2, 3 ] );
		expect(
			new Set( state.tickets.map( ( unit ) => unit.reference ) ).size
		).toBe( 3 );
		expect( new Set( state.tickets.map( ( unit ) => unit.id ) ).size ).toBe(
			3
		);
		for ( const unit of state.tickets ) {
			expect( Number( unit.signup_id ) ).toBe( signupId );
			expect( unit.purchaser_participant_id ).toBe(
				state.signup.participant_id
			);
		}
		expect( state.participants_with_email ).toBe( 1 );
		expect( state.event_participation_rows ).toBe( 1 );

		// A second purchase by the same email reuses the participant.
		const signupIds = await buyFreeTickets( email, 2 );
		expect( signupIds ).toHaveLength( 2 );
		const second = await unitsOf( signupIds[ 1 ] );
		expect( second.tickets ).toHaveLength( 2 );
		expect( second.signup.participant_id ).toBe(
			state.signup.participant_id
		);
		expect( second.participants_with_email ).toBe( 1 );
		expect( second.event_participation_rows ).toBe( 1 );
	} );

	test( 'a multiple-occurrence purchase gives each occurrence signup its own unit', async () => {
		const email = uniqueEmail( 'series' );
		const chosen = seriesOccurrenceIds.slice( 0, 2 );
		const { res, body } = await postAsVisitor( {
			event_date_id: seriesMasterId,
			name: 'Series Buyer',
			email,
			ticket_type_id: seriesTicketTypeId,
			event_date_ids: chosen,
		} );
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.status ).toBe( 'confirmed' );

		for ( const occurrenceId of chosen ) {
			const signup = ( await listSignups( occurrenceId ) ).find(
				( row ) => row.email === email
			);
			expect( signup ).toBeTruthy();
			const { tickets } = await unitsOf( signup.id );
			expect( tickets ).toHaveLength( 1 );
			expect( Number( tickets[ 0 ].event_date_id ) ).toBe( occurrenceId );
			expect( Number( tickets[ 0 ].ticket_type_id ) ).toBe(
				seriesTicketTypeId
			);
		}
	} );

	test( 'unit status follows payment hold, expiry, retry, and confirmation', async () => {
		const [ signupId ] = await buyFreeTickets( uniqueEmail( 'paid' ), 2 );
		const statuses = ( state ) =>
			state.tickets.map( ( unit ) => unit.status );

		let state = await transition( signupId, 'hold', {
			transaction_id: 900001,
		} );
		expect( statuses( state ) ).toEqual( [
			'pending_payment',
			'pending_payment',
		] );

		state = await transition( signupId, 'expire' );
		expect( state.signup.status ).toBe( 'expired' );
		expect( statuses( state ) ).toEqual( [ 'expired', 'expired' ] );

		// Retry reopens the hold under a new transaction.
		state = await transition( signupId, 'hold', {
			transaction_id: 900002,
		} );
		expect( statuses( state ) ).toEqual( [
			'pending_payment',
			'pending_payment',
		] );

		state = await transition( signupId, 'confirm_paid' );
		expect( state.result ).toBe( true );
		expect( statuses( state ) ).toEqual( [ 'confirmed', 'confirmed' ] );

		// A repeated paid callback is a no-op.
		state = await transition( signupId, 'confirm_paid' );
		expect( state.result ).toBe( false );
		expect( state.tickets ).toHaveLength( 2 );
		expect( statuses( state ) ).toEqual( [ 'confirmed', 'confirmed' ] );
	} );

	test( 'failed payments and checkout cancellation mark units failed', async () => {
		const [ failedId, cancelledId ] = await Promise.all( [
			buyFreeTickets( uniqueEmail( 'failed' ), 1 ).then(
				( ids ) => ids[ 0 ]
			),
			buyFreeTickets( uniqueEmail( 'cancelled' ), 1 ).then(
				( ids ) => ids[ 0 ]
			),
		] );

		await transition( failedId, 'hold', { transaction_id: 900003 } );
		let state = await transition( failedId, 'fail_pending' );
		expect( state.tickets[ 0 ].status ).toBe( 'failed' );

		await transition( cancelledId, 'hold', { transaction_id: 900004 } );
		state = await transition( cancelledId, 'cancel_pending' );
		expect( state.signup.status ).toBe( 'failed' );
		expect( state.tickets[ 0 ].status ).toBe( 'failed' );
	} );

	test( 'deleting a signup removes its units', async () => {
		const [ signupId ] = await buyFreeTickets( uniqueEmail( 'delete' ), 2 );
		expect( ( await unitsOf( signupId ) ).tickets ).toHaveLength( 2 );

		const res = await api.delete(
			`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 200 );

		const after = await unitsOf( signupId );
		expect( after.signup ).toBeNull();
		expect( after.tickets ).toHaveLength( 0 );
	} );

	test( 'anonymizing a participant unlinks units but keeps them', async () => {
		const [ signupId ] = await buyFreeTickets( uniqueEmail( 'gdpr' ), 2 );
		const before = await unitsOf( signupId );
		const participantId = before.signup.participant_id;
		expect( participantId ).toBeTruthy();

		await transition( signupId, 'anonymize', {
			participant_id: participantId,
		} );

		const after = await unitsOf( signupId );
		expect( after.tickets ).toHaveLength( 2 );
		for ( const unit of after.tickets ) {
			expect( unit.purchaser_participant_id ).toBeNull();
			expect( unit.holder_participant_id ).toBeNull();
			expect( unit.status ).toBe( 'confirmed' );
		}
		expect( after.tickets.map( ( unit ) => unit.reference ) ).toEqual(
			before.tickets.map( ( unit ) => unit.reference )
		);
	} );

	test.describe( 'without fair-audience', () => {
		// Dependents first: fair-audience-experimental requires fair-audience.
		const plugins = [
			'fair-audience-experimental/fair-audience-experimental',
			'fair-audience/fair-audience',
		];
		const originalStatus = {};

		test.beforeAll( async () => {
			const res = await api.get( '/wp-json/wp/v2/plugins', {
				headers: adminHeaders,
			} );
			expect( res.ok() ).toBeTruthy();
			const installed = await res.json();
			for ( const slug of plugins ) {
				const plugin = installed.find( ( row ) => row.plugin === slug );
				originalStatus[ slug ] = plugin ? plugin.status : 'inactive';
				if ( originalStatus[ slug ] !== 'inactive' ) {
					const deactivate = await api.put(
						`/wp-json/wp/v2/plugins/${ slug }`,
						{ headers: adminHeaders, data: { status: 'inactive' } }
					);
					expect( deactivate.ok(), slug ).toBeTruthy();
				}
			}
		} );

		test.afterAll( async () => {
			for ( const slug of [ ...plugins ].reverse() ) {
				if (
					originalStatus[ slug ] &&
					originalStatus[ slug ] !== 'inactive'
				) {
					await api.put( `/wp-json/wp/v2/plugins/${ slug }`, {
						headers: adminHeaders,
						data: { status: originalStatus[ slug ] },
					} );
				}
			}
		} );

		test( 'units are created with no participant link', async () => {
			const [ signupId ] = await buyFreeTickets(
				uniqueEmail( 'standalone' ),
				2
			);
			const { signup, tickets } = await unitsOf( signupId );

			expect( signup.participant_id ).toBeNull();
			expect( tickets ).toHaveLength( 2 );
			for ( const unit of tickets ) {
				expect( unit.status ).toBe( 'confirmed' );
				expect( unit.purchaser_participant_id ).toBeNull();
				expect( unit.holder_participant_id ).toBeNull();
			}
		} );
	} );

	test.describe( 'backfill', () => {
		// Legacy signups predate units; statuses cover every stored state.
		// Historical checkout cancellation is stored as 'failed'.
		const legacy = [
			{ status: 'confirmed', quantity: 1 },
			{ status: 'pending_payment', quantity: 2, transaction_id: 900010 },
			{ status: 'expired', quantity: 3, transaction_id: 900011 },
			{ status: 'failed', quantity: 1, transaction_id: 900012 },
			{ status: 'confirmed', quantity: 2 },
		];
		let email;
		let legacyIds;

		test.beforeAll( async () => {
			email = uniqueEmail( 'legacy' );
			legacyIds = await seedLegacySignups( email, legacy );
			expect( legacyIds ).toHaveLength( legacy.length );
		} );

		test( 'legacy signups start without units', async () => {
			for ( const signupId of legacyIds ) {
				expect( ( await unitsOf( signupId ) ).tickets ).toHaveLength(
					0
				);
			}
		} );

		test( 'an interrupted run resumes from its cursor and completes', async () => {
			// One batch of two signups, then stop — as if the request died.
			const partial = await backfill( {
				restart: true,
				last_signup_id: legacyIds[ 0 ] - 1,
				batch_size: 2,
				max_batches: 1,
			} );
			expect( partial.state.status ).toBe( 'running' );
			expect( partial.state.last_signup_id ).toBe( legacyIds[ 1 ] );
			expect( partial.audit.missing ).toEqual(
				expect.arrayContaining( legacyIds.slice( 2 ) )
			);
			expect( ( await unitsOf( legacyIds[ 0 ] ) ).tickets ).toHaveLength(
				1
			);
			expect( ( await unitsOf( legacyIds[ 1 ] ) ).tickets ).toHaveLength(
				2
			);
			expect( ( await unitsOf( legacyIds[ 2 ] ) ).tickets ).toHaveLength(
				0
			);

			const resumed = await backfill( {
				batch_size: 2,
				max_batches: 50,
			} );
			expect( resumed.state.status ).toBe( 'complete' );
			expect( resumed.state.completed_at ).toBeTruthy();
			expect( resumed.audit ).toEqual( { missing: [], excess: [] } );

			for ( const [ index, signupId ] of legacyIds.entries() ) {
				const { signup, tickets } = await unitsOf( signupId );
				expect( tickets ).toHaveLength( legacy[ index ].quantity );
				expect(
					tickets.map( ( unit ) => Number( unit.unit_position ) )
				).toEqual(
					Array.from(
						{ length: legacy[ index ].quantity },
						( _, i ) => i + 1
					)
				);
				for ( const unit of tickets ) {
					expect( unit.status ).toBe( legacy[ index ].status );
					expect( Number( unit.event_date_id ) ).toBe( eventDateId );
				}
				// Purchase and payment history is untouched.
				expect( signup.status ).toBe( legacy[ index ].status );
				expect( Number( signup.quantity ) ).toBe(
					legacy[ index ].quantity
				);
				expect(
					signup.transaction_id
						? Number( signup.transaction_id )
						: null
				).toBe( legacy[ index ].transaction_id ?? null );
			}
		} );

		test( 'repeated runs do not duplicate units', async () => {
			const before = await Promise.all(
				legacyIds.map( async ( id ) => ( await unitsOf( id ) ).tickets )
			);

			for ( let run = 0; run < 2; run++ ) {
				const result = await backfill( {
					restart: true,
					last_signup_id: legacyIds[ 0 ] - 1,
					batch_size: 3,
					max_batches: 50,
				} );
				expect( result.state.status ).toBe( 'complete' );
			}

			const after = await Promise.all(
				legacyIds.map( async ( id ) => ( await unitsOf( id ) ).tickets )
			);
			expect(
				after.map( ( units ) => units.map( ( u ) => u.id ) )
			).toEqual( before.map( ( units ) => units.map( ( u ) => u.id ) ) );
			expect(
				after.map( ( units ) => units.map( ( u ) => u.reference ) )
			).toEqual(
				before.map( ( units ) => units.map( ( u ) => u.reference ) )
			);
		} );

		test( 'mismatched unit counts are detected and repaired', async () => {
			const expiredId = legacyIds[ 2 ];
			const untouched = ( await unitsOf( expiredId ) ).tickets;

			await api.post( '/wp-json/fair-e2e/v1/ticket-units/tamper', {
				headers: adminHeaders,
				data: { signup_id: expiredId, action: 'remove', position: 2 },
			} );
			const tamperRes = await api.post(
				'/wp-json/fair-e2e/v1/ticket-units/tamper',
				{
					headers: adminHeaders,
					data: {
						signup_id: legacyIds[ 0 ],
						action: 'add',
						position: 4,
					},
				}
			);
			const audit = await tamperRes.json();
			expect( audit.missing ).toContain( expiredId );
			expect( audit.excess ).toContain( legacyIds[ 0 ] );

			const result = await backfill( {
				restart: true,
				last_signup_id: legacyIds[ 0 ] - 1,
				batch_size: 10,
				max_batches: 50,
			} );
			expect( result.state.status ).toBe( 'complete' );
			expect( result.audit ).toEqual( { missing: [], excess: [] } );

			const repaired = ( await unitsOf( expiredId ) ).tickets;
			expect(
				repaired.map( ( u ) => Number( u.unit_position ) )
			).toEqual( [ 1, 2, 3 ] );
			// Surviving units keep their identity; only position 2 is new.
			expect( repaired[ 0 ].id ).toBe( untouched[ 0 ].id );
			expect( repaired[ 2 ].id ).toBe( untouched[ 2 ].id );
			expect( repaired[ 1 ].id ).not.toBe( untouched[ 1 ].id );
			expect( ( await unitsOf( legacyIds[ 0 ] ) ).tickets ).toHaveLength(
				1
			);
		} );

		test( 'later participant matching links legacy units without new rows', async () => {
			// The legacy email matches no participant yet; buying with it
			// creates one, then the email backfill links the legacy rows.
			const before = await unitsOf( legacyIds[ 4 ] );
			expect( before.signup.participant_id ).toBeNull();
			expect( before.tickets[ 0 ].purchaser_participant_id ).toBeNull();

			const purchaseId = ( await buyFreeTickets( email, 1 ) ).pop();
			const participantId = ( await unitsOf( purchaseId ) ).signup
				.participant_id;

			await transition( legacyIds[ 4 ], 'backfill_participants' );

			const after = await unitsOf( legacyIds[ 4 ] );
			expect( after.signup.participant_id ).toBe( participantId );
			expect( after.tickets ).toHaveLength( 2 );
			for ( const unit of after.tickets ) {
				expect( unit.purchaser_participant_id ).toBe( participantId );
				expect( unit.holder_participant_id ).toBe( participantId );
			}
			expect( after.participants_with_email ).toBe( 1 );
		} );
	} );
} );
