/**
 * Playwright API tests for the WhatsApp webhook (#1924): verification
 * challenges, signature checks on the exact raw body, account and number
 * matching, duplicate, out-of-order, concurrent and early callbacks,
 * delivery transitions, incoming-message dispatch, the webhook credentials
 * route and the delivery history.
 *
 * Nothing reaches Meta: e2e/mu-plugins/lib/whatsapp-http-double.php answers
 * the test sends, logs each send's message ID, and records the incoming
 * messages the plugin dispatches. Callbacks are signed here with the App
 * Secret the suite saves.
 *
 * The suite removes its token, IDs, credentials, delivery rows and the
 * double's options afterwards.
 */

import { test, expect, request } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events-experimental/v1/whatsapp';
const WEBHOOK = `${ PATH }/webhook`;
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const TOKEN_OPTION = 'fair_events_experimental_whatsapp_access_token';
const TOKEN = 'e2e-whatsapp-webhook-token-0123456789';
const SECRET = '0123456789abcdef0123456789abcdef';
const OTHER_SECRET = 'fedcba9876543210fedcba9876543210';
const VERIFY_TOKEN = 'e2e-verify-token-1924';
const WABA = '100000000000001';
const PHONE = '200000000000002';

const OPTIONS = [
	'fair_events_experimental_whatsapp_validation',
	'fair_events_experimental_whatsapp_webhook',
	'fair_events_experimental_whatsapp_app_secret',
	'fair_events_experimental_whatsapp_verify_token',
	'fair_e2e_whatsapp_requests',
	'fair_e2e_whatsapp_response',
	'fair_e2e_whatsapp_message_id',
	'fair_e2e_whatsapp_incoming',
];

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
 * @return {Promise<string>} Output.
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
 * A JSON option of the tests site, or a fallback.
 *
 * @param {string} name     Option name.
 * @param {*}      fallback Value when the option is missing.
 * @return {Promise<*>} Decoded option.
 */
