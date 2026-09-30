import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ENDPOINT = '/wp-json/fair-payments-connector/v1/notifications/test';
const LEGACY_TELEGRAM_ENDPOINT =
	'/wp-json/fair-payments-connector/v1/telegram/test';
const SETTINGS = '/wp-json/wp/v2/settings';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminAuth = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

test.describe( 'NotificationsController — /notifications/test', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	test( 'POST without auth returns 401', async () => {
		const res = await api.post( ENDPOINT, {
			data: { channel: 'email', destination: 'test@example.com' },
		} );
		expect( res.status() ).toBe( 401 );
	} );

	test( 'POST without required channel returns 400', async () => {
		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: { destination: 'test@example.com' },
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'POST without required destination returns 400', async () => {
		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: { channel: 'email' },
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'POST with invalid channel enum returns 400', async () => {
		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: { channel: 'sms', destination: 'test@example.com' },
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'POST telegram without bot token returns 400', async () => {
		// Ensure no bot token is set by using a fresh test site state.
		// If a bot token is set in the environment this test may behave differently.
		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: { channel: 'telegram', destination: '12345' },
		} );
		// 400 when bot token missing, 502 when token present but Telegram API fails.
		expect( [ 400, 502 ] ).toContain( res.status() );
	} );

	test( 'POST email channel returns 200 or 502 (depending on mail config)', async () => {
		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: {
				channel: 'email',
				destination: 'test@example.com',
				include_pii: false,
			},
		} );
		// wp_mail() may not be configured in the test environment — both outcomes
		// are acceptable here; the important check is the route exists and
		// returns a structured response.
		expect( [ 200, 502 ] ).toContain( res.status() );
		if ( res.status() === 200 ) {
			const body = await res.json();
			expect( body ).toHaveProperty( 'success', true );
			expect( body ).toHaveProperty( 'channel', 'email' );
			expect( body ).toHaveProperty( 'text' );
			// The personal-information preference reaches the sample message.
			expect( body.text ).toContain( 'Sample P.' );
			expect( body.text ).not.toContain( 'sample@example.com' );
		}
	} );
} );

test.describe( 'Notification settings and legacy Telegram route', () => {
	let api;
	let saved;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.get( SETTINGS, { headers: adminAuth } );
		const settings = await res.json();
		saved = {
			fair_payment_telegram_bot_token:
				settings.fair_payment_telegram_bot_token,
			fair_payment_notification_routes:
				settings.fair_payment_notification_routes,
		};
	} );

	test.afterAll( async () => {
		await api.post( SETTINGS, { headers: adminAuth, data: saved } );
		await api.dispose();
	} );

	test( 'routes round-trip through /wp/v2/settings with every field kept', async () => {
		const routes = [
			{
				id: 'api-spec-telegram',
				enabled: false,
				channel: 'telegram',
				destination: '12345',
				frequency: 'weekly',
				include_pii: false,
			},
			{
				id: 'api-spec-email',
				enabled: true,
				channel: 'email',
				destination: 'owner@example.com',
				frequency: 'hourly',
				include_pii: true,
			},
		];

		const res = await api.post( SETTINGS, {
			headers: adminAuth,
			data: {
				fair_payment_telegram_bot_token: 'api-spec-token',
				fair_payment_notification_routes: routes,
			},
		} );
		expect( res.status() ).toBe( 200 );

		const read = await (
			await api.get( SETTINGS, { headers: adminAuth } )
		).json();
		expect( read.fair_payment_telegram_bot_token ).toBe( 'api-spec-token' );
		expect( read.fair_payment_notification_routes ).toEqual( routes );
	} );

	test( 'invalid routes are dropped on save', async () => {
		const res = await api.post( SETTINGS, {
			headers: adminAuth,
			data: {
				fair_payment_notification_routes: [
					{
						id: 'api-spec-bad-email',
						enabled: true,
						channel: 'email',
						destination: 'not-an-email',
						frequency: 'daily',
						include_pii: true,
					},
				],
			},
		} );
		expect( res.status() ).toBe( 200 );
		expect( ( await res.json() ).fair_payment_notification_routes ).toEqual(
			[]
		);
	} );

	test( 'telegram test reports a missing bot token', async () => {
		await api.post( SETTINGS, {
			headers: adminAuth,
			data: { fair_payment_telegram_bot_token: '' },
		} );

		const res = await api.post( ENDPOINT, {
			headers: adminAuth,
			data: { channel: 'telegram', destination: '12345' },
		} );
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe(
			'fair_payment_telegram_missing_token'
		);
	} );

	test( 'legacy /telegram/test route still validates its input', async () => {
		const unauthenticated = await api.post( LEGACY_TELEGRAM_ENDPOINT, {
			data: { bot_token: 'x', chat_ids: '1' },
		} );
		expect( unauthenticated.status() ).toBe( 401 );

		const missingToken = await api.post( LEGACY_TELEGRAM_ENDPOINT, {
			headers: adminAuth,
			data: { chat_ids: '12345' },
		} );
		expect( missingToken.status() ).toBe( 400 );
		expect( ( await missingToken.json() ).code ).toBe(
			'fair_payment_telegram_missing_token'
		);
	} );

	test( 'non-administrators cannot send tests or read notification settings', async () => {
		const login = `notif1657-${ Date.now() }`;
		const password = 'Test-password-1657!';
		const created = await api.post( '/wp-json/wp/v2/users', {
			headers: adminAuth,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password,
				roles: [ 'editor' ],
			},
		} );
		expect( created.ok() ).toBeTruthy();
		const userId = ( await created.json() ).id;
		const editorAuth = basicAuth( login, password );

		try {
			const testRes = await api.post( ENDPOINT, {
				headers: editorAuth,
				data: { channel: 'email', destination: 'test@example.com' },
			} );
			expect( testRes.status() ).toBe( 403 );

			const legacyRes = await api.post( LEGACY_TELEGRAM_ENDPOINT, {
				headers: editorAuth,
				data: { bot_token: 'x', chat_ids: '1' },
			} );
			expect( legacyRes.status() ).toBe( 403 );

			const settingsRes = await api.get( SETTINGS, {
				headers: editorAuth,
			} );
			expect( settingsRes.status() ).toBe( 403 );
		} finally {
			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers: adminAuth }
			);
		}
	} );
} );
