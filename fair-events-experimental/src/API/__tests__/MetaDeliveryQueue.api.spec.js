/**
 * Live WordPress integration tests for queued Meta delivery (#1971):
 * WP-Cron wake-ups follow the earliest outstanding work, scheduling failures
 * are reported to administrators and repaired by later requests, claims
 * carry leases so interrupted workers are recovered while active ones are
 * left alone, each worker run is bounded, and concurrent workers send every
 * event once under its stable Meta event ID.
 *
 * Rows are driven through e2e/mu-plugins/scripts/meta-queue-fixture.php and
 * scoped to this run by their source URL. The Graph API double
 * (e2e/mu-plugins/lib/meta-http-double.php) answers every send, and its
 * `fair_e2e_meta_hold_cron` switch keeps WP-Cron from running wake-ups
 * behind the suite's back. Sending needs credentials; when the instance
 * already has an access token (write-only, so it cannot be restored) the
 * suite is skipped rather than overwriting it.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const CONFIG_PATH = '/wp-json/fair-events-experimental/v1/meta-conversions';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const FIXTURE = 'wp-content/mu-plugins/scripts/meta-queue-fixture.php';
const LEASE_SECONDS = 300;
const ROW_LIMIT = 20;

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

/**
 * Run WP-CLI on the tests instance without blocking the event loop.
 *
 * @param {...string} args WP-CLI arguments.
 * @return {Promise<string>} Standard output.
 */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	return stdout;
}

/**
 * Run one fixture action and return the state it reports.
 *
 * @param {...string} args Action, source and action arguments.
 * @return {Promise<Object>} Reported state.
 */
async function fixture( ...args ) {
	const out = await wp( 'eval-file', FIXTURE, ...args );
	return JSON.parse( out.match( /E2E_META_QUEUE:(\{.*\})/ )[ 1 ] );
}

async function setOption( name, value ) {
	await wp( 'option', 'update', name, value );
}

async function deleteOption( name ) {
	await wp( 'option', 'delete', name ).catch( () => {} );
}

