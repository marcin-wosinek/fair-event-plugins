/**
 * The supported installation and upgrade path after the payment history
 * migration (#2255, PAYMENT_HISTORY_MIGRATION.md §8.17).
 *
 * Runs on its own fresh site (`upgrade-path`, e2e/drop-ins/db.php) with
 * Connector, Fair Events and Fair Audience, and walks it through each case
 * in order, because a recorded completion is never removed:
 *
 * 1. Fresh installation: the evidence is recorded on activation and the
 *    site is safe to upgrade, with nothing to clean up.
 * 2. Existing site that never finished the migration (the evidence and the
 *    intermediate release's activations removed, its database version
 *    stored): neither plugin starts, neither installer runs, the
 *    administrator sees why and what to do, and repeated requests stay
 *    refused.
 * 3. Migration finished but a blocking finding or failed migration work is
 *    left: still refused. Informational findings and pending work don't
 *    block.
 * 4. Migration finished: the evidence is recorded, the installer finishes
 *    the upgrade, events, tickets and settings are unchanged, and the
 *    checklist separates "safe to upgrade" from "ready for cleanup".
 *
 * The staging verification's permissions and validation run on the same
 * site.
 */

import { test, expect, request } from '@playwright/test';
import {
	installFreshSite,
	dropFreshSite,
} from '../../../../e2e/support/fresh-site.js';

const SITE = 'upgrade-path';
const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const SUBSCRIBER_PASSWORD = 'upgrade-path-subscriber';
const UPGRADE = '/wp-json/fair-events/v1/payment-history/upgrade';
const STAGING = `${ UPGRADE }/staging-verification`;

const basicAuth = ( user, password ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ user }:${ password }` ).toString(
		'base64'
	) }`,
} );

test.describe.configure( { mode: 'serial' } );

