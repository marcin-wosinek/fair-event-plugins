/**
 * Mollie credentials encrypted at rest (#1318), against a live WordPress.
 *
 * e2e/mu-plugins/fair-e2e-mollie-credentials.php switches the connector to
 * its stored tokens, toggles encryption support, stands in for the token
 * refresh service, and reads the raw stored option values.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const CONTROL = '/wp-json/fair-e2e/v1/mollie-credentials';
const STATUS = '/wp-json/fair-payments-connector/v1/oauth/status';
const STATE = '/wp-json/fair-payments-connector/v1/oauth/state';
const CALLBACK = '/wp-json/fair-payments-connector/v1/oauth/callback';
const TEST_PAYMENT = '/wp-json/fair-payments-connector/v1/test-payment';
const NONCE = '/wp-json/fair-payments-connector/v1/nonce';
const PAYMENTS = '/wp-json/fair-payments-connector/v1/payments';
const WEBHOOK = '/wp-json/fair-payments-connector/v1/webhook';
const TRANSACTIONS = '/wp-json/fair-payments-connector/v1/transactions';
const SETTINGS = '/wp-json/wp/v2/settings';

const ENVELOPE = /^fes-enc:v1:/;
const HOUR = 3600;

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

test.describe( 'Mollie credentials encrypted at rest (#1318)', () => {
	let api;
	let visitor;
	let page;

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

	async function status() {
		const res = await api.get( STATUS, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	}

	async function visitorCheckout() {
		const { nonce } = await ( await visitor.get( NONCE ) ).json();
		return visitor.post( PAYMENTS, {
			data: {
				amount: '7.50',
				post_id: page.page_id,
				block_id: page.block_id,
				nonce,
			},
		} );
	}

	async function transactionCount() {
		const res = await api.get( TRANSACTIONS, {
			headers: adminAuth(),
			params: { per_page: 1 },
		} );
		return ( await res.json() ).total;
	}

	async function reconnect( tokens ) {
		const { state } = await (
			await api.post( STATE, { headers: adminAuth() } )
		).json();
		return api.post( CALLBACK, {
			headers: adminAuth(),
			data: {
				state,
				expires_in: HOUR,
				organization_id: 'org_e2e_1318',
				profile_id: 'pfl_e2e0000000',
				test_mode: true,
				...tokens,
			},
		} );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		visitor = await request.newContext( { baseURL: BASE_URL } );
		page = await control( {
			stored: true,
			supported: true,
			reset_refresh_requests: true,
			mollie_get_status: 'paid',
			payment_page: true,
		} );
	} );

	test.afterAll( async () => {
		await control( {
			stored: false,
			supported: true,
			reset_refresh_requests: true,
			mollie_get_status: '',
			delete_page: page.page_id,
		} );
		await api.dispose();
		await visitor.dispose();
	} );

	test( 'converts plaintext credentials on upgrade without reconnecting', async () => {
		await control( {
			plaintext: {
				access_token: 'access_e2e_plain',
				refresh_token: 'refresh_e2e_plain',
			},
			expires: HOUR,
		} );

		// The conversion runs on the next request's init.
		const after = await stored();
		expect( after.converted ).toBe( true );
		expect( after.access_token ).toMatch( ENVELOPE );
		expect( after.refresh_token ).toMatch( ENVELOPE );
		expect( after.access_token ).not.toContain( 'access_e2e_plain' );
		expect( after.access_token_decrypted ).toBe( 'access_e2e_plain' );
		expect( after.refresh_token_decrypted ).toBe( 'refresh_e2e_plain' );

		const current = await status();
		expect( current ).toMatchObject( {
			connected: true,
			credential_status: 'available',
			credentials_encrypted: true,
			payments_available: true,
		} );
	} );

	test( 'a visitor checkout refreshes the expired token and stores the rotated pair encrypted', async () => {
		await control( { expires: -HOUR, reset_refresh_requests: true } );

		const res = await visitorCheckout();
		expect( res.status(), await res.text() ).toBe( 201 );
		expect( ( await res.json() ).checkout_url ).toBeTruthy();

		const after = await stored();
		// The refresh service received the plaintext refresh token.
		expect( after.refresh_requests ).toEqual( [ 'refresh_e2e_plain' ] );
		expect( after.access_token ).toMatch( ENVELOPE );
		expect( after.refresh_token ).toMatch( ENVELOPE );
		expect( after.access_token_decrypted ).toBe( 'access_e2e_refreshed_1' );
		expect( after.refresh_token_decrypted ).toBe( 'refresh_e2e_rotated_1' );
	} );

	test( 'a test payment completes with encrypted credentials', async () => {
		const res = await api.post( TEST_PAYMENT, { headers: adminAuth() } );
		expect( res.status(), await res.text() ).toBe( 201 );
		const { transaction_id: transactionId } = await res.json();

		const created = await (
			await api.get( `${ TRANSACTIONS }/${ transactionId }`, {
				headers: adminAuth(),
			} )
		).json();
		// The HTTP double reports the payment as paid.
		const hook = await api.post( WEBHOOK, {
			data: { id: created.mollie_payment_id },
		} );
		expect( hook.status(), await hook.text() ).toBe( 200 );

		const paid = await (
			await api.get( `${ TRANSACTIONS }/${ transactionId }`, {
				headers: adminAuth(),
			} )
		).json();
		expect( paid.status ).toBe( 'paid' );
	} );

	test( 'REST settings and status never expose the tokens', async () => {
		const raw = await stored();

		for ( const path of [ SETTINGS, STATUS ] ) {
			const res = await api.get( path, { headers: adminAuth() } );
			expect( res.status() ).toBe( 200 );
			const text = await res.text();
			expect( text ).not.toContain( 'fair_payment_mollie_access_token' );
			expect( text ).not.toContain( 'fair_payment_mollie_refresh_token' );
			expect( text ).not.toContain( 'fes-enc:' );
			expect( text ).not.toContain( raw.access_token_decrypted );
			expect( text ).not.toContain( raw.refresh_token_decrypted );
		}
	} );

	test( 'losing encryption support pauses payments and preserves the stored credentials', async () => {
		const before = await stored();
		await control( { supported: false, reset_refresh_requests: true } );

		expect( await status() ).toMatchObject( {
			connected: true,
			credential_status: 'encryption_unavailable',
			payments_available: false,
		} );

		const transactions = await transactionCount();
		const testPayment = await api.post( TEST_PAYMENT, {
			headers: adminAuth(),
		} );
		expect( testPayment.status() ).toBe( 409 );
		expect( ( await testPayment.json() ).code ).toBe(
			'mollie_credentials_unavailable'
		);

		const checkout = await visitorCheckout();
		expect( checkout.status() ).toBe( 503 );
		const body = await checkout.json();
		expect( body.code ).toBe( 'payments_unavailable' );
		expect( body.message ).not.toMatch( /sodium|encrypt/i );
		expect( await transactionCount() ).toBe( transactions );

		// Reconnecting would store plaintext over the encrypted tokens.
		const replaced = await reconnect( {
			access_token: 'access_e2e_plaintext_attempt',
			refresh_token: 'refresh_e2e_plaintext_attempt',
		} );
		expect( replaced.status() ).toBe( 409 );
		expect( ( await replaced.json() ).code ).toBe(
			'mollie_credentials_locked'
		);

		const after = await stored();
		expect( after.access_token ).toBe( before.access_token );
		expect( after.refresh_token ).toBe( before.refresh_token );
		expect( after.access_token_status ).toBe( 'unsupported' );
		expect( after.refresh_requests ).toEqual( [] );
	} );

	test( 'restoring encryption support recovers the connection without reconnecting', async () => {
		await control( { supported: true } );

		expect( await status() ).toMatchObject( {
			connected: true,
			credential_status: 'available',
			payments_available: true,
		} );
		const res = await visitorCheckout();
		expect( res.status(), await res.text() ).toBe( 201 );
	} );

	test( 'changed security keys report a disconnected state and leave the value in place until a reconnect', async () => {
		const { access_token: foreign } = await control( {
			foreign_key: true,
			reset_refresh_requests: true,
		} );

		expect( await status() ).toMatchObject( {
			connected: true,
			credential_status: 'unrecoverable',
			payments_available: false,
		} );
		const checkout = await visitorCheckout();
		expect( checkout.status() ).toBe( 503 );
		expect( ( await checkout.json() ).code ).toBe( 'payments_unavailable' );

		const unchanged = await stored();
		expect( unchanged.access_token ).toBe( foreign );
		expect( unchanged.access_token_status ).toBe( 'unrecoverable' );
		expect( unchanged.refresh_requests ).toEqual( [] );

		const res = await reconnect( {
			access_token: 'access_e2e_reconnected',
			refresh_token: 'refresh_e2e_reconnected',
		} );
		expect( res.status(), await res.text() ).toBe( 200 );

		const reconnected = await stored();
		expect( reconnected.access_token ).toMatch( ENVELOPE );
		expect( reconnected.access_token_decrypted ).toBe(
			'access_e2e_reconnected'
		);
		expect( ( await status() ).credential_status ).toBe( 'available' );
	} );

	test( 'without encryption support, plaintext credentials keep working and are converted once support returns', async () => {
		await control( {
			supported: false,
			plaintext: {
				access_token: 'access_e2e_plain_2',
				refresh_token: 'refresh_e2e_plain_2',
			},
			expires: -HOUR,
			reset_refresh_requests: true,
		} );

		const deferred = await stored();
		expect( deferred.converted ).toBe( false );
		expect( deferred.access_token ).toBe( 'access_e2e_plain_2' );
		expect( ( await status() ).credential_status ).toBe( 'available' );

		// Connects, refreshes and pays; the rotated tokens stay plaintext.
		const res = await visitorCheckout();
		expect( res.status(), await res.text() ).toBe( 201 );
		const refreshed = await stored();
		expect( refreshed.refresh_requests ).toEqual( [
			'refresh_e2e_plain_2',
		] );
		expect( refreshed.access_token ).toBe( 'access_e2e_refreshed_1' );
		expect( refreshed.refresh_token ).toBe( 'refresh_e2e_rotated_1' );

		await control( { supported: true } );

		const converted = await stored();
		expect( converted.converted ).toBe( true );
		expect( converted.access_token ).toMatch( ENVELOPE );
		expect( converted.refresh_token ).toMatch( ENVELOPE );
		expect( converted.access_token_decrypted ).toBe(
			'access_e2e_refreshed_1'
		);
	} );
} );
