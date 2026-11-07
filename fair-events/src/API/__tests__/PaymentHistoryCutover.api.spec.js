/**
 * The stage 4 activation (#2140, stage 4 of #2111;
 * PAYMENT_HISTORY_MIGRATION.md §8.13): `POST
 * /fair-events/v1/payment-history/cutover` is administrator-only, needs a
 * confirmed backup, refuses while anything blocks it or the verification's
 * recheck fails, activates exactly once under concurrent requests, records
 * an audit entry, and stays active through a later verification failure
 * and a Fair Audience deactivation and reactivation.
 *
 * The payment-cutover.php fixture stashes the site's migration state and
 * records a verified backfill with nothing outstanding, so only the site's
 * plugin capabilities decide readiness; everything is restored afterwards,
 * so no other spec runs with the activation.
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

const root = new URL( '../../../../', import.meta.url );

async function wpEnv( args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', ...args ],
		{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	return stdout;
}

async function cutover( action, data = {} ) {
	const stdout = await wpEnv( [
		'wp',
		'eval-file',
		'wp-content/mu-plugins/scripts/payment-cutover.php',
		action,
		JSON.stringify( data ),
	] );
	const match = stdout.match( /E2E_PAYMENT_CUTOVER:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_CUTOVER output, got:\n${ stdout }`
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

test.describe.serial( 'Payment history cutover activation', () => {
	test.describe.configure( { timeout: 240 * 1000 } );

	let api;
	let anonymous;
	let subscriberApi;
	let subscriberHeaders;
	let subscriberId;
	let audienceDeactivated = false;

	const activate = ( data = { backup_confirmed: true } ) =>
		api.post( `${ ROUTE }/cutover`, { headers: adminHeaders, data } );

	const status = async () => {
		const res = await api.get( ROUTE, { headers: adminHeaders } );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymous = await request.newContext( { baseURL: BASE_URL } );

		const prepared = await cutover( 'prepare' );
		expect( prepared.blockers ).toEqual( [] );

		const username = `payment-cutover-subscriber-${ Date.now() }`;
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
		if ( audienceDeactivated ) {
			await wpEnv( [ 'wp', 'plugin', 'activate', 'fair-audience' ] );
		}
		await cutover( 'restore' );
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

	test( 'only an administrator can activate', async () => {
		const data = { backup_confirmed: true };
		const loggedOut = await anonymous.post( `${ ROUTE }/cutover`, {
			data,
		} );
		expect( loggedOut.status() ).toBe( 401 );

		const subscriber = await subscriberApi.post( `${ ROUTE }/cutover`, {
			headers: subscriberHeaders,
			data,
		} );
		expect( subscriber.status() ).toBe( 403 );

		expect( ( await cutover( 'facts' ) ).cutover ).toBe( false );
	} );

	test( 'a backup confirmation is required', async () => {
		const res = await activate( {} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'backup_required' );
		expect( ( await cutover( 'facts' ) ).cutover ).toBe( false );
	} );

	test( 'readiness blockers refuse the activation', async () => {
		await cutover( 'status', { status: 'verification_failed' } );
		await cutover( 'queue' );

		const current = await status();
		expect( current.cutover.active ).toBe( false );
		expect( current.cutover.blockers ).toEqual(
			expect.arrayContaining( [
				'migration_unverified',
				'shadow_work_outstanding',
			] )
		);

		const res = await activate();
		expect( res.status() ).toBe( 409 );
		const body = await res.json();
		expect( body.code ).toBe( 'cutover_blocked' );
		expect( body.data.blockers ).toEqual(
			expect.arrayContaining( [
				'migration_unverified',
				'shadow_work_outstanding',
			] )
		);

		await cutover( 'unblock' );
		await cutover( 'status', { status: 'verified' } );
		expect( ( await cutover( 'facts' ) ).cutover ).toBe( false );
	} );

	test( 'the recheck refuses when verification no longer passes', async () => {
		await cutover( 'block' );

		// Nothing the status lists blocks: only the recheck under the lock
		// finds the blocking date.
		expect( ( await status() ).cutover.blockers ).toEqual( [] );
		const res = await activate();
		expect( res.status() ).toBe( 409 );
		const body = await res.json();
		expect( body.code ).toBe( 'verification_stale' );
		expect( body.data.verification_blockers ).toContain(
			'unexpected_differences'
		);

		await cutover( 'unblock' );
		expect( ( await cutover( 'facts' ) ).cutover ).toBe( false );
		expect( ( await cutover( 'audit' ) ).records ).toEqual( [] );
	} );

	test( 'concurrent requests activate exactly once, audited', async () => {
		const responses = await Promise.all( [ activate(), activate() ] );
		const codes = responses.map( ( res ) => res.status() ).sort();
		expect( codes ).toEqual( [ 200, 409 ] );

		const refused = responses.find( ( res ) => res.status() === 409 );
		expect( [ 'cutover_active', 'cutover_busy' ] ).toContain(
			( await refused.json() ).code
		);

		const accepted = await responses
			.find( ( res ) => res.status() === 200 )
			.json();
		expect( accepted.ownership_cutover ).toBe( true );
		expect( accepted.cutover.active ).toBe( true );
		expect( accepted.cutover.activation.user_name ).toBeTruthy();
		expect( accepted.cutover.issues ).toEqual( [] );

		const { records } = await cutover( 'audit' );
		expect( records ).toHaveLength( 1 );
		expect( records[ 0 ].reason ).toBe( 'ownership_cutover' );
		const recorded = JSON.parse( records[ 0 ].after_state ).cutover;
		expect( recorded.reference ).toMatch( /^backfill-verification:/ );
		expect( recorded.backup_confirmed_at ).toBeTruthy();

		const { activation } = await cutover( 'facts' );
		expect( activation.audit_id ).toBe( Number( records[ 0 ].id ) );
		expect( activation.user_id ).toBe( Number( records[ 0 ].user_id ) );

		const again = await activate();
		expect( again.status() ).toBe( 409 );
		expect( ( await again.json() ).code ).toBe( 'cutover_active' );
		expect( ( await cutover( 'audit' ) ).records ).toHaveLength( 1 );
	} );

	test( 'a later verification failure is reported, never reverted', async () => {
		await cutover( 'status', { status: 'verification_failed' } );

		const current = await status();
		expect( current.verified ).toBe( false );
		expect( current.ownership_cutover ).toBe( true );
		expect( current.cutover.active ).toBe( true );
		expect( current.cutover.issues ).toContain( 'verification_failed' );

		await cutover( 'status', { status: 'verified' } );
	} );

	test( 'deactivating and reactivating Fair Audience keeps the activation', async () => {
		await wpEnv( [ 'wp', 'plugin', 'deactivate', 'fair-audience' ] );
		audienceDeactivated = true;

		const without = await cutover( 'facts' );
		expect( without.cutover ).toBe( true );
		expect( without.facts.audience_lifecycle ).toBe( true );

		await wpEnv( [ 'wp', 'plugin', 'activate', 'fair-audience' ] );
		audienceDeactivated = false;

		const after = await status();
		expect( after.ownership_cutover ).toBe( true );
		expect( after.cutover.issues ).toEqual( [] );
	} );
} );
