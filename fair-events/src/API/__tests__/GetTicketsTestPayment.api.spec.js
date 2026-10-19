/**
 * Playwright API tests for the test-payment classification the admin signups
 * list reports (#1866).
 *
 * GetTicketsController::get_items() adds `is_test_payment` to each signup,
 * read from the mode its linked transaction was recorded in: true for a test
 * payment, false for a live payment or a free registration, null when the
 * transaction cannot be found. The integration's current mode never decides.
 *
 * Covers:
 *   - test, live and free purchases, and a missing transaction.
 *   - several signups paid by one transaction.
 *   - switching the integration between test and live mode.
 *   - unsuccessful purchases still listed with their status, so the List can
 *     keep leaving them out (the List itself is covered by
 *     EventSignups.test.jsx and e2e/user-flows/list-print.spec.js).
 *
 * Transactions are seeded through fair-e2e/v1/test-transactions and linked
 * with fair-e2e/v1/signup-transaction (e2e/mu-plugins/fair-e2e-support.php).
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

test.describe( 'GetTicketsController — test-payment classification (#1866)', () => {
	let api;
	let eventPostId;
	let eventDateId;
	let ticketTypeId;
	const signupIds = new Set();
	const transactionIds = new Set();
	const stamp = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;

	async function list() {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		signups.forEach( ( signup ) => signupIds.add( signup.id ) );
		return signups;
	}

	// Each registration is a separate visitor.
	async function register( label ) {
		const email = `test-payment-${ label }-${ stamp }@example.test`;
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				ticket_type_id: ticketTypeId,
				name: `Test payment ${ label }`,
				email,
				quantity: 1,
				_honeypot: '',
			},
		} );
		const body = await res.text();
		await visitor.dispose();
		expect( res.ok(), body ).toBeTruthy();
		const signup = ( await list() ).find(
			( item ) => item.email === email
		);
		expect( signup ).toBeTruthy();
		return signup;
	}

	async function createTransaction( testmode, status = 'paid' ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: adminHeaders,
			data: {
				event_date_id: eventDateId,
				amount: 20,
				status,
				testmode,
				description: `Test payment ${ stamp }`,
			},
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		transactionIds.add( body.id );
		return body.id;
	}

	async function pay( signup, transactionId, status = 'confirmed' ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/signup-transaction', {
			headers: adminHeaders,
			data: {
				signup_id: signup.id,
				transaction_id: transactionId,
				status,
			},
		} );
		expect( res.ok() ).toBeTruthy();
	}

	async function setMode( mode ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/payment-mode', {
			headers: adminHeaders,
			data: { mode },
		} );
		expect( res.ok() ).toBeTruthy();
		expect( ( await res.json() ).mode ).toBe( mode );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Test payment ${ stamp }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-07-01',
				start_time: '10:00:00',
				end_date: '2035-07-01',
				end_time: '12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General Admission',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: 'Always available',
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
		ticketTypeId = ticketsBody.ticket_types[ 0 ].id;
	} );

	test.afterAll( async () => {
		await setMode( 'test' );
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const transactionId of transactionIds ) {
			await api.delete( '/wp-json/fair-e2e/v1/test-transactions', {
				headers: adminHeaders,
				params: { id: transactionId },
			} );
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'classifies each purchase by the mode its payment was recorded in, whatever the current mode', async () => {
		const free = await register( 'free' );
		const live = await register( 'live' );
		const tested = await register( 'tested' );
		const sharedFirst = await register( 'shared-first' );
		const sharedSecond = await register( 'shared-second' );
		const missing = await register( 'missing' );

		await pay( live, await createTransaction( false ) );
		await pay( tested, await createTransaction( true ) );
		const shared = await createTransaction( true );
		await pay( sharedFirst, shared );
		await pay( sharedSecond, shared );
		const gone = await createTransaction( true );
		await pay( missing, gone );
		await api.delete( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: adminHeaders,
			params: { id: gone },
		} );

		const expected = [
			[ free, false ],
			[ live, false ],
			[ tested, true ],
			[ sharedFirst, true ],
			[ sharedSecond, true ],
			[ missing, null ],
		];
		const classify = async () => {
			const signups = await list();
			return expected.map( ( [ signup ] ) => {
				const row = signups.find( ( item ) => item.id === signup.id );
				expect( row.status ).toBe( 'confirmed' );
				return row.is_test_payment;
			} );
		};

		await setMode( 'test' );
		expect( await classify() ).toEqual(
			expected.map( ( [ , value ] ) => value )
		);

		await setMode( 'live' );
		expect( await classify() ).toEqual(
			expected.map( ( [ , value ] ) => value )
		);

		await setMode( 'test' );
		expect( await classify() ).toEqual(
			expected.map( ( [ , value ] ) => value )
		);
	} );

	test( 'reports unsuccessful test purchases with their own status', async () => {
		const statuses = [
			'pending_payment',
			'failed',
			'expired',
			'cancelled',
		];
		const unsuccessful = [];
		for ( const status of statuses ) {
			const signup = await register( `unsuccessful-${ status }` );
			await pay(
				signup,
				await createTransaction(
					true,
					'pending_payment' === status ? 'open' : status
				),
				status
			);
			unsuccessful.push( signup );
		}

		const signups = await list();
		expect(
			unsuccessful.map( ( signup ) => {
				const row = signups.find( ( item ) => item.id === signup.id );
				return [ row.status, row.is_test_payment ];
			} )
		).toEqual( statuses.map( ( status ) => [ status, true ] ) );
	} );
} );
