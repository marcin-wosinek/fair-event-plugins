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
 * 5. Source-history cleanup (#2254, §8.21): refused without a backup, for
 *    non-administrators and while blocked, with nothing deleted; then it
 *    removes exactly the ledger, the comparisons table, the migration
 *    options and the dry-run findings, keeps everything else, and a repeat
 *    changes nothing. The evidence alone keeps the site running, and a
 *    site without it is still refused.
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
const CLEANUP = `${ UPGRADE }/cleanup`;
const ALL_STAGING_CHECKS = {
	representative_purchases: true,
	statistics_revenue: true,
	shared_allocations: true,
	finance_participant_attempts: true,
	audience_reactivation: true,
};

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
	let legacy;

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
			completed: null,
			blockers: [],
		} );
		const cleanup = await admin.post( CLEANUP, {
			data: { backup_confirmed: true },
		} );
		expect( cleanup.status() ).toBe( 409 );
		expect( ( await cleanup.json() ).code ).toBe(
			'cleanup_not_applicable'
		);
		expect( ( await fixture( 'storage' ) ).cleanup ).toBeNull();
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
		legacy = await fixture( 'legacy', {
			eventId: event.eventId,
			eventDateId: event.eventDateId,
		} );
		await fixture( 'unmigrated', { dbVersion: '3.52.0' } );
		const before = await fixture( 'storage' );

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

		// The cleanup isn't even registered, and nothing is removed.
		const cleanup = await admin.post( CLEANUP, {
			data: { backup_confirmed: true },
		} );
		expect( cleanup.status() ).toBe( 404 );
		expect( await fixture( 'storage' ) ).toEqual( before );
		expect( before.tables ).toEqual( { ledger: true, comparisons: true } );
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
			completed: null,
			blockers: [ 'staging_verification_incomplete' ],
		} );
	} );

	test( 'the cleanup is refused without a backup, for non-administrators and while blocked', async () => {
		// `migrated` replaced the findings: put the migration's leftovers back.
		legacy = await fixture( 'legacy', {
			eventId: event.eventId,
			eventDateId: event.eventDateId,
		} );
		const before = await fixture( 'storage' );
		expect( before.tables ).toEqual( { ledger: true, comparisons: true } );
		expect( before.options ).toHaveLength( 3 );

		const data = { backup_confirmed: true };
		expect( ( await anonymous.post( CLEANUP, { data } ) ).status() ).toBe(
			401
		);
		expect( ( await subscriber.post( CLEANUP, { data } ) ).status() ).toBe(
			403
		);

		const noBackup = await admin.post( CLEANUP, {
			data: { backup_confirmed: false },
		} );
		expect( noBackup.status() ).toBe( 400 );
		expect( ( await noBackup.json() ).code ).toBe( 'backup_required' );

		const unverified = await admin.post( CLEANUP, { data } );
		expect( unverified.status() ).toBe( 409 );
		expect( await unverified.json() ).toMatchObject( {
			code: 'cleanup_blocked',
			data: { blockers: [ 'staging_verification_incomplete' ] },
		} );

		const staged = await admin.put( STAGING, {
			data: {
				verified_on: '2026-11-04',
				versions: { 'fair-events': '2.2.0' },
				checks: ALL_STAGING_CHECKS,
			},
		} );
		expect( staged.status() ).toBe( 200 );
		expect( ( await staged.json() ).ready_for_cleanup ).toMatchObject( {
			ready: true,
			blockers: [],
		} );

		expect( await fixture( 'storage' ) ).toMatchObject( {
			tables: before.tables,
			options: before.options,
			findings: before.findings,
			kept: before.kept,
			cleanup: null,
		} );
	} );

	test( 'the cleanup removes exactly the migration’s storage and keeps the rest', async () => {
		const before = await fixture( 'storage' );

		const response = await admin.post( CLEANUP, {
			data: { backup_confirmed: true },
		} );
		expect( response.status() ).toBe( 200 );
		const body = await response.json();
		expect( body.performed ).toBe( true );
		expect( body.ready_for_cleanup ).toMatchObject( {
			applicable: true,
			ready: false,
			blockers: [],
			completed: {
				user_name: expect.any( String ),
				snapshotted_findings: 3,
			},
		} );

		const after = await fixture( 'storage' );
		expect( after.tables ).toEqual( { ledger: false, comparisons: false } );
		expect( after.options ).toEqual( [] );
		expect( after.cleanup ).toMatchObject( {
			removed: {
				tables: expect.arrayContaining( [
					expect.stringMatching(
						/fair_audience_event_participant_transactions$/
					),
					expect.stringMatching(
						/fair_events_payment_history_comparisons$/
					),
				] ),
				options: [
					'fair_events_payment_history_migration',
					'fair_events_payment_history_cutover',
					'fair_events_payment_history_readers',
				],
				dry_run_findings: 2,
				ledger_rows: 2,
			},
		} );

		// Relationships, purchases, links, recovery work and fee payments
		// are untouched; the evidence and staging verification stay.
		expect( after.kept ).toEqual( before.kept );
		expect( after.evidence ).toEqual( before.evidence );
		expect( after.staging ).toEqual( before.staging );

		// Dry-run findings are gone; backfill ones keep their status and
		// a copy of the ledger row they cite.
		expect( after.findings.map( ( f ) => f.mode ) ).not.toContain(
			'dry_run'
		);
		const strip = ( { detail, ...rest } ) => rest;
		expect( after.findings.map( strip ) ).toEqual(
			before.findings
				.filter( ( f ) => f.mode === 'backfill' )
				.map( strip )
		);
		const byId = Object.fromEntries(
			after.findings.map( ( f ) => [ f.id, f ] )
		);
		expect( byId[ legacy.findings.refund ].detail.ledger_row ).toEqual( {
			id: legacy.ledger.refund,
			event_participant_id: legacy.relationshipId,
			transaction_id: 7002,
			kind: 'refund',
			created_at: '2024-03-02 11:00:00',
		} );
		expect( byId[ legacy.findings.charge ] ).toMatchObject( {
			status: 'reviewed',
			detail: {
				transaction_id: 7001,
				ledger_row: { id: legacy.ledger.charge, kind: 'charge' },
			},
		} );
		expect( byId[ legacy.findings.deleted ].detail ).toMatchObject( {
			transaction_id: 7004,
			ledger_row: null,
		} );

		// The audit records the cleanup once.
		const audits = after.audit.filter( ( a ) => a.action === 'cleanup' );
		expect( audits ).toHaveLength( 1 );
		expect( audits[ 0 ].reason ).toBe( 'source_history_cleanup' );
		expect( Number( after.cleanup.audit_id ) ).toBe(
			Number( audits[ 0 ].id )
		);

		// The finding still renders from its stored detail.
		const finding = await admin.get(
			`/wp-json/fair-events/v1/payment-history/findings/${ legacy.findings.refund }`
		);
		expect( finding.status() ).toBe( 200 );
		expect( ( await finding.json() ).finding ).toMatchObject( {
			source_type: 'ledger_row',
			detail: { ledger_row: { kind: 'refund' } },
		} );
		const list = await admin.get(
			'/wp-json/fair-events/v1/payment-history/findings',
			{ params: { status: 'all', source_type: 'ledger_row' } }
		);
		expect( list.status() ).toBe( 200 );
		expect( ( await list.json() ).items ).toHaveLength( 3 );

		// The evidence alone keeps the site running.
		expect( await routesRegistered() ).toEqual( {
			events: true,
			audience: true,
		} );
		const status = await ( await admin.get( UPGRADE ) ).json();
		expect( status.safe_to_upgrade ).toBe( true );
		expect( Object.values( status.checks ).every( ( met ) => met ) ).toBe(
			true
		);
	} );

	test( 'repeating the cleanup changes nothing', async () => {
		const before = await fixture( 'storage' );
		const repeat = await admin.post( CLEANUP, {
			data: { backup_confirmed: true },
		} );
		expect( repeat.status() ).toBe( 200 );
		const body = await repeat.json();
		expect( body.performed ).toBe( false );
		expect( body.ready_for_cleanup.completed.completed_at ).toBe(
			before.cleanup.completed_at
		);
		expect( await fixture( 'storage' ) ).toEqual( before );
	} );

	test( 'after the cleanup, a site without the evidence is still refused', async () => {
		await fixture( 'unmigrated', { dbVersion: currentDbVersion } );
		expect( await routesRegistered() ).toEqual( {
			events: false,
			audience: false,
		} );
		const html = await dashboard();
		expect( html ).toContain(
			'Payment records were not switched to Fair Events.'
		);
	} );
} );
