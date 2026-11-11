/**
 * Playwright API tests for event cash income and personally paid expenses
 * (#2272).
 *
 * Financial entries carry an optional payment source (event_cash or
 * personal_funds) and, for personal expenses, a payer name.
 * GET /fair-finance/v1/financial-entries/event-summary?event_date_id=N sums
 * them for one event date: cash income, event-cash expenses, net cash
 * movement, every expense once, and personally paid amounts by payer.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const basicAuth = ( user, password ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ user }:${ password }` ).toString(
		'base64'
	) }`,
} );
const headers = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const SUMMARY = `${ ENTRIES }/event-summary`;
const TOTALS = `${ ENTRIES }/totals`;
const DAY = '2031-05-16';

test.describe( 'FinancialEntry event cash', () => {
	let api;
	let postId;
	let eventDateId;
	let subscriber;
	const entryIds = [];
	const ids = {};

	const create = ( data ) =>
		api.post( ENTRIES, {
			headers,
			data: { entry_date: DAY, event_date_id: eventDateId, ...data },
		} );

	const createOk = async ( data ) => {
		const res = await create( data );
		expect( res.status() ).toBe( 201 );
		const body = await res.json();
		entryIds.push( body.id );
		return body;
	};

	const summary = async () => {
		const res = await api.get(
			`${ SUMMARY }?event_date_id=${ eventDateId }`,
			{
				headers,
			}
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const expectFieldError = async ( res, field, message ) => {
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.data.params[ field ] ).toBeTruthy();
		if ( message ) {
			expect( body.message ).toMatch( message );
		}
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const suffix = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers,
			data: { title: `Event cash ${ suffix }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;
		const ensureRes = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers, data: { post_id: postId } }
		);
		expect( ensureRes.ok() ).toBeTruthy();
		eventDateId = ( await ensureRes.json() ).id;

		const username = `event-cash-subscriber-${ suffix }`;
		const password = 'Event-cash-test-2272!';
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriber = {
			id: ( await userRes.json() ).id,
			headers: basicAuth( username, password ),
		};

		// €115 cash income, €20 event-cash expense, €30 personal expense.
		ids.income = (
			await createOk( {
				amount: 115,
				entry_type: 'income',
				description: 'Gate sales Friday',
				payment_source: 'event_cash',
			} )
		).id;
		ids.cash = (
			await createOk( {
				amount: 20,
				entry_type: 'cost',
				description: 'Change float top-up',
				payment_source: 'event_cash',
			} )
		).id;
		ids.personal = (
			await createOk( {
				amount: 30,
				entry_type: 'cost',
				description: 'Decorations',
				payment_source: 'personal_funds',
				payer_name: 'Anna',
			} )
		).id;
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers,
				}
			);
		}
		if ( subscriber ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriber.id }?force=true&reassign=1`,
				{ headers }
			);
		}
		await api.dispose();
	} );

	test( 'stores the source and payer and returns them', async () => {
		const res = await api.get( `${ ENTRIES }/${ ids.personal }`, {
			headers,
		} );
		const body = await res.json();
		expect( body ).toMatchObject( {
			amount: 30,
			entry_type: 'cost',
			event_date_id: eventDateId,
			payment_source: 'personal_funds',
			payer_name: 'Anna',
		} );
	} );

	test( 'sums €95 net cash movement, €50 expenses and €30 personally paid', async () => {
		expect( await summary() ).toEqual( {
			cash_income: 115,
			event_cash_expenses: 20,
			net_cash_movement: 95,
			total_expenses: 50,
			personally_paid: 30,
			personally_paid_by_payer: [ { payer_name: 'Anna', amount: 30 } ],
		} );

		// Accounting counts every expense once.
		const totals = await (
			await api.get( `${ TOTALS }?event_date_id=${ eventDateId }`, {
				headers,
			} )
		).json();
		expect( totals.total_cost ).toBe( 50 );
		expect( totals.total_income ).toBe( 115 );
	} );

	test( 'lists only classified entries with the classified filter, independently of totals', async () => {
		const legacy = await createOk( {
			amount: 7,
			entry_type: 'cost',
			description: 'Unclassified legacy cost',
		} );
		try {
			const res = await api.get(
				`${ ENTRIES }?event_date_id=${ eventDateId }&classified=1&per_page=1`,
				{ headers }
			);
			const body = await res.json();
			expect( body.total ).toBe( 3 );
			expect( body.pages ).toBe( 3 );
			expect( body.entries ).toHaveLength( 1 );

			// Unclassified costs count in total expenses only, never as cash
			// or personally paid.
			const totals = await summary();
			expect( totals.total_expenses ).toBe( 57 );
			expect( totals.event_cash_expenses ).toBe( 20 );
			expect( totals.personally_paid ).toBe( 30 );
			expect( totals.net_cash_movement ).toBe( 95 );
			expect( legacy.payment_source ).toBeNull();
			expect( legacy.payer_name ).toBeNull();
		} finally {
			await api.delete( `${ ENTRIES }/${ legacy.id }`, { headers } );
		}
	} );

	test( 'counts a split legacy cost once', async () => {
		const parent = await createOk( {
			amount: 40,
			entry_type: 'cost',
			description: 'Split legacy cost',
		} );
		try {
			const split = await api.post( `${ ENTRIES }/${ parent.id }/split`, {
				headers,
				data: {
					allocations: [
						{ amount: 25, event_date_id: eventDateId },
						{ amount: 15, event_date_id: eventDateId },
					],
				},
			} );
			expect( split.status() ).toBe( 201 );
			expect( ( await summary() ).total_expenses ).toBe( 90 );
		} finally {
			await api.delete( `${ ENTRIES }/${ parent.id }`, { headers } );
		}
	} );

	test( 'groups personal expenses by payer', async () => {
		const second = await createOk( {
			amount: 12.5,
			entry_type: 'cost',
			description: 'Snacks',
			payment_source: 'personal_funds',
			payer_name: 'anna ',
		} );
		const third = await createOk( {
			amount: 8,
			entry_type: 'cost',
			description: 'Tape',
			payment_source: 'personal_funds',
			payer_name: 'Bartek',
		} );
		try {
			const totals = await summary();
			expect( totals.personally_paid ).toBe( 50.5 );
			expect( totals.personally_paid_by_payer ).toEqual( [
				{ payer_name: 'Anna', amount: 42.5 },
				{ payer_name: 'Bartek', amount: 8 },
			] );
		} finally {
			await api.delete( `${ ENTRIES }/${ second.id }`, { headers } );
			await api.delete( `${ ENTRIES }/${ third.id }`, { headers } );
		}
	} );

	test( 'editing and deleting update the totals', async () => {
		const extra = await createOk( {
			amount: 10,
			entry_type: 'cost',
			description: 'Ice',
			payment_source: 'event_cash',
		} );
		expect( ( await summary() ).net_cash_movement ).toBe( 85 );

		// Moving it to personal funds: no longer a cash outflow.
		const put = await api.put( `${ ENTRIES }/${ extra.id }`, {
			headers,
			data: {
				amount: 10,
				entry_type: 'cost',
				entry_date: DAY,
				description: 'Ice',
				event_date_id: eventDateId,
				payment_source: 'personal_funds',
				payer_name: 'Bartek',
			},
		} );
		expect( put.status() ).toBe( 200 );
		let totals = await summary();
		expect( totals.net_cash_movement ).toBe( 95 );
		expect( totals.personally_paid ).toBe( 40 );
		expect( totals.total_expenses ).toBe( 60 );

		const del = await api.delete( `${ ENTRIES }/${ extra.id }`, {
			headers,
		} );
		expect( del.status() ).toBe( 200 );
		totals = await summary();
		expect( totals.total_expenses ).toBe( 50 );
		expect( totals.personally_paid ).toBe( 30 );
	} );

	test( 'keeps the source and payer when an update omits them', async () => {
		const put = await api.put( `${ ENTRIES }/${ ids.personal }`, {
			headers,
			data: {
				amount: 30,
				entry_type: 'cost',
				entry_date: '2031-05-17',
				description: 'Decorations and balloons',
				event_date_id: eventDateId,
			},
		} );
		expect( put.status() ).toBe( 200 );
		const body = await put.json();
		expect( body.payment_source ).toBe( 'personal_funds' );
		expect( body.payer_name ).toBe( 'Anna' );
		expect( body.event_date_id ).toBe( eventDateId );
		expect( body.entry_date ).toBe( '2031-05-17' );
	} );

	test( 'rejects an edit that would leave a classified entry invalid', async () => {
		// Clearing the note of a classified expense.
		await expectFieldError(
			await api.put( `${ ENTRIES }/${ ids.cash }`, {
				headers,
				data: {
					amount: 20,
					entry_type: 'cost',
					entry_date: DAY,
					description: '',
					event_date_id: eventDateId,
				},
			} ),
			'description'
		);
		// Unlinking it from the event.
		await expectFieldError(
			await api.put( `${ ENTRIES }/${ ids.cash }`, {
				headers,
				data: {
					amount: 20,
					entry_type: 'cost',
					entry_date: DAY,
					description: 'Change float top-up',
				},
			} ),
			'event_date_id'
		);
		// Turning a personal expense into income.
		await expectFieldError(
			await api.put( `${ ENTRIES }/${ ids.personal }`, {
				headers,
				data: {
					amount: 30,
					entry_type: 'income',
					entry_date: DAY,
					description: 'Decorations',
					event_date_id: eventDateId,
				},
			} ),
			'payment_source'
		);
		// The stored entry is unchanged.
		const body = await (
			await api.get( `${ ENTRIES }/${ ids.cash }`, { headers } )
		).json();
		expect( body.description ).toBe( 'Change float top-up' );
		expect( body.event_date_id ).toBe( eventDateId );
	} );

	test( 'validates new operations with field errors', async () => {
		await expectFieldError(
			await create( {
				amount: 30,
				entry_type: 'cost',
				description: 'No payer',
				payment_source: 'personal_funds',
			} ),
			'payer_name',
			/name of the person who paid/
		);
		await expectFieldError(
			await create( {
				amount: 30,
				entry_type: 'cost',
				description: 'Blank payer',
				payment_source: 'personal_funds',
				payer_name: '   ',
			} ),
			'payer_name'
		);
		await expectFieldError(
			await create( {
				amount: 20,
				entry_type: 'cost',
				description: '  ',
				payment_source: 'event_cash',
			} ),
			'description',
			/note/
		);
		await expectFieldError(
			await create( {
				amount: 20,
				entry_type: 'income',
				payment_source: 'personal_funds',
				payer_name: 'Anna',
			} ),
			'payment_source'
		);
		await expectFieldError(
			await create( {
				amount: 20,
				entry_type: 'income',
				payment_source: 'bank',
			} ),
			'payment_source'
		);
		for ( const amount of [ 0, -5, 'abc', 12.345, 100000000 ] ) {
			await expectFieldError(
				await create( {
					amount,
					entry_type: 'income',
					payment_source: 'event_cash',
				} ),
				'amount'
			);
		}
		for ( const entryDate of [ '2031-02-30', 'tomorrow' ] ) {
			await expectFieldError(
				await create( {
					amount: 5,
					entry_type: 'income',
					entry_date: entryDate,
					payment_source: 'event_cash',
				} ),
				'entry_date'
			);
		}
		await expectFieldError(
			await create( {
				amount: 5,
				entry_type: 'income',
				payment_source: 'event_cash',
				event_date_id: null,
			} ),
			'event_date_id'
		);
		await expectFieldError(
			await create( {
				amount: 5,
				entry_type: 'income',
				payment_source: 'event_cash',
				event_date_id: 999999999,
			} ),
			'event_date_id'
		);

		// None of the rejected requests created an entry.
		expect( ( await summary() ).cash_income ).toBe( 115 );
	} );

	test( 'refuses to split or match a classified entry', async () => {
		const split = await api.post( `${ ENTRIES }/${ ids.cash }/split`, {
			headers,
			data: {
				allocations: [ { amount: 10 }, { amount: 10 } ],
			},
		} );
		expect( split.status() ).toBe( 409 );
		expect( ( await split.json() ).code ).toBe( 'rest_entry_classified' );

		const match = await api.post( `${ ENTRIES }/${ ids.income }/match`, {
			headers,
			data: { transaction_id: 999999999 },
		} );
		expect( match.status() ).toBe( 409 );
		expect( ( await match.json() ).code ).toBe( 'rest_entry_classified' );
	} );

	test( 'refuses to classify a split entry', async () => {
		const parent = await createOk( {
			amount: 40,
			entry_type: 'cost',
			description: 'Split, then classified',
		} );
		try {
			const split = await api.post( `${ ENTRIES }/${ parent.id }/split`, {
				headers,
				data: {
					allocations: [
						{ amount: 25, event_date_id: eventDateId },
						{ amount: 15, event_date_id: eventDateId },
					],
				},
			} );
			expect( split.status() ).toBe( 201 );
			const put = await api.put( `${ ENTRIES }/${ parent.id }`, {
				headers,
				data: {
					amount: 40,
					entry_type: 'cost',
					entry_date: DAY,
					description: 'Split, then classified',
					event_date_id: eventDateId,
					payment_source: 'event_cash',
				},
			} );
			expect( put.status() ).toBe( 409 );
		} finally {
			await api.delete( `${ ENTRIES }/${ parent.id }`, { headers } );
		}
	} );

	test( 'returns 404 for a missing entry', async () => {
		const res = await api.put( `${ ENTRIES }/999999999`, {
			headers,
			data: {
				amount: 5,
				entry_type: 'income',
				entry_date: DAY,
				event_date_id: eventDateId,
				payment_source: 'event_cash',
			},
		} );
		expect( res.status() ).toBe( 404 );
	} );

	test( 'requires an event date for the summary', async () => {
		const res = await api.get( SUMMARY, { headers } );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'keeps the summary and entries from unauthorized users', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		try {
			const res = await anonymous.get(
				`${ SUMMARY }?event_date_id=${ eventDateId }`
			);
			expect( res.status() ).toBe( 401 );
		} finally {
			await anonymous.dispose();
		}

		const read = await api.get(
			`${ SUMMARY }?event_date_id=${ eventDateId }`,
			{ headers: subscriber.headers }
		);
		expect( read.status() ).toBe( 403 );
		expect( await read.text() ).not.toContain( 'Anna' );

		const list = await api.get(
			`${ ENTRIES }?event_date_id=${ eventDateId }&classified=1`,
			{ headers: subscriber.headers }
		);
		expect( list.status() ).toBe( 403 );

		const write = await api.post( ENTRIES, {
			headers: subscriber.headers,
			data: {
				amount: 5,
				entry_type: 'income',
				entry_date: DAY,
				event_date_id: eventDateId,
				payment_source: 'event_cash',
			},
		} );
		expect( write.status() ).toBe( 403 );

		const del = await api.delete( `${ ENTRIES }/${ ids.income }`, {
			headers: subscriber.headers,
		} );
		expect( del.status() ).toBe( 403 );
		expect( ( await summary() ).cash_income ).toBe( 115 );
	} );
} );
