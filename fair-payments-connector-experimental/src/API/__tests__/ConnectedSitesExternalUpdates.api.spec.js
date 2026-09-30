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