test.describe( 'Meta delivery queue', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let originalFeatureEnabled;
	let originalConfig;
	let source;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const settings = await (
			await api.get( SETTINGS_PATH, { headers: adminHeaders } )
		).json();
		originalFeatureEnabled = Boolean(
			settings.fair_events_experimental_features?.[ 'meta-conversions' ]
		);
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: { 'meta-conversions': true },
			},
		} );
		originalConfig = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
		test.skip(
			originalConfig.token_configured,
			'Would overwrite this instance’s write-only access token.'
		);
		await api.post( CONFIG_PATH, {
			headers: adminHeaders,
			data: { dataset_id: '1234567890123456' },
		} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_meta_access_token:
					'e2e-meta-access-token',
			},
		} );
		await setOption( 'fair_e2e_meta_hold_cron', '1' );
		await deleteOption( 'fair_e2e_meta_response' );
		// Earlier suites may have left due work; send it now so worker
		// limits below count only this suite's rows.
		await fixture( 'drain' );
	} );

	test.beforeEach( async ( {}, testInfo ) => {
		source = `https://example.test/meta-queue-${ Date.now() }-${
			testInfo.title.length
		}`;
		await fixture( 'clear-wakeups' );
	} );

	test.afterEach( async () => {
		await deleteOption( 'fair_e2e_meta_block_schedule' );
		await deleteOption( 'fair_e2e_meta_response' );
		await fixture( 'cleanup', source );
	} );

	test.afterAll( async () => {
		if ( ! originalConfig.token_configured ) {
			await api.post( CONFIG_PATH, {
				headers: adminHeaders,
				data: { dataset_id: originalConfig.dataset_id },
			} );
			await api.post( SETTINGS_PATH, {
				headers: adminHeaders,
				data: { fair_events_experimental_meta_access_token: '' },
			} );
			await fixture( 'clear-wakeups' );
		}
		await deleteOption( 'fair_e2e_meta_hold_cron' );
		await deleteOption( 'fair_events_experimental_meta_schedule_failure' );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_experimental_features: {
					'meta-conversions': originalFeatureEnabled,
				},
			},
		} );
		await api.dispose();
	} );

	test( 'a later request restores a missing schedule for pending work', async () => {
		await fixture( 'add', source, 'pending' );
		const cleared = await fixture( 'clear-wakeups', source );
		expect( cleared.wakeups ).toEqual( [] );

		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await anon.get( '/' ) ).ok() ).toBeTruthy();
		await anon.dispose();

		const state = await fixture( 'state', source );
		expect( state.wakeups ).toHaveLength( 1 );
		expect( state.wakeups[ 0 ] ).toBeLessThanOrEqual( state.now );
		// Repairing the schedule never sends from the request itself.
		expect( state.sent ).toEqual( [] );
		expect( state.rows[ 0 ].state ).toBe( 'pending' );
	} );

	test( 'scheduling failures are reported and recover automatically', async () => {
		await setOption( 'fair_e2e_meta_block_schedule', '1' );
		const failed = await fixture( 'queue', source, 'blocked' );
		// The conversion is kept although no wake-up could be scheduled.
		expect( failed.rows ).toHaveLength( 1 );
		expect( failed.rows[ 0 ].state ).toBe( 'pending' );
		expect( failed.wakeups ).toEqual( [] );

		let config = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
		expect( config.delivery_schedule ).toMatchObject( {
			healthy: false,
			last_failure_code: 'e2e_schedule_blocked',
		} );
		expect( config.delivery_schedule.last_failure_at ).toMatch(
			/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
		);
		expect( config.delivery_schedule.last_failure_at_local ).toBeTruthy();

		// Background execution is available again: the next request repairs it.
		await deleteOption( 'fair_e2e_meta_block_schedule' );
		config = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
		expect( config.delivery_schedule.healthy ).toBe( true );
		expect( config.delivery_schedule.last_failure_at ).toBeTruthy();

		const state = await fixture( 'state', source );
		expect( state.wakeups ).toHaveLength( 1 );
		expect( state.wakeups[ 0 ] ).toBeLessThanOrEqual( state.now );
	} );

	test( 'new work is not held back by a distant retry', async () => {
		await fixture(
			'add',
			source,
			'retry',
			'{"state":"retry_pending","attempt_count":"5","next_attempt_at":"+43200"}'
		);
		const retrying = await fixture( 'reconcile', source );
		expect( retrying.wakeups ).toHaveLength( 1 );
		expect( retrying.wakeups[ 0 ] ).toBeGreaterThan( retrying.now + 43000 );

		const queued = await fixture( 'queue', source, 'new' );
		expect( queued.wakeups ).toHaveLength( 1 );
		expect( queued.wakeups[ 0 ] ).toBeLessThanOrEqual( queued.now );

		const delivered = await fixture( 'deliver', source );
		expect( delivered.sent ).toEqual( [ delivered.rows[ 1 ].event_id ] );
		expect( delivered.rows.map( ( row ) => row.state ) ).toEqual( [
			'retry_pending',
			'received',
		] );
		// The retry still has its own wake-up once the worker finishes.
		expect( delivered.wakeups ).toHaveLength( 1 );
		expect( delivered.wakeups[ 0 ] ).toBeGreaterThan(
			delivered.now + 43000
		);
	} );

	test( 'interrupted claims are recovered while active ones are left alone', async () => {
		await fixture(
			'add',
			source,
			'interrupted',
			'{"state":"sending","attempt_count":"2","claim_token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","claim_expires_at":"-60"}'
		);
		await fixture(
			'add',
			source,
			'active',
			'{"state":"sending","attempt_count":"1","claim_token":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","claim_expires_at":"+240"}'
		);
		await fixture(
			'add',
			source,
			'exhausted',
			'{"state":"sending","attempt_count":"6","claim_token":"cccccccccccccccccccccccccccccccc","claim_expires_at":"-60"}'
		);
		await fixture(
			'add',
			source,
			'immediate',
			'{"state":"immediate_sending","claim_expires_at":"-60"}'
		);

		const state = await fixture( 'deliver', source );
		const [ interrupted, active, exhausted, immediate ] = state.rows;

		// Only the expired claim is resent, under its original event ID.
		expect( state.sent ).toEqual( [ interrupted.event_id ] );
		expect( interrupted ).toMatchObject( {
			state: 'received',
			attempt_count: 3,
			claim_token: null,
		} );
		expect( interrupted.meta_diagnostics ).toMatchObject( {
			http_status: 200,
			events_received: 1,
		} );
		expect( active ).toMatchObject( {
			state: 'sending',
			claim_token: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		} );
		// The last attempt was the interrupted one: finished, never resent.
		expect( exhausted ).toMatchObject( {
			state: 'retries_exhausted',
			result_category: 'interrupted',
			meta_diagnostics: null,
			fbp: null,
		} );
		expect( immediate.state ).toBe( 'immediate_sending' );
		// The active claim keeps a wake-up for when its lease runs out.
		expect( state.wakeups ).toHaveLength( 1 );
		expect( state.wakeups[ 0 ] ).toBeLessThanOrEqual( state.now + 240 );
	} );

	test( 'sending rows from before leases get a full lease on upgrade', async () => {
		await fixture(
			'add',
			source,
			'legacy',
			'{"state":"sending","attempt_count":"1","claim_expires_at":null}'
		);
		const upgraded = await fixture( 'install', source );
		const leaseEnd =
			Date.parse( `${ upgraded.rows[ 0 ].claim_expires_at }Z` ) / 1000;
		expect( leaseEnd ).toBeGreaterThanOrEqual(
			upgraded.now + LEASE_SECONDS - 5
		);

		const delivered = await fixture( 'deliver', source );
		expect( delivered.sent ).toEqual( [] );
		expect( delivered.rows[ 0 ].state ).toBe( 'sending' );
	} );

	test( 'a backlog is sent in bounded runs with the rest scheduled', async () => {
		await fixture( 'backlog', source, String( ROW_LIMIT + 3 ) );
		const first = await fixture( 'deliver', source );
		expect( first.sent ).toHaveLength( ROW_LIMIT );
		expect(
			first.rows.filter( ( row ) => 'pending' === row.state )
		).toHaveLength( 3 );
		expect( first.wakeups ).toHaveLength( 1 );
		expect( first.wakeups[ 0 ] ).toBeLessThanOrEqual( first.now );

		const second = await fixture( 'deliver', source );
		expect( second.sent ).toHaveLength( ROW_LIMIT + 3 );
		expect( new Set( second.sent ).size ).toBe( ROW_LIMIT + 3 );
		expect( second.rows.every( ( row ) => 'received' === row.state ) ).toBe(
			true
		);
	} );

	test( 'overlapping workers send each event once', async () => {
		await fixture( 'backlog', source, '6' );
		// Slow answers keep both workers sending at the same time.
		await wp(
			'option',
			'update',
			'fair_e2e_meta_response',
			JSON.stringify( { delay: 1 } ),
			'--format=json'
		);
		await Promise.all( [ fixture( 'deliver' ), fixture( 'deliver' ) ] );

		const state = await fixture( 'state', source );
		// Counted from the per-attempt log: the double's own request log
		// can lose entries under concurrent writers.
		expect(
			state.rows.map( ( row ) => [
				row.state,
				row.attempt_count,
				row.logged_attempts,
			] )
		).toEqual( Array( 6 ).fill( [ 'received', 1, 1 ] ) );
	} );

	test( 'concurrent scheduling keeps a single early wake-up', async () => {
		await fixture(
			'add',
			source,
			'race-retry',
			'{"state":"retry_pending","next_attempt_at":"+1800"}'
		);
		await fixture( 'reconcile', source );
		await Promise.all( [
			fixture( 'queue', source, 'race-a' ),
			fixture( 'queue', source, 'race-b' ),
		] );
		await fixture( 'reconcile', source );

		const state = await fixture( 'state', source );
		expect( state.wakeups.length ).toBeGreaterThanOrEqual( 1 );
		// Neither request removed the other's early wake-up, and the
		// distant retry's own wake-up was replaced, not kept alongside.
		expect( state.wakeups[ 0 ] ).toBeLessThanOrEqual( state.now );
		expect(
			state.wakeups.filter( ( at ) => at > state.now + 600 )
		).toEqual( [] );
	} );

	test( 'Meta warnings on a confirmed receipt are kept, redacted', async () => {
		await fixture( 'add', source, 'warning' );
		await wp(
			'option',
			'update',
			'fair_e2e_meta_response',
			JSON.stringify( {
				status: 200,
				body: {
					events_received: 1,
					messages: [
						'Low match quality for fb.1.1712345678901.e2equeue with token e2e-meta-access-token',
					],
					fbtrace_id: 'E2EwarnTrace01',
				},
			} ),
			'--format=json'
		);
		const state = await fixture( 'deliver', source );
		expect( state.rows[ 0 ].state ).toBe( 'received' );
		expect( state.rows[ 0 ].meta_diagnostics ).toEqual( {
			http_status: 200,
			events_received: 1,
			messages: [
				'Low match quality for [redacted] with token [redacted]',
			],
			fbtrace_id: 'E2EwarnTrace01',
		} );
		expect( state.rows[ 0 ].fbp ).toBeNull();

		const config = await (
			await api.get( CONFIG_PATH, { headers: adminHeaders } )
		).json();
		expect( JSON.stringify( config ) ).not.toContain(
			'e2e-meta-access-token'
		);
		expect( JSON.stringify( config ) ).not.toContain(
			'fb.1.1712345678901.e2equeue'
		);
	} );
} );
