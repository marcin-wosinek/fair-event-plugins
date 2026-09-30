/**
 * External Updates runs and operation log (#1695): permissions, validation,
 * server-owned counts and outcomes, overlap guard, interrupted runs, retries
 * without duplicates, and an allowlisted log.
 *
 * Mollie is served by e2e/mu-plugins/lib/mollie-http-double.php; its payment
 * `tr_e2emanualimport` is always paid in test mode, and other IDs report the
 * status set through the helper route below.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const RUNS = '/wp-json/fair-payments-connector/v1/external-updates/runs';
const MOLLIE = '/wp-json/fair-payments-connector/v1/transactions/mollie';
const BATCH =
	'/wp-json/fair-payments-connector/v1/transactions/sync-mollie-batch';
const HELPERS = '/wp-json/fair-e2e/v1/external-updates';

const basic = ( user, pass ) => ( {
	Authorization:
		'Basic ' + Buffer.from( `${ user }:${ pass }` ).toString( 'base64' ),
} );
const admin = basic( ADMIN_USER, ADMIN_PASS );

const RUN_KEYS = [
	'action',
	'action_label',
	'counts',
	'error_code',
	'error_message',
	'expected_total',
	'finished_at',
	'id',
	'source_id',
	'source_label',
	'source_type',
	'started_at',
	'status',
	'user_id',
	'user_name',
].sort();

const today = new Date().toISOString().slice( 0, 10 );

test.describe( 'External Updates runs', () => {
	let api;
	const users = [];
	const seeded = [];

	const createUser = async ( role ) => {
		const suffix = `${ Date.now() }${ Math.floor( Math.random() * 1000 ) }`;
		const password = `pw-${ suffix }-Aa1!`;
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: admin,
			data: {
				username: `e2e_${ role }_${ suffix }`,
				email: `e2e_${ role }_${ suffix }@example.test`,
				password,
				roles: [ role ],
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const user = await res.json();
		users.push( user.id );
		return basic( user.username, password );
	};

	const start = async ( data, headers = admin ) =>
		api.post( RUNS, { headers, data } );

	const startOk = async ( data ) => {
		const res = await start( data );
		expect( res.status(), await res.text() ).toBe( 201 );
		return res.json();
	};

	const importMollie = async ( runId, mode, paymentIds, headers = admin ) =>
		api.post( MOLLIE, {
			headers,
			data: {
				mode,
				start_date: today,
				end_date: today,
				payment_ids: paymentIds,
				run_id: runId,
			},
		} );

	const listRuns = async ( query = '' ) => {
		const res = await api.get( `${ RUNS }${ query }`, { headers: admin } );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const seedUnfeedTransaction = async () => {
		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: admin,
			data: {
				amount: 10,
				status: 'paid',
				description: 'E2E fee run',
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const { id } = await res.json();
		seeded.push( id );
		return id;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	// A run left running (by an earlier spec or a failed test) would trip the
	// overlap guard; age it so it is interrupted before each test.
	test.beforeEach( async () => {
		await api.post( `${ HELPERS }/age-running`, { headers: admin } );
		await api.post( `${ HELPERS }/mollie-status`, {
			headers: admin,
			data: { status: 'paid' },
		} );
	} );

	test.afterAll( async () => {
		await api.post( `${ HELPERS }/age-running`, { headers: admin } );
		await api.post( `${ HELPERS }/mollie-status`, {
			headers: admin,
			data: { status: 'paid' },
		} );
		for ( const id of seeded ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/test-transactions?id=${ id }`,
				{
					headers: admin,
				}
			);
		}
		for ( const id of users ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: admin }
			);
		}
		await api.dispose();
	} );

	test( 'requires an administrator for every route', async () => {
		expect( ( await api.get( RUNS ) ).status() ).toBe( 401 );
		expect(
			(
				await api.post( RUNS, {
					data: {
						action: 'import_mollie_payments',
						source_id: 'test',
					},
				} )
			).status()
		).toBe( 401 );
		expect( ( await api.post( `${ RUNS }/1/finish` ) ).status() ).toBe(
			401
		);

		const subscriber = await createUser( 'subscriber' );
		expect(
			( await api.get( RUNS, { headers: subscriber } ) ).status()
		).toBe( 403 );
		expect(
			(
				await start(
					{ action: 'import_mollie_payments', source_id: 'test' },
					subscriber
				)
			).status()
		).toBe( 403 );
	} );

	test( 'validates the action and source', async () => {
		expect(
			( await start( { action: 'drop_tables', source_id: '' } ) ).status()
		).toBe( 400 );
		expect(
			(
				await start( {
					action: 'import_mollie_payments',
					source_id: 'staging',
				} )
			).status()
		).toBe( 400 );
		expect(
			(
				await start( {
					action: 'load_missing_mollie_fees',
					source_id: 'production',
				} )
			).status()
		).toBe( 400 );
	} );

	test( 'a Mollie import records a succeeded run, and repeating it skips instead of duplicating', async () => {
		const first = await startOk( {
			action: 'import_mollie_payments',
			source_id: 'test',
		} );
		expect( first.run ).toEqual(
			expect.objectContaining( {
				status: 'running',
				source_type: 'mollie',
				source_label: 'Mollie (test)',
				action: 'import_mollie_payments',
			} )
		);

		const firstRes = await importMollie( first.run.id, 'test', [
			'tr_e2emanualimport',
		] );
		expect( firstRes.ok(), await firstRes.text() ).toBeTruthy();
		const firstBody = await firstRes.json();
		expect( firstBody.run.status ).toBe( 'succeeded' );
		expect(
			firstBody.run.counts.created + firstBody.run.counts.skipped
		).toBe( 1 );

		const retry = await startOk( {
			action: 'import_mollie_payments',
			source_id: 'test',
		} );
		const retryBody = await (
			await importMollie( retry.run.id, 'test', [ 'tr_e2emanualimport' ] )
		).json();
		expect( retryBody.run.id ).not.toBe( first.run.id );
		expect( retryBody.run.status ).toBe( 'succeeded' );
		expect( retryBody.run.counts ).toEqual( {
			created: 0,
			updated: 0,
			skipped: 1,
			failed: 0,
		} );

		const count = await (
			await api.get(
				`${ HELPERS }/transactions?prefix=tr_e2emanualimport`,
				{
					headers: admin,
				}
			)
		).json();
		expect( count ).toEqual( { rows: 1, distinct: 1 } );
	} );

	test( 'distinguishes partial and failed Mollie imports', async () => {
		await api.post( `${ HELPERS }/mollie-status`, {
			headers: admin,
			data: { status: 'open' },
		} );

		const partial = await startOk( {
			action: 'import_mollie_payments',
			source_id: 'test',
		} );
		const partialBody = await (
			await importMollie( partial.run.id, 'test', [
				'tr_e2emanualimport',
				'tr_e2eopenpayment',
			] )
		).json();
		expect( partialBody.failures ).toEqual( [
			expect.objectContaining( { payment_id: 'tr_e2eopenpayment' } ),
		] );
		expect( partialBody.run.status ).toBe( 'partial' );
		expect( partialBody.run.counts.failed ).toBe( 1 );

		// A test-mode payment requested in live mode is ineligible.
		const failed = await startOk( {
			action: 'import_mollie_payments',
			source_id: 'live',
		} );
		const failedBody = await (
			await importMollie( failed.run.id, 'live', [
				'tr_e2emanualimport',
			] )
		).json();
		expect( failedBody.run.status ).toBe( 'failed' );
		expect( failedBody.run.counts ).toEqual( {
			created: 0,
			updated: 0,
			skipped: 0,
			failed: 1,
		} );
	} );

	test( 'refuses a second run while one is active', async () => {
		const active = await startOk( {
			action: 'import_mollie_payments',
			source_id: 'test',
		} );

		const busy = await start( {
			action: 'load_missing_mollie_fees',
			source_id: 'live',
		} );
		expect( busy.status() ).toBe( 409 );
		const body = await busy.json();
		expect( body.code ).toBe( 'external_update_in_progress' );
		expect( body.data.run.id ).toBe( active.run.id );

		await importMollie( active.run.id, 'test', [ 'tr_e2emanualimport' ] );
		const next = await start( {
			action: 'import_mollie_payments',
			source_id: 'test',
		} );
		expect( next.status() ).toBe( 201 );
	} );

	test( 'only the initiating administrator can record work on a matching, running run', async () => {
		const run = (
			await startOk( {
				action: 'import_mollie_payments',
				source_id: 'test',
			} )
		).run;

		// Another source.
		const mismatch = await importMollie( run.id, 'live', [
			'tr_e2emanualimport',
		] );
		expect( mismatch.status() ).toBe( 400 );

		// Another action.
		const wrongAction = await api.post( BATCH, {
			headers: admin,
			data: { ids: [ 1 ], run_id: run.id },
		} );
		expect( wrongAction.status() ).toBe( 400 );

		// Another administrator.
		const otherAdmin = await createUser( 'administrator' );
		const foreign = await importMollie(
			run.id,
			'test',
			[ 'tr_e2emanualimport' ],
			otherAdmin
		);
		expect( foreign.status() ).toBe( 403 );

		// Unknown run.
		expect(
			(
				await importMollie( 99999999, 'test', [ 'tr_e2emanualimport' ] )
			).status()
		).toBe( 404 );

		// Finished run.
		await importMollie( run.id, 'test', [ 'tr_e2emanualimport' ] );
		const again = await importMollie( run.id, 'test', [
			'tr_e2emanualimport',
		] );
		expect( again.status() ).toBe( 409 );
	} );

	test( 'the fee run counts on the server and counts batches that never arrived as failed', async () => {
		const seededId = await seedUnfeedTransaction();
		await seedUnfeedTransaction();

		const started = await startOk( {
			action: 'load_missing_mollie_fees',
			source_id: 'live',
		} );
		expect( started.run.source_label ).toBe( 'Mollie (live)' );
		expect( started.ids ).toContain( seededId );
		expect( started.run.expected_total ).toBe( started.ids.length );
		expect( started.ids.length ).toBeGreaterThanOrEqual( 2 );

		// Only one batch reaches the server; the double never finds a fee.
		const batch = await api.post( BATCH, {
			headers: admin,
			data: { ids: [ seededId ], run_id: started.run.id },
		} );
		expect( batch.ok(), await batch.text() ).toBeTruthy();
		expect( ( await batch.json() ).run.counts.failed ).toBe( 1 );

		const finished = await api.post(
			`${ RUNS }/${ started.run.id }/finish`,
			{
				headers: admin,
			}
		);
		expect( finished.ok(), await finished.text() ).toBeTruthy();
		const { run } = await finished.json();
		expect( run.status ).toBe( 'failed' );
		expect( run.error_code ).toBe( 'incomplete' );
		expect( run.counts.failed ).toBe( started.ids.length );
		expect( run.counts.updated ).toBe( 0 );

		// Finishing twice is refused.
		expect(
			(
				await api.post( `${ RUNS }/${ started.run.id }/finish`, {
					headers: admin,
				} )
			).status()
		).toBe( 409 );
	} );

	test( 'a run without a heartbeat is shown as interrupted with its last counts', async () => {
		const seededId = await seedUnfeedTransaction();
		const started = await startOk( {
			action: 'load_missing_mollie_fees',
			source_id: 'live',
		} );
		await api.post( BATCH, {
			headers: admin,
			data: { ids: [ seededId ], run_id: started.run.id },
		} );

		await api.post( `${ HELPERS }/age-running`, {
			headers: admin,
			data: { id: started.run.id },
		} );

		const { items } = await listRuns();
		const run = items.find( ( item ) => item.id === started.run.id );
		expect( run.status ).toBe( 'interrupted' );
		expect( run.error_code ).toBe( 'interrupted' );
		expect( run.counts.failed ).toBe( 1 );
		expect( run.finished_at ).toBeTruthy();
	} );

	test( 'lists runs newest first, paginated, with only allowlisted fields', async () => {
		await startOk( {
			action: 'load_missing_mollie_fees',
			source_id: 'test',
		} );
		await api.post( `${ HELPERS }/age-running`, { headers: admin } );

		const all = await listRuns();
		expect( all.items.length ).toBeGreaterThan( 1 );
		const ids = all.items.map( ( item ) => item.id );
		expect( ids ).toEqual( [ ...ids ].sort( ( a, b ) => b - a ) );

		for ( const item of all.items ) {
			expect( Object.keys( item ).sort() ).toEqual( RUN_KEYS );
			expect( Object.keys( item.counts ).sort() ).toEqual( [
				'created',
				'failed',
				'skipped',
				'updated',
			] );
		}
		expect( JSON.stringify( all ) ).not.toMatch(
			/e2e-connected-site-token|test-token|Bearer /i
		);

		const second = await listRuns( '?page=2&per_page=1' );
		expect( second.page ).toBe( 2 );
		expect( second.items ).toHaveLength( 1 );
		expect( second.items[ 0 ].id ).toBe( ids[ 1 ] );
		expect( second.pages ).toBe( second.total );
	} );
} );