async function jsonOption( name, fallback ) {
	const out = await wp( 'option', 'get', name, '--format=json' ).catch(
		() => ''
	);
	const start = out.search( /[[{]/ );
	return start < 0 ? fallback : JSON.parse( out.slice( start ) );
}

/** Message ID of the last test send the double answered. */
async function lastMessageId() {
	const sends = (
		await jsonOption( 'fair_e2e_whatsapp_requests', [] )
	).filter( ( entry ) => 'POST' === entry.method );
	return sends[ sends.length - 1 ].message_id;
}

async function deleteOptions() {
	await wp( 'option', 'delete', ...OPTIONS ).catch( () => {} );
}

async function emptyTables() {
	await wp(
		'eval',
		'global $wpdb; foreach ( array( "fair_events_whatsapp_deliveries", "fair_events_whatsapp_unmatched" ) as $t ) { $wpdb->query( "DELETE FROM {$wpdb->prefix}$t" ); }'
	);
}

/**
 * A callback body with a `messages` change for the given account and number.
 *
 * @param {Object} value        Change value without metadata.
 * @param {Object} target       Account and number.
 * @param {string} target.waba  WhatsApp Business Account ID.
 * @param {string} target.phone Phone Number ID.
 * @return {string} Raw JSON body.
 */
function callback( value, { waba = WABA, phone = PHONE } = {} ) {
	return JSON.stringify( {
		object: 'whatsapp_business_account',
		entry: [
			{
				id: waba,
				changes: [
					{
						field: 'messages',
						value: {
							messaging_product: 'whatsapp',
							metadata: {
								display_phone_number: '34600000002',
								phone_number_id: phone,
							},
							...value,
						},
					},
				],
			},
		],
	} );
}

function statuses( ...items ) {
	return callback( {
		statuses: items.map( ( [ id, status, timestamp, code ] ) => ( {
			id,
			status,
			timestamp: String( timestamp ),
			recipient_id: '34600000123',
			...( code
				? { errors: [ { code, title: 'secret-should-not-leak' } ] }
				: {} ),
		} ) ),
	} );
}

function sign( raw, secret = SECRET ) {
	return (
		'sha256=' + createHmac( 'sha256', secret ).update( raw ).digest( 'hex' )
	);
}

test.describe( 'WhatsApp webhook', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let subscriberId;
	let subscriberHeaders;

	const post = ( raw, signature = sign( raw ) ) =>
		api.post( WEBHOOK, {
			headers: {
				'Content-Type': 'application/json',
				...( signature ? { 'X-Hub-Signature-256': signature } : {} ),
			},
			data: raw,
		} );
	const settings = async () =>
		( await api.get( PATH, { headers: adminHeaders } ) ).json();
	const history = async () =>
		(
			await api.get( `${ PATH }/deliveries`, { headers: adminHeaders } )
		).json();
	const saveCredentials = ( data ) =>
		api.post( `${ PATH }/webhook-credentials`, {
			headers: adminHeaders,
			data,
		} );
	const sendTest = () =>
		api.post( `${ PATH }/test`, {
			headers: adminHeaders,
			data: {
				recipient: '+34 600 000 123',
				template_name: 'hello_world',
				template_language: 'en_US',
				authorized: true,
			},
		} );
	/** Send a test template and return its message ID. */
	const sendAndId = async () => {
		const res = await sendTest();
		expect( res.status() ).toBe( 200 );
		return lastMessageId();
	};
	const outcomeOf = async ( deliveryIndex = 0 ) =>
		( await history() ).items[ deliveryIndex ];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const userLogin = `whatsapp-webhook-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1924!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1924!` ).toString(
					'base64'
				),
		};

		await deleteOptions();
		await emptyTables();
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: TOKEN },
		} );
		await api.post( PATH, {
			headers: adminHeaders,
			data: { waba_id: WABA, phone_number_id: PHONE },
		} );
		expect(
			(
				await api.post( `${ PATH }/validate`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 200 );
	} );

	test.afterAll( async () => {
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { [ TOKEN_OPTION ]: '' },
		} );
		await api.post( PATH, {
			headers: adminHeaders,
			data: { waba_id: '', phone_number_id: '' },
		} );
		await deleteOptions();
		await emptyTables();
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'credentials and history are for administrators only', async () => {
		for ( const [ method, path ] of [
			[ 'get', `${ PATH }/deliveries` ],
			[ 'post', `${ PATH }/webhook-credentials` ],
		] ) {
			expect(
				(
					await api[ method ]( path, { headers: subscriberHeaders } )
				).status()
			).toBe( 403 );
			expect( ( await api[ method ]( path ) ).status() ).toBe( 401 );
		}
	} );

	test( 'a callback is refused while no App Secret is saved', async () => {
		const res = await post( statuses( [ 'wamid.none', 'delivered', 1 ] ) );
		expect( res.status() ).toBe( 503 );
	} );

	test( 'saves credentials without ever returning them', async () => {
		const invalid = await saveCredentials( { app_secret: 'not hex!' } );
		expect( invalid.status() ).toBe( 400 );
		expect( await invalid.text() ).not.toContain( 'not hex!' );
		expect( ( await saveCredentials( {} ) ).status() ).toBe( 400 );

		const res = await saveCredentials( {
			app_secret: SECRET,
			verify_token: VERIFY_TOKEN,
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.text();
		expect( body ).not.toContain( SECRET );
		expect( body ).not.toContain( VERIFY_TOKEN );

		const { webhook } = JSON.parse( body );
		expect( webhook ).toMatchObject( {
			app_secret: { configured: true, source: 'database' },
			verify_token: { configured: true, source: 'database' },
			verified_at_local: null,
			received_at_local: null,
		} );
		expect( webhook.callback_url ).toContain(
			'fair-events-experimental/v1/whatsapp/webhook'
		);
	} );

	test( 'answers the verification challenge only for the verify token', async () => {
		const challenge = ( params ) =>
			api.get( `${ WEBHOOK }?${ new URLSearchParams( params ) }` );

		for ( const params of [
			{
				'hub.mode': 'subscribe',
				'hub.verify_token': 'wrong-token-123',
				'hub.challenge': '42',
			},
			{
				'hub.mode': 'unsubscribe',
				'hub.verify_token': VERIFY_TOKEN,
				'hub.challenge': '42',
			},
			{
				'hub.mode': 'subscribe',
				'hub.verify_token': VERIFY_TOKEN,
				'hub.challenge': '<script>',
			},
			{ 'hub.mode': 'subscribe', 'hub.challenge': '42' },
		] ) {
			const res = await challenge( params );
			expect( res.status() ).toBe( 403 );
			expect( await res.text() ).not.toContain( '<script>' );
		}
		expect( ( await settings() ).webhook.verified_at_local ).toBeNull();

		const ok = await challenge( {
			'hub.mode': 'subscribe',
			'hub.verify_token': VERIFY_TOKEN,
			'hub.challenge': '1158201444',
		} );
		expect( ok.status() ).toBe( 200 );
		expect( ok.headers()[ 'content-type' ] ).toContain( 'text/plain' );
		expect( await ok.text() ).toBe( '1158201444' );

		const { webhook } = await settings();
		expect( webhook.verified_at_local ).toBeTruthy();
		// Verification is not proof that updates arrive.
		expect( webhook.received_at_local ).toBeNull();
	} );

	test( 'unsigned, wrongly signed and altered callbacks change nothing', async () => {
		const id = await sendAndId();
		const raw = statuses( [ id, 'delivered', 1793000000 ] );

		expect( ( await post( raw, null ) ).status() ).toBe( 401 );
		expect(
			( await post( raw, sign( raw, OTHER_SECRET ) ) ).status()
		).toBe( 401 );
		expect( ( await post( raw, 'sha256=nothex' ) ).status() ).toBe( 401 );
		// Signed body differs from the one sent, by one space.
		expect( ( await post( raw, sign( raw + ' ' ) ) ).status() ).toBe( 401 );

		expect( await outcomeOf() ).toMatchObject( {
			outcome: 'accepted',
			pending: true,
			recipient: '••••••••123',
			template: { name: 'hello_world', language: 'en_US' },
		} );
		expect( ( await settings() ).webhook.received_at_local ).toBeNull();
	} );

	test( 'callbacks for another account or number change nothing', async () => {
		const id = await lastMessageId();
		for ( const target of [
			{ waba: '999999999999999' },
			{ phone: '300000000000003' },
		] ) {
			const raw = callback(
				{
					statuses: [
						{ id, status: 'delivered', timestamp: '1793000000' },
					],
				},
				target
			);
			const res = await post( raw );
			expect( res.status() ).toBe( 200 );
			expect( await res.json() ).toEqual( { matched: 0, ignored: 1 } );
		}

		expect( ( await outcomeOf() ).outcome ).toBe( 'accepted' );
		expect( ( await settings() ).webhook.received_at_local ).toBeNull();
	} );

	test( 'delivery updates advance and never regress', async () => {
		const id = await lastMessageId();

		const sent = await post( statuses( [ id, 'sent', 1793000000 ] ) );
		expect( sent.status() ).toBe( 200 );
		expect( await sent.json() ).toEqual( { matched: 1, ignored: 0 } );
		expect( ( await outcomeOf() ).outcome ).toBe( 'sent' );
		expect( ( await settings() ).webhook.received_at_local ).toBeTruthy();

		// One batch: delivered, then a late duplicate "sent".
		expect(
			(
				await post(
					statuses(
						[ id, 'delivered', 1793000010 ],
						[ id, 'sent', 1793000000 ]
					)
				)
			).status()
		).toBe( 200 );
		expect( await outcomeOf() ).toMatchObject( {
			outcome: 'delivered',
			pending: false,
		} );

		// A later failure keeps the confirmed delivery and its evidence.
		await post( statuses( [ id, 'failed', 1793000020, 131026 ] ) );
		const afterFailure = await outcomeOf();
		expect( afterFailure.outcome ).toBe( 'delivered' );
		expect( afterFailure.failure ).toMatchObject( { code: 131026 } );
		expect( afterFailure.failure.message ).toContain(
			'could not deliver to this number'
		);

		await post( statuses( [ id, 'read', 1793000030 ] ) );
		await post( statuses( [ id, 'delivered', 1793000010 ] ) );
		expect( ( await outcomeOf() ).outcome ).toBe( 'read' );

		const { items } = await history();
		expect( items ).toHaveLength( 1 );
		expect( JSON.stringify( items ) ).not.toContain(
			'secret-should-not-leak'
		);
		expect( JSON.stringify( items ) ).not.toContain( '34600000123' );
	} );

	test( 'a failure is explained, and a later delivery supersedes it', async () => {
		const id = await sendAndId();

		await post( statuses( [ id, 'failed', 1793000000, 131047 ] ) );
		const failed = await outcomeOf();
		expect( failed ).toMatchObject( {
			outcome: 'failed',
			pending: false,
			failure: { code: 131047 },
		} );
		expect( failed.failure.message ).toContain( '24 hours' );

		// Repeating the failure with another code keeps the first.
		await post( statuses( [ id, 'failed', 1793000001, 131026 ] ) );
		expect( ( await outcomeOf() ).failure.code ).toBe( 131047 );

		// An intermediate update does not hide the failure.
		await post( statuses( [ id, 'sent', 1793000002 ] ) );
		expect( ( await outcomeOf() ).outcome ).toBe( 'failed' );

		await post( statuses( [ id, 'delivered', 1793000003 ] ) );
		expect( await outcomeOf() ).toMatchObject( {
			outcome: 'delivered',
			failure: { code: 131047 },
		} );
	} );

	test( 'an unlisted failure code is not kept', async () => {
		const id = await sendAndId();
		await post( statuses( [ id, 'failed', 1793000000, 987654 ] ) );
		expect( await outcomeOf() ).toMatchObject( {
			outcome: 'failed',
			failure: { code: null },
		} );
	} );

	test( 'concurrent duplicate callbacks settle on the strongest update', async () => {
		const before = ( await history() ).items.length;
		const id = await sendAndId();
		const bodies = [];
		for ( let i = 0; i < 4; i++ ) {
			bodies.push(
				statuses( [ id, 'sent', 1793000000 ] ),
				statuses( [ id, 'delivered', 1793000010 ] ),
				statuses( [ id, 'read', 1793000020 ] )
			);
		}
		const responses = await Promise.all(
			bodies.map( ( raw ) => post( raw ) )
		);
		expect( responses.map( ( res ) => res.status() ) ).toEqual(
			bodies.map( () => 200 )
		);

		const { items } = await history();
		expect( items ).toHaveLength( before + 1 );
		expect( items[ 0 ].outcome ).toBe( 'read' );
	} );

	test( 'a callback that arrives before the send is stored is applied later', async () => {
		const id = `wamid.E2Eearly${ Date.now() }`;
		const early = await post(
			statuses(
				[ id, 'delivered', 1793000010 ],
				[ id, 'sent', 1793000000 ]
			)
		);
		expect( early.status() ).toBe( 200 );
		const before = ( await history() ).items.length;

		await wp( 'option', 'update', 'fair_e2e_whatsapp_message_id', id );
		try {
			expect( await sendAndId() ).toBe( id );
		} finally {
			await wp( 'option', 'delete', 'fair_e2e_whatsapp_message_id' );
		}

		const { items } = await history();
		expect( items ).toHaveLength( before + 1 );
		expect( items[ 0 ] ).toMatchObject( {
			outcome: 'delivered',
			pending: false,
		} );
		const waiting = await wp(
			'eval',
			'global $wpdb; echo (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->prefix}fair_events_whatsapp_unmatched" );'
		);
		expect( waiting.trim().split( '\n' ).pop() ).toBe( '0' );
	} );

	test( 'an uncertain send is recorded and never matched or retried', async () => {
		await wp(
			'option',
			'update',
			'fair_e2e_whatsapp_response',
			'{"transport":true}',
			'--format=json'
		);
		try {
			expect( ( await sendTest() ).status() ).toBe( 502 );
		} finally {
			await wp( 'option', 'delete', 'fair_e2e_whatsapp_response' );
		}
		expect( await outcomeOf() ).toMatchObject( {
			outcome: 'uncertain',
			pending: false,
		} );
	} );

	test( 'incoming messages reach the opt-out hook without replies', async () => {
		const sendsBefore = (
			await jsonOption( 'fair_e2e_whatsapp_requests', [] )
		).length;
		const raw = callback( {
			contacts: [ { profile: { name: 'Ana' }, wa_id: '34600000123' } ],
			messages: [
				{
					from: '34600000123',
					id: 'wamid.E2Eincoming1',
					timestamp: '1793000100',
					type: 'text',
					text: { body: 'STOP' },
				},
			],
		} );
		expect( ( await post( raw ) ).status() ).toBe( 200 );
		// Meta resends; the hook runs again and consumers deduplicate by ID.
		expect( ( await post( raw ) ).status() ).toBe( 200 );

		expect( await jsonOption( 'fair_e2e_whatsapp_incoming', [] ) ).toEqual(
			[
				{
					id: 'wamid.E2Eincoming1',
					from: '34600000123',
					timestamp: 1793000100,
					type: 'text',
					text: 'STOP',
					waba_id: WABA,
					phone_number_id: PHONE,
				},
				expect.objectContaining( { id: 'wamid.E2Eincoming1' } ),
			]
		);
		// Nothing was sent in reply.
		expect(
			( await jsonOption( 'fair_e2e_whatsapp_requests', [] ) ).length
		).toBe( sendsBefore );

		// Messages for another number are not dispatched.
		await post(
			callback(
				{
					messages: [
						{
							from: '34600000124',
							id: 'wamid.E2Eincoming2',
							type: 'text',
							text: { body: 'STOP' },
						},
					],
				},
				{ phone: '300000000000003' }
			)
		);
		expect(
			await jsonOption( 'fair_e2e_whatsapp_incoming', [] )
		).toHaveLength( 2 );
	} );

	test( 'a failing consumer makes Meta retry the callback', async () => {
		const res = await post(
			callback( {
				messages: [
					{
						from: '34600000123',
						id: 'wamid.E2Ethrow',
						type: 'text',
						text: { body: 'E2E_THROW' },
					},
				],
			} )
		);
		expect( res.status() ).toBe( 500 );
	} );

	test( 'another App Secret or verify token clears the indicators', async () => {
		let { webhook } = await settings();
		expect( webhook.verified_at_local ).toBeTruthy();
		expect( webhook.received_at_local ).toBeTruthy();

		await saveCredentials( { app_secret: OTHER_SECRET } );
		( { webhook } = await settings() );
		expect( webhook.received_at_local ).toBeNull();
		expect( webhook.verified_at_local ).toBeTruthy();

		// Callbacks signed with the old secret are now refused.
		const id = await lastMessageId();
		expect(
			( await post( statuses( [ id, 'read', 1793000000 ] ) ) ).status()
		).toBe( 401 );

		await saveCredentials( { verify_token: 'e2e-another-verify-token' } );
		( { webhook } = await settings() );
		expect( webhook.verified_at_local ).toBeNull();

		const removed = await saveCredentials( {
			app_secret: '',
			verify_token: '',
		} );
		expect( ( await removed.json() ).webhook ).toMatchObject( {
			app_secret: { configured: false },
			verify_token: { configured: false },
		} );
	} );
} );