test.describe( 'Supported upgrade path after the payment history migration', () => {
	let site;
	let admin;
	let subscriber;
	let anonymous;
	let browserAdmin;
	let event;
	let currentDbVersion;

	const fixture = ( action, data = {} ) =>
		site.script(
			'payment-upgrade.php',
			'E2E_PAYMENT_UPGRADE',
			action,
			data
		);

	/** Whether Fair Events and Fair Audience registered their routes. */
	async function routesRegistered() {
		const index = await admin.get( '/wp-json/' );
		expect( index.ok() ).toBeTruthy();
		const namespaces = ( await index.json() ).namespaces;
		return {
			events: namespaces.includes( 'fair-events/v1' ),
			audience: namespaces.includes( 'fair-audience/v1' ),
		};
	}

	/**
	 * The administrator's dashboard HTML. wp-admin checks the login cookie,
	 * not Basic Auth, so this context logs in through wp-login.php first.
	 */
	async function dashboard() {
		if ( ! browserAdmin ) {
			browserAdmin = await request.newContext( {
				baseURL: BASE_URL,
				extraHTTPHeaders: site.headers,
			} );
			await browserAdmin.get( '/wp-login.php' );
			const login = await browserAdmin.post( '/wp-login.php', {
				form: {
					log: ADMIN_USER,
					pwd: ADMIN_PASSWORD,
					testcookie: '1',
					'wp-submit': 'Log In',
					redirect_to: `${ BASE_URL }/wp-admin/`,
				},
				headers: {
					Cookie: 'wordpress_test_cookie=WP%20Cookie%20check',
				},
			} );
			expect( login.ok() ).toBeTruthy();
		}
		const response = await browserAdmin.get( '/wp-admin/index.php' );
		expect( response.ok() ).toBeTruthy();
		const html = await response.text();
		expect( html ).toContain( 'id="wpadminbar"' );
		return html;
	}

	test.beforeAll( async () => {
		test.setTimeout( 300_000 );
		site = await installFreshSite( SITE, [
			'fair-payments-connector',
			'fair-events',
			'fair-audience',
		] );
		await site.wp( [
			'user',
			'create',
			'upgrade-subscriber',
			'upgrade-subscriber@example.test',
			'--role=subscriber',
			`--user_pass=${ SUBSCRIBER_PASSWORD }`,
		] );
		event = await site.seedEvent( 'paid' );

		const context = ( headers ) =>
			request.newContext( {
				baseURL: BASE_URL,
				extraHTTPHeaders: { ...site.headers, ...headers },
			} );
		admin = await context( basicAuth( ADMIN_USER, ADMIN_PASSWORD ) );
		subscriber = await context(
			basicAuth( 'upgrade-subscriber', SUBSCRIBER_PASSWORD )
		);
		anonymous = await context( {} );
	} );

	test.afterAll( async () => {
		await admin?.dispose();
		await subscriber?.dispose();
		await anonymous?.dispose();
		await browserAdmin?.dispose();
		test.setTimeout( 120_000 );
		await dropFreshSite( SITE );
	} );

	test( 'a fresh installation records its evidence and needs no migration', async () => {
		const state = await fixture( 'state' );
		expect( state.evidence ).toMatchObject( {
			basis: 'fresh_install',
			plugin_versions: { 'fair-events': expect.any( String ) },
		} );
		expect( state.cutover ).toBeNull();
		expect( state.readers ).toBeNull();
		currentDbVersion = state.eventsDbVersion;

		// A fresh Fair Audience doesn't create the retired ledger (#2254).
		const storage = await site.state();
		expect( storage.audienceTables ).toContain(
			`${ storage.prefix }fair_audience_event_participants`
		);
		expect( storage.audienceTables ).not.toContain(
			`${ storage.prefix }fair_audience_event_participant_transactions`
		);

		const response = await admin.get( UPGRADE );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();
		expect( body.safe_to_upgrade ).toBe( true );
		expect( body.checks ).toEqual( { completion_recorded: true } );
		expect( body.ready_for_cleanup ).toEqual( {
			applicable: false,
			ready: false,
			blockers: [],
		} );
		expect( body.intermediate_release.versions ).toEqual( {
			'fair-payments-connector': '2.8.0',
			'fair-events': '2.2.0',
			'fair-audience': '2.0.0',
		} );

		// Purchases and Statistics work without any migration control.
		const statistics = await admin.get(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/statistics`
		);
		expect( statistics.status() ).toBe( 200 );
		expect( ( await statistics.json() ).total_tickets ).toBe( 0 );
		expect( await routesRegistered() ).toEqual( {
			events: true,
			audience: true,
		} );
	} );

	test( 'the staging verification is for administrators and validated', async () => {
		const valid = {
			verified_on: '2026-11-04',
			versions: {
				'fair-payments-connector': '2.8.0',
				'fair-events': '2.2.0',
				'fair-audience': '2.0.0',
			},
			checks: { statistics_revenue: true },
			note: 'Staging copy',
		};

		expect(
			( await anonymous.put( STAGING, { data: valid } ) ).status()
		).toBe( 401 );
		expect(
			( await subscriber.put( STAGING, { data: valid } ) ).status()
		).toBe( 403 );
		expect( ( await subscriber.get( UPGRADE ) ).status() ).toBe( 403 );

		const invalid = await admin.put( STAGING, {
			data: { ...valid, verified_on: '2999-01-01' },
		} );
		expect( invalid.status() ).toBe( 400 );
		expect( ( await invalid.json() ).data.fields ).toEqual( [
			'verified_on',
		] );

		const unknown = await admin.put( STAGING, {
			data: { ...valid, checks: { made_up: true } },
		} );
		expect( unknown.status() ).toBe( 400 );

		const saved = await admin.put( STAGING, { data: valid } );
		expect( saved.status() ).toBe( 200 );
		const body = await saved.json();
		expect( body.staging_verification ).toMatchObject( {
			verified_on: '2026-11-04',
			versions: valid.versions,
			checks: {
				representative_purchases: false,
				statistics_revenue: true,
			},
			note: 'Staging copy',
			user_name: expect.any( String ),
		} );
		expect( ( await fixture( 'state' ) ).staging.user_id ).toBeGreaterThan(
			0
		);
	} );

	test( 'an unmigrated site starts neither plugin and writes nothing', async () => {
		await fixture( 'unmigrated', { dbVersion: '3.52.0' } );

		for ( let attempt = 0; attempt < 2; attempt++ ) {
			expect( await routesRegistered() ).toEqual( {
				events: false,
				audience: false,
			} );
			const state = await fixture( 'state' );
			expect( state.evidence ).toBeNull();
			// Neither installer ran: the stored versions are untouched.
			expect( state.eventsDbVersion ).toBe( '3.52.0' );
		}

		const html = await dashboard();
		expect( html ).toContain(
			'Fair Events is paused: this site hasn’t finished the payment history migration.'
		);
		expect( html ).toContain(
			'Payment records were not switched to Fair Events.'
		);
		expect( html ).toContain(
			'Statistics were not switched to Fair Events records.'
		);
		expect( html ).toContain( 'build-2.2.0' );
		expect( html ).toContain(
			'Fair Audience is paused until Fair Events can run on this site.'
		);
	} );

	test( 'a finished migration with a blocking finding or failed work stays refused', async () => {
		await fixture( 'migrated', {
			findings: [ { reason: 'no_evidence', sourceId: 9001 } ],
			work: [
				{ kind: 'relationship', sourceId: 9002, status: 'unresolved' },
			],
		} );

		expect( ( await routesRegistered() ).events ).toBe( false );
		let html = await dashboard();
		expect( html ).toContain( 'Some migration findings are still open.' );
		expect( html ).toContain(
			'Some payment records still wait to be moved.'
		);
		expect( html ).not.toContain(
			'Payment records were not switched to Fair Events.'
		);
		expect( ( await fixture( 'state' ) ).evidence ).toBeNull();

		// An informational finding doesn't block; failed work still does.
		await fixture( 'migrated', {
			findings: [ { reason: 'amount_mismatch', sourceId: 9003 } ],
			work: [ { kind: 'transaction', sourceId: 9004, status: 'failed' } ],
		} );
		html = await dashboard();
		expect( html ).not.toContain(
			'Some migration findings are still open.'
		);
		expect( html ).toContain(
			'Some payment records still wait to be moved.'
		);
		expect( ( await fixture( 'state' ) ).evidence ).toBeNull();

		// Pending work hasn't been tried yet and doesn't block either.
		await fixture( 'migrated', {
			findings: [ { reason: 'amount_mismatch', sourceId: 9003 } ],
			work: [
				{ kind: 'transaction', sourceId: 9005, status: 'pending' },
			],
		} );
	} );

	test( 'a finished migration upgrades and keeps events and settings', async () => {
		expect( await routesRegistered() ).toEqual( {
			events: true,
			audience: true,
		} );

		const state = await fixture( 'state' );
		expect( state.evidence ).toMatchObject( {
			basis: 'migrated',
			ownership_cutover: { audit_id: 1 },
			readers: { reason: 'reader_cutover', audit_id: 2 },
		} );
		// The installer finished the upgrade the refused requests skipped.
		expect( state.eventsDbVersion ).toBe( currentDbVersion );
		// The staging verification recorded earlier is still there.
		expect( state.staging.verified_on ).toBe( '2026-11-04' );

		const statistics = await admin.get(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/statistics`
		);
		expect( statistics.status() ).toBe( 200 );

		const body = await ( await admin.get( UPGRADE ) ).json();
		expect( body.safe_to_upgrade ).toBe( true );
		expect( body.evidence.basis ).toBe( 'migrated' );
		expect( body.checks ).toEqual( {
			completion_recorded: true,
			migration_verified: true,
			ownership_cutover: true,
			readers_switched: true,
			no_migration_work: true,
			no_blocking_finding: true,
		} );
		// Safe to upgrade is not ready for cleanup.
		expect( body.ready_for_cleanup ).toEqual( {
			applicable: true,
			ready: false,
			blockers: [
				'staging_verification_incomplete',
				'cleanup_unavailable',
			],
		} );

		// The evidence outlives the migration records it came from, as the
		// cleanup (#2252–#2254) will remove them.
		await fixture( 'retire' );
		expect( await routesRegistered() ).toEqual( {
			events: true,
			audience: true,
		} );
		expect( ( await fixture( 'state' ) ).evidence.basis ).toBe(
			'migrated'
		);
		const after = await ( await admin.get( UPGRADE ) ).json();
		expect( after.safe_to_upgrade ).toBe( true );
		expect( Object.values( after.checks ).every( ( met ) => met ) ).toBe(
			true
		);
	} );
} );
