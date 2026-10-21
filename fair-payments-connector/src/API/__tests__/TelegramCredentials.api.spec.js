/**
 * Telegram bot token encrypted at rest (#1319), against a live WordPress.
 *
 * e2e/mu-plugins/fair-e2e-protected-credentials.php seeds the stored token
 * raw, toggles encryption support and records the bot token each Telegram
 * request carried; lib/telegram-http-double.php answers those requests.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CONTROL = '/wp-json/fair-e2e/v1/protected-credentials';
const CREDENTIALS = '/wp-json/fair-payments-connector/v1/telegram/credentials';
const NOTIFICATION_TEST =
	'/wp-json/fair-payments-connector/v1/notifications/test';
const TELEGRAM_TEST = '/wp-json/fair-payments-connector/v1/telegram/test';
const SETTINGS = '/wp-json/wp/v2/settings';

const TOKEN_KEY = 'fair_payment_telegram_bot_token';
const ROUTES_KEY = 'fair_payment_notification_routes';
const ENVELOPE = /^fes-enc:v1:/;

function adminAuth() {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASS }` ).toString(
				'base64'
			),
	};
}

test.describe.configure( { mode: 'serial' } );

test.describe( 'Telegram bot token encrypted at rest (#1319)', () => {
	let api;
	let saved;

	async function control( data ) {
		const res = await api.post( CONTROL, { headers: adminAuth(), data } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function stored() {
		const res = await api.get( CONTROL, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function credentials() {
		const res = await api.get( CREDENTIALS, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function settings() {
		const res = await api.get( SETTINGS, { headers: adminAuth() } );
		expect( res.status() ).toBe( 200 );
		return res.json();
	}

	function saveSettings( data ) {
		return api.post( SETTINGS, { headers: adminAuth(), data } );
	}

	function sendTest() {
		return api.post( NOTIFICATION_TEST, {
			headers: adminAuth(),
			data: { channel: 'telegram', destination: '1319' },
		} );
	}

	function telegramTokens( after ) {
		return after.requests
			.filter( ( r ) => r.service === 'telegram' )
			.map( ( r ) => r.token );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const current = await settings();
		saved = { [ ROUTES_KEY ]: current[ ROUTES_KEY ] };
		await control( { supported: true, reset_requests: true } );
		// No Telegram route at all: conversion must not depend on one.
		const res = await saveSettings( { [ ROUTES_KEY ]: [] } );
		expect( res.status() ).toBe( 200 );
	} );

	test.afterAll( async () => {
		await control( {
			supported: true,
			reset_requests: true,
			telegram: { delete: true },
		} );
		await saveSettings( saved );
		await api.dispose();
	} );

	test( 'the credential status is for administrators only', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymous.get( CREDENTIALS );
		expect( res.status() ).toBe( 401 );
		await anonymous.dispose();
	} );

	test( 'reports a missing token', async () => {
		await control( { telegram: { delete: true } } );

		expect( await credentials() ).toEqual( {
			credential_status: 'missing',
			credentials_encrypted: false,
			message: '',
		} );
	} );

	test( 'converts a plaintext token on upgrade, with no Telegram route configured', async () => {
		await control( { telegram: { plaintext: '1319:telegram_plain' } } );

		// The conversion runs on the next request's init.
		const after = await stored();
		expect( after.telegram_converted ).toBe( true );
		expect( after.telegram ).toMatch( ENVELOPE );
		expect( after.telegram ).not.toContain( 'telegram_plain' );
		expect( after.telegram_decrypted ).toBe( '1319:telegram_plain' );

		expect( await credentials() ).toEqual( {
			credential_status: 'available',
			credentials_encrypted: true,
			message: '',
		} );
	} );

	test( 'the settings screen reads the decrypted token back, and saves new ones encrypted', async () => {
		expect( ( await settings() )[ TOKEN_KEY ] ).toBe(
			'1319:telegram_plain'
		);

		const res = await saveSettings( {
			[ TOKEN_KEY ]: '1319:telegram_new',
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await res.json() )[ TOKEN_KEY ] ).toBe( '1319:telegram_new' );

		const after = await stored();
		expect( after.telegram ).toMatch( ENVELOPE );
		expect( after.telegram_decrypted ).toBe( '1319:telegram_new' );
		expect( ( await settings() )[ TOKEN_KEY ] ).toBe( '1319:telegram_new' );
	} );

	test( 'the token is readable only by administrators', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		const res = await anonymous.get( SETTINGS );
		expect( res.status() ).toBe( 401 );
		expect( await res.text() ).not.toContain( 'telegram_new' );
		await anonymous.dispose();
	} );

	test( 'notifications are sent with the decrypted token', async () => {
		await control( { reset_requests: true } );

		const res = await sendTest();
		expect( res.status(), await res.text() ).toBe( 200 );

		const legacy = await api.post( TELEGRAM_TEST, {
			headers: adminAuth(),
			data: { chat_ids: '1319' },
		} );
		expect( legacy.status(), await legacy.text() ).toBe( 200 );

		expect( telegramTokens( await stored() ) ).toEqual( [
			'1319:telegram_new',
			'1319:telegram_new',
		] );
	} );

	test( 'a token from changed security keys pauses notifications and is left in place', async () => {
		const { telegram: envelope } = await control( {
			telegram: { foreign_key: '1319:telegram_foreign' },
			reset_requests: true,
		} );

		expect( await credentials() ).toMatchObject( {
			credential_status: 'unrecoverable',
			credentials_encrypted: true,
			message: expect.stringContaining(
				'the stored bot token can no longer be read'
			),
		} );
		expect( ( await settings() )[ TOKEN_KEY ] ).toBe( '' );

		for ( const res of [
			await sendTest(),
			await api.post( TELEGRAM_TEST, {
				headers: adminAuth(),
				data: { chat_ids: '1319' },
			} ),
		] ) {
			expect( res.status() ).toBe( 409 );
			expect( ( await res.json() ).code ).toBe(
				'fair_payment_telegram_credentials_unavailable'
			);
		}

		// Saving the routes alone, or the empty value the screen read back,
		// keeps the unreadable token.
		const routes = await saveSettings( { [ ROUTES_KEY ]: [] } );
		expect( routes.status(), await routes.text() ).toBe( 200 );
		const empty = await saveSettings( { [ TOKEN_KEY ]: '' } );
		expect( empty.status(), await empty.text() ).toBe( 200 );

		const after = await stored();
		expect( telegramTokens( after ) ).toEqual( [] );
		expect( after.telegram ).toBe( envelope );
		expect( after.telegram_status ).toBe( 'unrecoverable' );
	} );

	test( 'entering the token again replaces an unrecoverable one', async () => {
		const res = await saveSettings( {
			[ TOKEN_KEY ]: '1319:telegram_reentered',
		} );
		expect( res.status(), await res.text() ).toBe( 200 );

		const after = await stored();
		expect( after.telegram ).toMatch( ENVELOPE );
		expect( after.telegram_decrypted ).toBe( '1319:telegram_reentered' );
		expect( ( await credentials() ).credential_status ).toBe( 'available' );
	} );

	test( 'losing encryption support pauses notifications until it returns', async () => {
		const { telegram: envelope } = await control( {
			supported: false,
			reset_requests: true,
		} );

		expect( await credentials() ).toMatchObject( {
			credential_status: 'encryption_unavailable',
			message: expect.stringContaining( 'restore PHP Sodium support' ),
		} );
		expect( ( await sendTest() ).status() ).toBe( 409 );

		// A replacement would have to be stored as plaintext: refused, and
		// nothing else in the request is written.
		const replaced = await saveSettings( {
			[ TOKEN_KEY ]: '1319:telegram_plain_replacement',
			[ ROUTES_KEY ]: [
				{
					id: 'api-spec-1319',
					enabled: true,
					channel: 'telegram',
					destination: '1319',
					frequency: 'immediate',
					include_pii: false,
				},
			],
		} );
		expect( replaced.status() ).toBe( 409 );
		expect( ( await replaced.json() ).code ).toBe(
			'fair_payment_telegram_token_not_stored'
		);
		expect( ( await settings() )[ ROUTES_KEY ] ).toEqual( [] );

		const after = await stored();
		expect( after.telegram ).toBe( envelope );
		expect( after.telegram_status ).toBe( 'unsupported' );
		expect( telegramTokens( after ) ).toEqual( [] );

		await control( { supported: true } );
		expect( ( await credentials() ).credential_status ).toBe( 'available' );
		expect( ( await sendTest() ).status() ).toBe( 200 );
		expect( telegramTokens( await stored() ) ).toEqual( [
			'1319:telegram_reentered',
		] );
	} );

	test( 'without encryption support a plaintext token keeps working, and converts once support returns', async () => {
		await control( {
			supported: false,
			reset_requests: true,
			telegram: { plaintext: '1319:telegram_unsupported' },
		} );

		const deferred = await stored();
		expect( deferred.telegram ).toBe( '1319:telegram_unsupported' );
		expect( deferred.telegram_converted ).toBe( false );
		expect( ( await sendTest() ).status() ).toBe( 200 );
		expect( telegramTokens( await stored() ) ).toEqual( [
			'1319:telegram_unsupported',
		] );

		await control( { supported: true } );

		const converted = await stored();
		expect( converted.telegram ).toMatch( ENVELOPE );
		expect( converted.telegram_decrypted ).toBe(
			'1319:telegram_unsupported'
		);
		expect( converted.telegram_converted ).toBe( true );
	} );
} );
