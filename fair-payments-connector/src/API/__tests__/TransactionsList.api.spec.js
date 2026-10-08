/**
 * Transactions list — search and filters (#1753).
 *
 * Rows are seeded through the test-only fair-e2e/v1/transaction-filters
 * routes under a per-run key. Every seeded Mollie payment ID and description
 * carries that key, so a search for it scopes an assertion to this run's rows
 * whatever else the database holds.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const LIST = '/wp-json/fair-payments-connector/v1/transactions';
const SEED = '/wp-json/fair-e2e/v1/transaction-filters/seed';

const KEY = `k${ Date.now().toString( 36 ) }`;
const SUBSCRIBER_PASSWORD = `pw-${ KEY }`;

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminAuth = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const TRANSACTIONS = [
	{
		amount: 0,
		status: 'paid',
		description: `${ KEY } free entry`,
		created_at: '2026-06-01 10:00:00',
		participant: 0,
	},
	{
		// Linked to a participant and a user: the participant is the person.
		amount: 10,
		status: 'paid',
		description: `${ KEY } 100% wool_blend scarf`,
		created_at: '2026-06-02 10:00:00',
		participant: 1,
		user: 0,
	},
	{
		amount: 10.5,
		status: 'paid',
		testmode: true,
		description: `${ KEY } workshop`,
		created_at: '2026-06-03 10:00:00',
		user: 1,
	},
	{
		// Points at a participant that no longer exists: the user is the person.
		amount: 25,
		status: 'failed',
		description: `${ KEY } 100x wool blend`,
		created_at: '2026-06-04 10:00:00',
		participant_id: 2000000000,
		user: 1,
	},
	{
		amount: 99.99,
		status: 'paid',
		description: `${ KEY } concert`,
		created_at: '2026-06-05 10:00:00',
	},
	// Europe/Madrid, 29 March 2026: clocks go forward, the day lasts 23 hours
	// and runs from 28 March 23:00 UTC to 29 March 22:00 UTC.
	...[
		'2026-03-28 22:59:59',
		'2026-03-28 23:00:00',
		'2026-03-29 21:59:59',
		'2026-03-29 22:00:00',
		// 25 October 2026: clocks go back, the day lasts 25 hours and runs from
		// 24 October 22:00 UTC to 25 October 23:00 UTC.
		'2026-10-24 21:59:59',
		'2026-10-24 22:00:00',
		'2026-10-25 22:59:59',
		'2026-10-25 23:00:00',
	].map( ( createdAt ) => ( {
		amount: 1,
		status: 'paid',
		testmode: true,
		description: `${ KEY } boundary`,
		created_at: createdAt,
	} ) ),
];

test.describe( 'Transactions list — search and filters', () => {
	let api;
	let ids;

	const list = async ( params, headers = adminAuth ) => {
		const res = await api.get( LIST, { headers, params } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	};

	const idsOf = ( body ) => body.transactions.map( ( t ) => t.id );

	const rows = ( ...indexes ) => indexes.map( ( index ) => ids[ index ] );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.post( SEED, {
			headers: adminAuth,
			data: {
				key: KEY,
				timezone: 'Europe/Madrid',
				participants: [
					{ name: 'Ana', surname: `Lopez${ KEY }` },
					{ name: 'Berta', surname: `Marin${ KEY }` },
				],
				users: [
					{ display_name: `Zoe Hidden${ KEY }` },
					{
						display_name: `Carl User${ KEY }`,
						password: SUBSCRIBER_PASSWORD,
					},
				],
				transactions: TRANSACTIONS,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		ids = ( await res.json() ).transaction_ids;
		expect( ids ).toHaveLength( TRANSACTIONS.length );
	} );

	test.afterAll( async () => {
		await api.delete( SEED, {
			headers: adminAuth,
			params: { key: KEY },
		} );
		await api.dispose();
	} );

	test( 'is limited to administrators, with or without filters', async () => {
		for ( const params of [ {}, { search: KEY, amount_min: '0' } ] ) {
			expect( ( await api.get( LIST, { params } ) ).status() ).toBe(
				401
			);
			expect(
				(
					await api.get( LIST, {
						params,
						headers: basicAuth(
							`tf${ KEY }-u1`,
							SUBSCRIBER_PASSWORD
						),
					} )
				).status()
			).toBe( 403 );
		}
	} );

	test( 'keeps the response shape and the unfiltered list', async () => {
		const body = await list( { search: KEY, per_page: 100 } );

		expect( body.total ).toBe( TRANSACTIONS.length );
		expect( body.page ).toBe( 1 );
		expect( Object.keys( body.transactions[ 0 ] ).sort() ).toEqual( [
			'amount',
			'application_fee',
			'created_at',
			'currency',
			'description',
			'entry_ids',
			'event_date_id',
			'event_url',
			'id',
			'mollie_fee',
			'mollie_payment_id',
			'participant',
			'participant_id',
			'status',
			'testmode',
			'user_name',
		] );

		const unfiltered = await list( { per_page: 1 } );
		expect( unfiltered.total ).toBeGreaterThanOrEqual(
			TRANSACTIONS.length
		);
		expect(
			( await list( { search: KEY, event_date_id: 2000000000 } ) ).total
		).toBe( 0 );
	} );

	test( 'finds a transaction beyond the first page by each search field', async () => {
		// The concert is the newest of the June rows; sorted oldest first it
		// is not on page 1 of the run's rows.
		const firstPage = await list( {
			search: KEY,
			per_page: 2,
			orderby: 'created_at',
			order: 'ASC',
		} );
		expect( firstPage.pages ).toBeGreaterThan( 1 );
		expect( idsOf( firstPage ) ).not.toContain( ids[ 4 ] );

		const cases = [
			[ `tr_tf${ KEY }n4`, rows( 4 ) ],
			[ `${ KEY } concert`, rows( 4 ) ],
			[ `${ KEY.toUpperCase() } CONCERT`, rows( 4 ) ],
			[ `Ana Lopez${ KEY }`, rows( 0 ) ],
			[ `tf${ KEY }-p1@example.com`, rows( 1 ) ],
			[ `Carl User${ KEY }`, rows( 2, 3 ) ],
			[ `tf${ KEY }-u1@example.com`, rows( 2, 3 ) ],
		];
		for ( const [ search, expected ] of cases ) {
			const body = await list( {
				search,
				per_page: 2,
				orderby: 'id',
				order: 'ASC',
			} );
			expect( idsOf( body ), search ).toEqual( expected );
			expect( body.total, search ).toBe( expected.length );
		}

		// A numeric term matches the transaction ID. The term can also occur
		// in another row's text, so the run's own date and amount scope it.
		const byId = await list( {
			search: String( ids[ 4 ] ),
			date_from: '2026-06-05',
			date_to: '2026-06-05',
			amount_min: '99.99',
			amount_max: '99.99',
		} );
		expect( idsOf( byId ) ).toContain( ids[ 4 ] );
	} );

	test( 'searches the person the list shows: participant first, user otherwise', async () => {
		// Row 1 shows its participant, so its linked user is not searched.
		expect( ( await list( { search: `Zoe Hidden${ KEY }` } ) ).total ).toBe(
			0
		);
		const shown = await list( { search: `Berta Marin${ KEY }` } );
		expect( idsOf( shown ) ).toEqual( rows( 1 ) );
		expect( shown.transactions[ 0 ].participant.name ).toBe(
			`Berta Marin${ KEY }`
		);

		// Row 3 links a participant that does not exist; its user is shown.
		const fallback = await list( {
			search: `Carl User${ KEY }`,
			status: 'failed',
		} );
		expect( idsOf( fallback ) ).toEqual( rows( 3 ) );
		expect( fallback.transactions[ 0 ].participant ).toBeNull();
		expect( fallback.transactions[ 0 ].user_name ).toBe(
			`Carl User${ KEY }`
		);
	} );

	test( 'searches WordPress users only when Fair Audience is inactive', async () => {
		const withoutAudience = {
			...adminAuth,
			'X-Fair-E2E-Without-Audience': '1',
		};

		expect(
			( await list( { search: `Ana Lopez${ KEY }` }, withoutAudience ) )
				.total
		).toBe( 0 );

		const byUser = await list(
			{ search: `Zoe Hidden${ KEY }` },
			withoutAudience
		);
		expect( idsOf( byUser ) ).toEqual( rows( 1 ) );
		expect( byUser.transactions[ 0 ].participant ).toBeNull();

		expect(
			(
				await list(
					{ search: `${ KEY } concert`, amount_min: '99.99' },
					withoutAudience
				)
			).total
		).toBe( 1 );
	} );

	test( 'treats % and _ in a search as literal characters', async () => {
		for ( const search of [
			`${ KEY } 100% wool_blend`,
			'100% wool_blend scarf',
		] ) {
			const body = await list( { search, per_page: 100 } );
			expect( idsOf( body ), search ).toContain( ids[ 1 ] );
			expect( idsOf( body ), search ).not.toContain( ids[ 3 ] );
		}

		// As wildcards these would match every row of the run.
		for ( const search of [ `${ KEY }%concert`, `${ KEY }_concert` ] ) {
			expect( ( await list( { search } ) ).total, search ).toBe( 0 );
		}
	} );

	test( 'combines search, status, mode, dates and amounts, with a matching count', async () => {
		const body = await list( {
			search: KEY,
			status: 'paid',
			mode: 'live',
			date_from: '2026-06-02',
			date_to: '2026-06-05',
			amount_min: '10',
			amount_max: '99.99',
			orderby: 'amount',
			order: 'DESC',
		} );

		expect( idsOf( body ) ).toEqual( rows( 4, 1 ) );
		expect( body.total ).toBe( 2 );
		expect( body.pages ).toBe( 1 );

		expect(
			idsOf( await list( { search: KEY, status: 'failed' } ) )
		).toEqual( rows( 3 ) );
		expect(
			( await list( { search: KEY, mode: 'test', amount_min: '10' } ) )
				.total
		).toBe( 1 );
	} );

	test( 'paginates and sorts the filtered rows consistently', async () => {
		const params = {
			search: KEY,
			date_from: '2026-06-01',
			date_to: '2026-06-05',
			per_page: 2,
			orderby: 'amount',
			order: 'ASC',
		};
		const seen = [];

		for ( const page of [ 1, 2, 3 ] ) {
			const body = await list( { ...params, page } );
			expect( body.total ).toBe( 5 );
			expect( body.pages ).toBe( 3 );
			expect( body.page ).toBe( page );
			seen.push( ...idsOf( body ) );
		}

		expect( seen ).toEqual( rows( 0, 1, 2, 3, 4 ) );
		expect(
			idsOf( await list( { ...params, order: 'DESC', page: 1 } ) )
		).toEqual( rows( 4, 3 ) );
		expect( ( await list( { ...params, page: 4 } ) ).transactions ).toEqual(
			[]
		);
	} );

	test( 'accepts a single bound and treats zero as a real amount', async () => {
		const june = { date_from: '2026-06-01', date_to: '2026-06-05' };
		const cases = [
			[ { amount_max: '0' }, rows( 0 ) ],
			[ { amount_max: '0.00' }, rows( 0 ) ],
			[ { amount_min: '0', amount_max: '0' }, rows( 0 ) ],
			[ { amount_min: '0' }, rows( 0, 1, 2, 3, 4 ) ],
			[ { amount_min: '99.99' }, rows( 4 ) ],
			[ { amount_min: '10', amount_max: '10' }, rows( 1 ) ],
			[ { amount_min: '10.01', amount_max: '10.5' }, rows( 2 ) ],
		];
		for ( const [ amounts, expected ] of cases ) {
			const body = await list( {
				search: KEY,
				...june,
				...amounts,
				orderby: 'id',
				order: 'ASC',
			} );
			expect( idsOf( body ), JSON.stringify( amounts ) ).toEqual(
				expected
			);
		}

		expect(
			idsOf(
				await list( {
					search: KEY,
					date_from: '2026-06-05',
					date_to: '2026-06-30',
				} )
			)
		).toEqual( rows( 4 ) );
		expect(
			idsOf(
				await list( {
					search: KEY,
					date_from: '2026-06-01',
					date_to: '2026-06-01',
				} )
			)
		).toEqual( rows( 0 ) );
	} );

	test( 'uses whole days in the site timezone, across daylight-saving changes', async () => {
		const boundary = { search: `${ KEY } boundary`, orderby: 'id' };
		const day = async ( dates ) =>
			idsOf( await list( { ...boundary, order: 'ASC', ...dates } ) );

		expect(
			await day( { date_from: '2026-03-29', date_to: '2026-03-29' } )
		).toEqual( rows( 6, 7 ) );
		expect(
			await day( { date_from: '2026-03-28', date_to: '2026-03-28' } )
		).toEqual( rows( 5 ) );
		expect(
			await day( { date_from: '2026-03-30', date_to: '2026-03-30' } )
		).toEqual( rows( 8 ) );

		expect(
			await day( { date_from: '2026-10-25', date_to: '2026-10-25' } )
		).toEqual( rows( 10, 11 ) );
		expect(
			await day( { date_from: '2026-10-24', date_to: '2026-10-24' } )
		).toEqual( rows( 9 ) );
		expect(
			await day( { date_from: '2026-10-26', date_to: '2026-10-26' } )
		).toEqual( rows( 12 ) );

		// A single bound is inclusive on its own day.
		expect( await day( { date_to: '2026-03-29' } ) ).toEqual(
			rows( 5, 6, 7 )
		);
		expect( await day( { date_from: '2026-10-25' } ) ).toEqual(
			rows( 10, 11, 12 )
		);
	} );

	test( 'rejects invalid filters with 400', async () => {
		const cases = [
			[ { date_from: '2026-02-30' }, 'rest_invalid_param' ],
			[ { date_to: '01/02/2026' }, 'rest_invalid_param' ],
			[ { date_from: 'yesterday' }, 'rest_invalid_param' ],
			[ { amount_min: '-1' }, 'rest_invalid_param' ],
			[ { amount_max: '1.234' }, 'rest_invalid_param' ],
			[ { amount_max: '1e3' }, 'rest_invalid_param' ],
			[ { amount_min: 'INF' }, 'rest_invalid_param' ],
			[ { amount_min: 'NaN' }, 'rest_invalid_param' ],
			[ { amount_max: 'ten' }, 'rest_invalid_param' ],
			[ { search: 'x'.repeat( 201 ) }, 'rest_invalid_param' ],
			[
				{ date_from: '2026-06-02', date_to: '2026-06-01' },
				'invalid_date_range',
			],
			[
				{ amount_min: '10', amount_max: '9.99' },
				'invalid_amount_range',
			],
		];
		for ( const [ params, code ] of cases ) {
			const res = await api.get( LIST, { headers: adminAuth, params } );
			expect( res.status(), JSON.stringify( params ) ).toBe( 400 );
			expect( ( await res.json() ).code, JSON.stringify( params ) ).toBe(
				code
			);
		}
	} );
} );
