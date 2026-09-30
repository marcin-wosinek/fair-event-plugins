/**
 * Connected-site imports as External Updates runs (#1695): run start checks
 * the site server-side, counts are recorded per page, remote failures after
 * partial progress are logged as partial, and retries never duplicate.
 *
 * Remote sites are served by e2e/mu-plugins/lib/connected-site-http-double.php.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const admin = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const SITES = '/wp-json/fair-payments-connector/v1/admin/connected-sites';
const RUNS = '/wp-json/fair-payments-connector/v1/external-updates/runs';
const HELPERS = '/wp-json/fair-e2e/v1/external-updates';
const TOKEN = 'e2e-connected-site-token';

test.describe( 'Connected sites — External Updates runs (#1695)', () => {
	let api;
	const siteIds = [];

	const createSite = async ( host ) => {
		const res = await api.post( SITES, {
			headers: admin,
			data: {
				label: `E2E ${ host } ${ Date.now() }`,
				base_url: `https://${ host }.connected-site.e2e.test`,
				token: TOKEN,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const site = await res.json();
		siteIds.push( site.id );
		return site;
	};

	const startRun = ( siteId ) =>
		api.post( RUNS, {
			headers: admin,
			data: {
				action: 'import_connected_site',
				source_id: String( siteId ),
			},
		} );

	const importSite = ( siteId, runId ) =>
		api.post( `${ SITES }/${ siteId }/import-transactions`, {
			headers: admin,
			data: { run_id: runId },
		} );

	const runImport = async ( site ) => {
		const started = await startRun( site.id );
		expect( started.status(), await started.text() ).toBe( 201 );
		const { run } = await started.json();
		return importSite( site.id, run.id );
	};

	const countTransactions = async ( prefix ) =>
		(
			await api.get( `${ HELPERS }/transactions?prefix=${ prefix }`, {
				headers: admin,
			} )
		).json();

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await api.delete( `${ HELPERS }/transactions?prefix=tr_e2ecs`, {
			headers: admin,
		} );
	} );

	// A run left running by another spec would trip the overlap guard.
	test.beforeEach( async () => {
		await api.post( `${ HELPERS }/age-running`, { headers: admin } );
	} );

	test.afterAll( async () => {
		for ( const id of siteIds ) {
			await api.delete( `${ SITES }/${ id }`, { headers: admin } );
		}
		await api.delete( `${ HELPERS }/transactions?prefix=tr_e2ecs`, {
			headers: admin,
		} );
		await api.post( `${ HELPERS }/source-transactions`, {
			headers: admin,
			data: { transactions: [] },
		} );
		await api.dispose();
	} );

	test( 'a disabled or unknown site cannot start a run', async () => {
		const site = await createSite( 'ok' );
		const disable = await api.put( `${ SITES }/${ site.id }`, {
			headers: admin,
			data: { enabled: false },
		} );
		expect( disable.ok(), await disable.text() ).toBeTruthy();

		const disabled = await startRun( site.id );
		expect( disabled.status() ).toBe( 403 );
		expect( ( await disabled.json() ).code ).toBe(
			'rest_connected_site_disabled'
		);

		const unknown = await startRun( 99999999 );
		expect( unknown.status() ).toBe( 404 );

		// Neither attempt left a running run behind.
		const { items } = await (
			await api.get( RUNS, { headers: admin } )
		).json();
		expect( items.filter( ( item ) => item.status === 'running' ) ).toEqual(
			[]
		);
	} );

	test( 'records a succeeded run, and a retry updates instead of duplicating', async () => {
		const site = await createSite( 'ok' );

		const first = await runImport( site );
		expect( first.ok(), await first.text() ).toBeTruthy();
		const firstBody = await first.json();
		expect( firstBody.run ).toEqual(
			expect.objectContaining( {
				status: 'succeeded',
				source_type: 'connected_site',
				source_id: String( site.id ),
				source_label: site.label,
				action: 'import_connected_site',
			} )
		);
		expect( firstBody.run.counts ).toEqual( {
			created: 2,
			updated: 0,
			skipped: 0,
			failed: 0,
		} );

		const retry = await runImport( site );
		const retryBody = await retry.json();
		expect( retryBody.run.id ).not.toBe( firstBody.run.id );
		expect( retryBody.run.counts ).toEqual( {
			created: 0,
			updated: 2,
			skipped: 0,
			failed: 0,
		} );

		expect( await countTransactions( 'tr_e2ecsok' ) ).toEqual( {
			rows: 2,
			distinct: 2,
		} );
	} );

	test( 'a remote failure after a full page is logged as partial, and a retry does not duplicate', async () => {
		const site = await createSite( 'partial' );

		const first = await runImport( site );
		expect( first.status() ).toBe( 502 );
		const firstBody = await first.json();
		expect( firstBody.message ).toContain( 'stopped after 200 new' );
		expect( firstBody.data.run ).toEqual(
			expect.objectContaining( {
				status: 'partial',
				error_code: 'remote_unreachable',
				error_message: 'The connected site could not be reached.',
			} )
		);
		expect( firstBody.data.run.counts.created ).toBe( 200 );

		const retry = await runImport( site );
		expect( retry.status() ).toBe( 502 );
		const retryRun = ( await retry.json() ).data.run;
		expect( retryRun.status ).toBe( 'partial' );
		expect( retryRun.counts ).toEqual( {
			created: 0,
			updated: 200,
			skipped: 0,
			failed: 0,
		} );

		expect( await countTransactions( 'tr_e2ecspartial' ) ).toEqual( {
			rows: 200,
			distinct: 200,
		} );
	} );

	test( 'a rejected token fails the run without logging the token or remote body', async () => {
		const site = await createSite( 'rejected' );

		const res = await runImport( site );
		expect( res.status() ).toBe( 400 );
		const { run } = ( await res.json() ).data;
		expect( run.status ).toBe( 'failed' );
		expect( run.error_code ).toBe( 'remote_rejected' );

		const log = await ( await api.get( RUNS, { headers: admin } ) ).text();
		expect( log ).not.toContain( TOKEN );
		expect( log ).not.toContain( 'rest_forbidden' );
		expect( log ).not.toContain( 'Bearer' );
	} );

	test( 'a re-import keeps central Mollie fees and only fills missing ones (#1715)', async () => {
		const site = await createSite( 'fees' );
		const id = ( key ) => `tr_e2ecsfees${ key }`;

		// `source` is the fee the connected site sends on re-import:
		// undefined leaves the field out, as an older site does. `central`
		// is the fee the central site recorded in between.
		const cases = [
			{
				key: 'keepold',
				central: 0.29,
				source: undefined,
				expected: 0.29,
			},
			{ key: 'keepnull', central: 0.29, source: null, expected: 0.29 },
			{ key: 'keepzero', central: 0.29, source: 0, expected: 0.29 },
			{ key: 'keepdiff', central: 0.29, source: 0.5, expected: 0.29 },
			{ key: 'centralzero', central: 0, source: 0.5, expected: 0 },
			{ key: 'fill', central: null, source: 0.35, expected: 0.35 },
			{ key: 'fillzero', central: null, source: 0, expected: 0 },
			{ key: 'nonenull', central: null, source: null, expected: null },
			{
				key: 'noneold',
				central: null,
				source: undefined,
				expected: null,
			},
		];

		const serve = ( version, feeOf ) =>
			api.post( `${ HELPERS }/source-transactions`, {
				headers: admin,
				data: {
					transactions: cases.map( ( item ) => {
						const row = {
							mollie_payment_id: id( item.key ),
							amount: version === 'v1' ? 10 : 12,
							currency: 'EUR',
							status: 'paid',
							testmode: true,
							description: `Fee case ${ item.key } ${ version }`,
							created_at: '2026-09-01 10:00:00',
						};
						const fee = feeOf( item );
						if ( fee !== undefined ) {
							row.mollie_fee = fee;
						}
						return row;
					} ),
				},
			} );

		const stored = async ( key ) => {
			const res = await api.get(
				`${ HELPERS }/transaction?mollie_payment_id=${ id( key ) }`,
				{ headers: admin }
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
			return res.json();
		};

		// First import from a current site creates each row with its fee.
		expect(
			( await serve( 'v1', ( item ) => item.source ) ).ok()
		).toBeTruthy();
		const created = await runImport( site );
		expect( created.ok(), await created.text() ).toBeTruthy();
		expect( ( await created.json() ).created ).toBe( cases.length );
		for ( const item of cases ) {
			expect( ( await stored( item.key ) ).mollie_fee ).toBe(
				item.source ?? null
			);
		}

		// The central site records (or loses) fees on its own.
		for ( const item of cases ) {
			const res = await api.post( `${ HELPERS }/transaction`, {
				headers: admin,
				data: {
					mollie_payment_id: id( item.key ),
					mollie_fee: item.central,
				},
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
		}

		// Re-import twice: fees follow the precedence rule and stay put,
		// while the other details keep updating.
		expect(
			( await serve( 'v2', ( item ) => item.source ) ).ok()
		).toBeTruthy();
		for ( let attempt = 0; attempt < 2; attempt++ ) {
			const res = await runImport( site );
			expect( res.ok(), await res.text() ).toBeTruthy();
			expect( ( await res.json() ).updated ).toBe( cases.length );

			for ( const item of cases ) {
				const row = await stored( item.key );
				expect( row.mollie_fee, item.key ).toBe( item.expected );
				expect( row.amount ).toBe( 12 );
				expect( row.description ).toBe( `Fee case ${ item.key } v2` );
				expect( row.created_at ).toBe( '2026-09-01 10:00:00' );
			}
		}

		expect( await countTransactions( 'tr_e2ecsfees' ) ).toEqual( {
			rows: cases.length,
			distinct: cases.length,
		} );
	} );

	test( 'the source endpoint shares each transaction’s Mollie fee (#1715)', async () => {
		const created = await api.post(
			'/wp-json/fair-payments-connector/v1/admin/api-tokens',
			{
				headers: admin,
				data: {
					label: `E2E fee source ${ Date.now() }`,
					scopes: [ 'transactions:read' ],
				},
			}
		);
		expect( created.status(), await created.text() ).toBe( 201 );
		const token = await created.json();

		try {
			const imported = await api.post(
				'/wp-json/fair-payments-connector/v1/transactions/import',
				{
					headers: admin,
					data: {
						transactions: [
							{
								mollie_payment_id: 'tr_e2ecssrcfee',
								mollie_fee: 0.31,
								created_at: '2099-01-01 10:00:00',
							},
							{
								mollie_payment_id: 'tr_e2ecssrcnone',
								created_at: '2099-01-01 10:00:00',
							},
						],
					},
				}
			);
			expect( imported.ok(), await imported.text() ).toBeTruthy();

			const res = await api.get(
				'/wp-json/fair-payments-connector/v1/external/transactions?from=2099-01-01&per_page=200',
				{ headers: { Authorization: `Bearer ${ token.token }` } }
			);
			expect( res.status(), await res.text() ).toBe( 200 );
			const { transactions } = await res.json();
			const feeOf = ( id ) =>
				transactions.find( ( row ) => row.mollie_payment_id === id )
					.mollie_fee;
			expect( feeOf( 'tr_e2ecssrcfee' ) ).toBe( 0.31 );
			expect( feeOf( 'tr_e2ecssrcnone' ) ).toBeNull();
		} finally {
			await api.delete(
				`/wp-json/fair-payments-connector/v1/admin/api-tokens/${ token.id }`,
				{ headers: admin }
			);
		}
	} );

	test( 'a run for one site cannot be used to import another', async () => {
		const one = await createSite( 'ok' );
		const other = await createSite( 'ok' );

		const started = await startRun( one.id );
		const { run } = await started.json();

		const res = await importSite( other.id, run.id );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'external_update_mismatch' );
	} );
} );
