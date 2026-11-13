/**
 * Live coverage for payment history reconciliation (#2139, stage 3 of
 * #2111): the administrator-only `/fair-events/v1/payment-history` routes,
 * linking and splitting reported payments, removing a reconciled link,
 * marking a record as reviewed, the append-only audit, and stale and
 * concurrent decisions (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.10). The
 * one-time migration's routes are retired (#2252).
 *
 * The records are the payment-history-findings.php fixture's: T7 is an
 * add-on charge for one of two purchases, T10 a payment naming a purchase
 * that no longer exists, T13b one line for two sessions, and S9 a purchase
 * paid twice.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const ROUTE = '/wp-json/fair-events/v1/payment-history';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

async function findings( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-history-findings.php',
			action,
			JSON.stringify( data ),
		],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		}
	);
	const match = stdout.match( /E2E_PAYMENT_FINDINGS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_FINDINGS output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

async function login( api, user, password ) {
	await api.post( '/wp-login.php', {
		form: { log: user, pwd: password, rememberme: 'forever' },
	} );
	const nonce = await api.get( '/wp-admin/admin-ajax.php?action=rest-nonce' );
	expect( nonce.ok() ).toBeTruthy();
	return { 'X-WP-Nonce': await nonce.text() };
}

test.describe.serial( 'Payment history reconciliation', () => {
	test.describe.configure( { timeout: 300 * 1000 } );

	let api;
	let anonymous;
	let subscriberApi;
	let subscriberHeaders;
	let subscriberId;
	let eventId;
	const dates = {};
	let seed;

	async function state() {
		return findings( 'state', {
			transactionIds: Object.values( seed.transactions ),
		} );
	}

	async function findingOf( sourceType, sourceId, params = {} ) {
		const response = await api.get( `${ ROUTE }/findings`, {
			headers: adminHeaders,
			params: {
				status: 'all',
				source_type: sourceType,
				source_id: sourceId,
				...params,
			},
		} );
		expect( response.ok() ).toBeTruthy();
		const body = await response.json();
		expect( body.items, `${ sourceType } ${ sourceId }` ).toHaveLength( 1 );
		return body.items[ 0 ];
	}

	async function context( findingId ) {
		const response = await api.get( `${ ROUTE }/findings/${ findingId }`, {
			headers: adminHeaders,
		} );
		expect( response.ok() ).toBeTruthy();
		return response.json();
	}

	function link( findingId, data ) {
		return api.post( `${ ROUTE }/findings/${ findingId }/links`, {
			headers: adminHeaders,
			data,
		} );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymous = await request.newContext( { baseURL: BASE_URL } );

		const title = `Reconciliation ${ Date.now() }`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		eventId = ( await post.json() ).id;

		for ( const [ letter, day ] of [
			[ 'A', '10' ],
			[ 'B', '11' ],
			[ 'C', '12' ],
		] ) {
			const date = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title: `${ title } ${ letter }`,
						link_type: 'post',
						start_date: `2036-01-${ day }`,
						start_time: '10:00:00',
						end_date: `2036-01-${ day }`,
						end_time: '12:00:00',
					},
				}
			);
			const body = await date.json();
			expect( date.ok(), JSON.stringify( body ) ).toBeTruthy();
			dates[ letter ] = body.id;
		}

		seed = await findings( 'seed', {
			dateA: dates.A,
			dateB: dates.B,
			dateC: dates.C,
		} );

		const username = `payment-history-subscriber-${ Date.now() }`;
		const password = `pw-${ Date.now() }-x`;
		const user = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( user.ok() ).toBeTruthy();
		subscriberId = ( await user.json() ).id;
		subscriberApi = await request.newContext( { baseURL: BASE_URL } );
		subscriberHeaders = await login( subscriberApi, username, password );
	} );

	test.afterAll( async () => {
		if ( seed ) {
			await findings( 'cleanup', { seed } );
		}
		for ( const id of Object.values( dates ) ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: true },
			} );
		}
		if ( subscriberId ) {
			await api.delete( `/wp-json/wp/v2/users/${ subscriberId }`, {
				headers: adminHeaders,
				params: { force: true, reassign: 1 },
			} );
		}
		await subscriberApi?.dispose();
		await anonymous?.dispose();
		await api?.dispose();
	} );

	test( 'every route needs an administrator', async () => {
		const t7 = await findingOf( 'transaction', seed.transactions.T7 );
		const routes = [
			[ 'get', ROUTE ],
			[ 'get', `${ ROUTE }/findings` ],
			[ 'get', `${ ROUTE }/findings/${ t7.id }` ],
			[ 'get', `${ ROUTE }/audit` ],
			[ 'get', `${ ROUTE }/purchases` ],
			[ 'post', `${ ROUTE }/findings/${ t7.id }/review` ],
			[ 'post', `${ ROUTE }/findings/${ t7.id }/links` ],
			[ 'delete', `${ ROUTE }/links/1` ],
		];
		// A valid payload, so the refusal comes from the permission check
		// (WordPress validates arguments first).
		const data = {
			note: 'x',
			expected_link_ids: [],
			links: [
				{
					signup_id: seed.signups.S11a,
					role: 'additional_charge',
					allocated_amount: 8,
				},
			],
		};
		for ( const [ method, path ] of routes ) {
			const loggedOut = await anonymous[ method ]( path, { data } );
			expect( loggedOut.status(), `${ method } ${ path }` ).toBe( 401 );

			const subscriber = await subscriberApi[ method ]( path, {
				headers: subscriberHeaders,
				data,
			} );
			expect( subscriber.status(), `${ method } ${ path }` ).toBe( 403 );
		}

		// Nothing changed.
		expect(
			( await findingOf( 'transaction', seed.transactions.T7 ) ).status
		).toBe( 'open' );
	} );

	test( 'the status and findings describe the records to review', async () => {
		const status = await (
			await api.get( ROUTE, { headers: adminHeaders } )
		).json();
		// Ongoing management only: no migration run, verification or switch.
		expect( Object.keys( status ).sort() ).toEqual( [
			'finding_statuses',
			'payment_information',
			'reconciliation_available',
		] );
		expect( status.reconciliation_available ).toBe( true );
		expect( status.payment_information ).toBe( 'available' );
		expect( status.finding_statuses.open ).toBeGreaterThan( 0 );

		const response = await api.get( `${ ROUTE }/findings`, {
			headers: adminHeaders,
			params: { reason: 'no_evidence', event_date_id: dates.A },
		} );
		expect( response.ok() ).toBeTruthy();
		const body = await response.json();
		expect( Number( response.headers()[ 'x-wp-total' ] ) ).toBeGreaterThan(
			0
		);
		expect( body.items.map( ( item ) => item.source_id ) ).toContain(
			seed.transactions.T10
		);
		expect( body.items[ 0 ].event_date.id ).toBe( dates.A );
		expect( body.event_dates.map( ( item ) => item.id ) ).toContain(
			dates.A
		);

		// The finding's context names the payment and the money left on it.
		const t10 = await findingOf( 'transaction', seed.transactions.T10 );
		const t10Context = await context( t10.id );
		expect( t10Context.transaction ).toMatchObject( {
			id: seed.transactions.T10,
			amount: 15,
			currency: 'EUR',
			status: 'paid',
		} );
		expect( t10Context.transaction.hints.signup_ids ).toEqual( [
			999999999,
		] );
		expect( t10Context.links ).toEqual( [] );
		expect( t10Context.remaining ).toBe( 15 );
		expect( t10Context.can_link ).toBe( true );
		expect( t10Context.can_review ).toBe( true );
	} );

	test( 'findings filter by their payment’s status and test/live mode (#2219)', async () => {
		const T7 = seed.transactions.T7;
		const T10 = seed.transactions.T10;
		const T13b = seed.transactions.T13b;
		// T10 canceled, T7 expired, T13b live; every other seeded payment
		// stays a paid test one.
		const { previous } = await findings( 'set-transactions', {
			transactions: {
				[ T7 ]: { status: 'expired' },
				[ T10 ]: { status: 'canceled' },
				[ T13b ]: { testmode: 0 },
			},
		} );
		const before = await state();

		// The payment a finding is about, as reconciliation reads it.
		const transactionOf = ( item ) =>
			item.source_type === 'transaction'
				? item.source_id
				: Number( item.detail?.transaction_id || 0 );
		async function list( params, perPage = 100, page = 1 ) {
			const response = await api.get( `${ ROUTE }/findings`, {
				headers: adminHeaders,
				params: { status: 'all', per_page: perPage, page, ...params },
			} );
			expect( response.ok(), JSON.stringify( params ) ).toBeTruthy();
			return {
				items: ( await response.json() ).items,
				total: Number( response.headers()[ 'x-wp-total' ] ),
				pages: Number( response.headers()[ 'x-wp-totalpages' ] ),
			};
		}
		const ids = ( items ) => items.map( ( item ) => item.id ).sort();
		const payments = ( result ) =>
			new Set( result.items.map( transactionOf ) );
		// Exact sets are checked over this spec's own payments: specs that
		// ran earlier in the same shard can leave canceled or live payments
		// with findings of their own (#2224).
		const seeded = new Set( Object.values( seed.transactions ) );
		const ownPayments = ( result ) =>
			new Set(
				[ ...payments( result ) ].filter( ( id ) => seeded.has( id ) )
			);

		try {
			const all = await list( {} );
			expect(
				await list( { transaction_status: '', payment_mode: 'all' } )
			).toEqual( all );
			// Records without an identifiable payment are listed under All.
			const withoutPayment = all.items.filter(
				( item ) => ! transactionOf( item )
			);
			expect( withoutPayment.length ).toBeGreaterThan( 0 );
			// So is a payment record whose payment no longer exists.
			const missing = all.items.filter(
				( item ) =>
					item.reason === 'missing_transaction' &&
					item.source_type === 'ledger_row'
			);
			expect( missing.length ).toBeGreaterThan( 0 );
			const unmatched = [ ...withoutPayment, ...missing ].map(
				( item ) => item.id
			);

			const canceled = await list( { transaction_status: 'canceled' } );
			expect( canceled.total ).toBe( canceled.items.length );
			expect( ownPayments( canceled ) ).toEqual( new Set( [ T10 ] ) );

			// Several statuses match any of them.
			expect(
				ownPayments(
					await list( { transaction_status: 'canceled,expired' } )
				)
			).toEqual( new Set( [ T7, T10 ] ) );

			const paid = await list( { transaction_status: 'paid' } );
			expect( payments( paid ) ).toContain( T13b );
			expect( payments( paid ) ).not.toContain( T10 );
			expect( payments( paid ) ).not.toContain( T7 );
			expect(
				ids( paid.items ).filter( ( id ) => unmatched.includes( id ) )
			).toEqual( [] );

			const live = await list( { payment_mode: 'live' } );
			expect( payments( live ) ).toContain( T13b );
			expect( payments( live ) ).not.toContain( T10 );
			const testOnly = await list( { payment_mode: 'test' } );
			expect( payments( testOnly ) ).toContain( T10 );
			expect( payments( testOnly ) ).not.toContain( T13b );
			for ( const result of [ live, testOnly ] ) {
				expect(
					ids( result.items ).filter( ( id ) =>
						unmatched.includes( id )
					)
				).toEqual( [] );
			}

			// Combined: every condition holds, with each other and the
			// existing filters.
			const liveCanceled = await list( {
				payment_mode: 'live',
				transaction_status: 'canceled',
			} );
			expect( liveCanceled.total ).toBe( liveCanceled.items.length );
			expect( ownPayments( liveCanceled ) ).toEqual( new Set() );
			expect(
				(
					await list( {
						payment_mode: 'test',
						transaction_status: 'canceled',
						reason: 'no_evidence',
						event_date_id: dates.A,
					} )
				).items.map( ( item ) => item.source_id )
			).toEqual( [ T10 ] );
			expect(
				payments(
					await list( {
						payment_mode: 'test',
						transaction_status: 'paid',
						reason: 'no_evidence',
						event_date_id: dates.A,
					} )
				)
			).not.toContain( T10 );

			// Totals and pages count every match, not one page.
			const pagedItems = [];
			let pages = 1;
			for ( let page = 1; page <= pages; page++ ) {
				const result = await list(
					{ transaction_status: 'paid' },
					2,
					page
				);
				expect( result.total ).toBe( paid.total );
				pages = result.pages;
				pagedItems.push( ...result.items );
			}
			expect( pages ).toBe( Math.ceil( paid.total / 2 ) );
			expect( ids( pagedItems ) ).toEqual( ids( paid.items ) );

			for ( const params of [
				{ transaction_status: 'cancelled' },
				{ payment_mode: 'dry_run' },
			] ) {
				const response = await api.get( `${ ROUTE }/findings`, {
					headers: adminHeaders,
					params,
				} );
				expect( response.status(), JSON.stringify( params ) ).toBe(
					400
				);
			}

			// Filtering is read-only.
			expect( await state() ).toEqual( before );
		} finally {
			await findings( 'set-transactions', { transactions: previous } );
		}
	} );
	test( 'a decision needs a note and a valid allocation', async () => {
		const t7 = await findingOf( 'transaction', seed.transactions.T7 );
		const s11a = seed.signups.S11a;

		const noNote = await link( t7.id, {
			note: '   ',
			expected_link_ids: [],
			links: [
				{
					signup_id: s11a,
					role: 'additional_charge',
					allocated_amount: 8,
				},
			],
		} );
		expect( noNote.status() ).toBe( 400 );
		expect( ( await noNote.json() ).code ).toBe(
			'reconciliation_note_required'
		);

		const tooMuch = await link( t7.id, {
			note: 'More than the total',
			expected_link_ids: [],
			links: [
				{
					signup_id: s11a,
					role: 'additional_charge',
					allocated_amount: 9,
				},
			],
		} );
		expect( tooMuch.status() ).toBe( 400 );
		expect( ( await tooMuch.json() ).code ).toBe(
			'allocation_exceeds_total'
		);

		const unknown = await link( t7.id, {
			note: 'A purchase that does not exist',
			expected_link_ids: [],
			links: [
				{
					signup_id: 999999999,
					role: 'additional_charge',
					allocated_amount: 8,
				},
			],
		} );
		expect( unknown.status() ).toBe( 400 );
		expect( ( await unknown.json() ).code ).toBe(
			'payment_link_unknown_purchase'
		);

		const stale = await link( t7.id, {
			note: 'Saw a link that is gone',
			expected_link_ids: [ 123456789 ],
			links: [
				{
					signup_id: s11a,
					role: 'additional_charge',
					allocated_amount: 8,
				},
			],
		} );
		expect( stale.status() ).toBe( 409 );
		expect( ( await stale.json() ).code ).toBe( 'reconciliation_stale' );

		// A dry run's findings aren't listed any more (#2254), and neither
		// they nor informational ones can be linked.
		const dryRunList = await api.get( `${ ROUTE }/findings`, {
			headers: adminHeaders,
			params: { mode: 'dry_run' },
		} );
		expect( dryRunList.status() ).toBe( 400 );
		const fromDryRun = await link( seed.dryRunFinding, {
			note: 'Dry run',
			expected_link_ids: [],
			links: [
				{
					signup_id: s11a,
					role: 'additional_charge',
					allocated_amount: 8,
				},
			],
		} );
		expect( fromDryRun.status() ).toBe( 400 );
		expect( ( await fromDryRun.json() ).code ).toBe(
			'finding_not_reconcilable'
		);

		const s9 = await findingOf( 'signup', seed.signups.S9 );
		expect( s9.reason ).toBe( 'multiple_paid_attempts' );
		const informational = await link( s9.id, {
			note: 'Informational',
			expected_link_ids: [],
			links: [
				{
					signup_id: seed.signups.S9,
					role: 'charge',
					allocated_amount: 1,
				},
			],
		} );
		expect( informational.status() ).toBe( 400 );
		expect( ( await informational.json() ).code ).toBe(
			'finding_not_linkable'
		);

		// None of the refusals wrote a link or an audit record.
		const current = await state();
		expect( current.links[ seed.transactions.T7 ] ).toEqual( [] );
		const audit = await api.get( `${ ROUTE }/audit`, {
			headers: adminHeaders,
			params: { transaction_id: seed.transactions.T7 },
		} );
		expect( await audit.json() ).toEqual( [] );
	} );

	test( 'concurrent decisions on one payment: one wins, the other is stale', async () => {
		const t7 = await findingOf( 'transaction', seed.transactions.T7 );
		const decision = ( signupId ) =>
			link( t7.id, {
				note: `Example 11: the add-on belongs to purchase ${ signupId }`,
				expected_link_ids: [],
				links: [
					{
						signup_id: signupId,
						role: 'additional_charge',
						allocated_amount: 8,
					},
				],
			} );
		const responses = await Promise.all( [
			decision( seed.signups.S11a ),
			decision( seed.signups.S11b ),
		] );
		const winners = responses.filter(
			( response ) => response.status() === 200
		);
		expect( winners ).toHaveLength( 1 );
		// The loser is refused without overwriting: as stale when it took
		// the lock behind the winner, or as already decided when it arrived
		// after the winner committed.
		const loser = responses.find(
			( response ) => response !== winners[ 0 ]
		);
		const refusal = [ loser.status(), ( await loser.json() ).code ];
		expect( [
			[ 409, 'reconciliation_stale' ],
			[ 400, 'finding_decided' ],
		] ).toContainEqual( refusal );

		const current = await state();
		const links = current.links[ seed.transactions.T7 ];
		expect( links ).toHaveLength( 1 );
		expect( links[ 0 ] ).toMatchObject( {
			role: 'additional_charge',
			attribution: 'reconciled',
		} );
		expect( Number( links[ 0 ].allocated_amount ) ).toBe( 8 );

		expect(
			( await findingOf( 'transaction', seed.transactions.T7 ) ).status
		).toBe( 'reconciled' );

		// One audit record, naming who decided, why, and the links before and after.
		const audit = await (
			await api.get( `${ ROUTE }/audit`, {
				headers: adminHeaders,
				params: { transaction_id: seed.transactions.T7 },
			} )
		).json();
		expect( audit ).toHaveLength( 1 );
		expect( audit[ 0 ] ).toMatchObject( {
			action: 'link',
			finding_id: t7.id,
			reason: 'ambiguous_activity_charge',
			transaction_id: seed.transactions.T7,
			before: { finding_status: 'open', links: [] },
			after: { finding_status: 'reconciled' },
		} );
		expect( audit[ 0 ].user_id ).toBeGreaterThan( 0 );
		expect( audit[ 0 ].user_name ).toBeTruthy();
		expect( audit[ 0 ].note ).toMatch( /^Example 11/ );
		expect( audit[ 0 ].created_at ).toMatch(
			/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
		);
		expect( audit[ 0 ].after.links ).toEqual( [
			expect.objectContaining( {
				id: Number( links[ 0 ].id ),
				attribution: 'reconciled',
				allocated_amount: 8,
			} ),
		] );
	} );

	test( 'a shared payment is split across purchases', async () => {
		const a = seed.signups.S21A;
		const b = seed.signups.S21B;
		const t13b = await findingOf( 'transaction', seed.transactions.T13b );
		expect( t13b.reason ).toBe( 'allocation_mismatch' );

		// The purchases migrated from the registrations it names are suggested.
		const suggested = ( await context( t13b.id ) ).candidates.map(
			( candidate ) => candidate.id
		);
		expect( suggested ).toEqual( expect.arrayContaining( [ a, b ] ) );

		const response = await link( t13b.id, {
			note: 'Example 21: one line for two sessions, half each',
			expected_link_ids: [],
			links: [
				{ signup_id: a, role: 'charge', allocated_amount: 12 },
				{ signup_id: b, role: 'charge', allocated_amount: 12 },
			],
		} );
		expect( response.status(), await response.text() ).toBe( 200 );
		const body = await response.json();
		expect( body.context.finding.status ).toBe( 'reconciled' );
		expect( body.context.remaining ).toBe( 0 );
		expect(
			body.context.links.map( ( item ) => [
				item.signup_id,
				item.allocated_amount,
				item.removable,
			] )
		).toEqual( [
			[ a, 12, true ],
			[ b, 12, true ],
		] );
	} );

	test( 'a record can be marked as reviewed without a link', async () => {
		const t10 = await findingOf( 'transaction', seed.transactions.T10 );
		const response = await api.post(
			`${ ROUTE }/findings/${ t10.id }/review`,
			{
				headers: adminHeaders,
				data: { note: 'Example 14: a test payment, not a purchase' },
			}
		);
		expect( response.status() ).toBe( 200 );
		expect( ( await response.json() ).context.finding.status ).toBe(
			'reviewed'
		);

		// Deciding twice is refused as stale.
		const again = await api.post(
			`${ ROUTE }/findings/${ t10.id }/review`,
			{
				headers: adminHeaders,
				data: { note: 'Again' },
			}
		);
		expect( again.status() ).toBe( 409 );

		// Informational records can be reviewed too.
		const s9 = await findingOf( 'signup', seed.signups.S9 );
		const reviewed = await api.post(
			`${ ROUTE }/findings/${ s9.id }/review`,
			{
				headers: adminHeaders,
				data: {
					note: 'Example 9: the customer paid twice; refunded by hand',
				},
			}
		);
		expect( reviewed.status() ).toBe( 200 );

		const links = ( await state() ).links[ seed.transactions.T10 ];
		expect( links ).toEqual( [] );
	} );

	test( 'only reconciled links can be removed, and removing them reopens the record', async () => {
		const current = await state();
		const t = seed.transactions;

		// A backfilled link stays.
		const backfilled = current.links[ t.T2 ][ 0 ];
		expect( backfilled.attribution ).toBe( 'backfill' );
		const refused = await api.delete(
			`${ ROUTE }/links/${ backfilled.id }`,
			{
				headers: adminHeaders,
				data: {
					note: 'Try to remove a migrated link',
					expected_link_ids: [ Number( backfilled.id ) ],
				},
			}
		);
		expect( refused.status() ).toBe( 400 );
		expect( ( await refused.json() ).code ).toBe(
			'payment_link_not_removable'
		);

		const [ first, second ] = current.links[ t.T13b ];
		const ids = [ Number( first.id ), Number( second.id ) ];

		const noNote = await api.delete( `${ ROUTE }/links/${ first.id }`, {
			headers: adminHeaders,
			data: { note: '', expected_link_ids: ids },
		} );
		expect( noNote.status() ).toBe( 400 );

		const removed = await api.delete( `${ ROUTE }/links/${ first.id }`, {
			headers: adminHeaders,
			data: { note: 'Wrong split', expected_link_ids: ids },
		} );
		expect( removed.status() ).toBe( 200 );
		// Another reconciled link remains, so the decision still stands.
		expect( ( await findingOf( 'transaction', t.T13b ) ).status ).toBe(
			'reconciled'
		);

		// The administrator still saw the removed link: stale.
		const stale = await api.delete( `${ ROUTE }/links/${ second.id }`, {
			headers: adminHeaders,
			data: { note: 'Wrong split', expected_link_ids: ids },
		} );
		expect( stale.status() ).toBe( 409 );

		const last = await api.delete( `${ ROUTE }/links/${ second.id }`, {
			headers: adminHeaders,
			data: {
				note: 'Wrong split',
				expected_link_ids: [ Number( second.id ) ],
			},
		} );
		expect( last.status() ).toBe( 200 );
		expect( ( await findingOf( 'transaction', t.T13b ) ).status ).toBe(
			'open'
		);
		expect( ( await state() ).links[ t.T13b ] ).toEqual( [] );

		const audit = await (
			await api.get( `${ ROUTE }/audit`, {
				headers: adminHeaders,
				params: { transaction_id: t.T13b },
			} )
		).json();
		expect( audit.map( ( entry ) => entry.action ) ).toEqual( [
			'unlink',
			'unlink',
			'link',
		] );
		expect( audit[ 0 ].after ).toMatchObject( { links: [] } );
		expect( audit[ 0 ].after.reopened_findings ).toHaveLength( 1 );
		expect( audit[ 1 ].after.reopened_findings ).toEqual( [] );
	} );

	test( 'the retired migration routes are gone, even for administrators', async () => {
		const retired = [
			[ 'post', `${ ROUTE }/dry-run` ],
			[ 'post', `${ ROUTE }/backfill` ],
			[ 'post', `${ ROUTE }/backfill/resume` ],
			[ 'post', `${ ROUTE }/verify` ],
			[ 'post', `${ ROUTE }/cutover` ],
			[ 'post', `${ ROUTE }/readers` ],
			[ 'get', `${ ROUTE }/comparisons` ],
		];
		const before = await state();
		for ( const [ method, path ] of retired ) {
			const response = await api[ method ]( path, {
				headers: adminHeaders,
				data: { backup_confirmed: true },
			} );
			expect( response.status(), `${ method } ${ path }` ).toBe( 404 );
			expect( ( await response.json() ).code ).toBe( 'rest_no_route' );
		}
		expect( await state() ).toEqual( before );
	} );
} );
