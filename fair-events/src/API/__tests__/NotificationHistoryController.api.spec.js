/**
 * Playwright API tests for NotificationHistoryController (#1920): the
 * execution and delivery history of every notification type, under
 * /fair-events/v1/event-notifications/executions and
 * /fair-events/v1/event-notifications/configurations/{id}/executions.
 *
 * Executions are produced the way the site produces them: test sends through
 * the configuration routes, scheduled sends through the cron callbacks (run
 * with WP-CLI), and the import of earlier history through the migration.
 * Mail is captured by the test support layer (e2e/mu-plugins), which can also
 * make delivery to one address fail. No case reaches api.telegram.org: the
 * Telegram tests are refused before a message is built.
 *
 * Covers authorization, filter validation, pagination, configuration scope,
 * history outliving its configuration, unique keys, the legacy import and
 * its rerun, abandoned executions and retention.
 */

import { test, expect, request } from '@playwright/test';
import { runScript } from '../../../../e2e/support/wp-cli.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/event-notifications';
const EXECUTIONS = `${ PATH }/executions`;
const CONFIGURATIONS = `${ PATH }/configurations`;
const MAIL_LOG = '/wp-json/fair-e2e/v1/fee-reminders/mail';
const MAIL_FAILURE = '/wp-json/fair-e2e/v1/fee-reminders/mail-failure';
const RECIPIENT = 'history-1920-api@example.test';
const SUBSCRIBER_EMAIL = `history-1920-${ Date.now() }@example.test`;
const TOKEN_OPTION = 'fair_events_experimental_weekly_telegram_token';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const fixture = ( action ) =>
	runScript(
		'notification-history-fixture.php',
		'E2E_NOTIFICATION_HISTORY',
		action
	);

test.describe( 'NotificationHistoryController', () => {
	let api;
	let subscriberId;
	let subscriberHeaders;
	let sourceId;
	let sourceSlug;
	const created = [];

	const createConfiguration = async ( type, name, settings = {} ) => {
		const res = await api.post( CONFIGURATIONS, {
			headers: adminHeaders,
			data: { type, name },
		} );
		expect( res.status() ).toBe( 201 );
		const configuration = await res.json();
		created.push( configuration.id );
		if ( Object.keys( settings ).length ) {
			const saved = await api.post(
				`${ CONFIGURATIONS }/${ configuration.id }`,
				{ headers: adminHeaders, data: settings }
			);
			expect( saved.status() ).toBe( 200 );
		}
		return configuration;
	};

	const sendTest = ( id ) =>
		api.post( `${ CONFIGURATIONS }/${ id }/test`, {
			headers: adminHeaders,
		} );

	const list = async ( path, params = {}, headers = adminHeaders ) => {
		const res = await api.get( path, { headers, params } );
		expect( res.status() ).toBe( 200 );
		return {
			items: await res.json(),
			total: Number( res.headers()[ 'x-wp-total' ] ),
			pages: Number( res.headers()[ 'x-wp-totalpages' ] ),
		};
	};

	const executionsOf = ( id, params = {} ) =>
		list( `${ CONFIGURATIONS }/${ id }/executions`, params );

	const deliveriesOf = async ( id, executionId ) =>
		(
			await list(
				`${ CONFIGURATIONS }/${ id }/executions/${ executionId }/deliveries`,
				{ per_page: 100 }
			)
		).items;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const userLogin = `history-1920-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1920!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1920!` ).toString(
					'base64'
				),
		};

		sourceSlug = `history-1920-${ Date.now() }`;
		const sourceRes = await api.post( '/wp-json/fair-events/v1/sources', {
			headers: adminHeaders,
			data: {
				name: 'History source',
				slug: sourceSlug,
				enabled: true,
				data_sources: [
					{
						source_type: 'categories',
						config: { category_ids: [ 1 ] },
					},
				],
			},
		} );
		expect( sourceRes.ok() ).toBeTruthy();
		sourceId = ( await sourceRes.json() ).id;

		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );
	} );

	test.afterAll( async () => {
		if ( created.length ) {
			runScript(
				'notification-configurations-fixture.php',
				'E2E_NOTIFICATION_CONFIGURATIONS',
				`remove ${ created.join( ' ' ) }`
			);
			fixture( `clear ${ created.join( ' ' ) }` );
		}
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );
		await api.delete( `/wp-json/fair-events/v1/sources/${ sourceId }`, {
			headers: adminHeaders,
		} );
		await api.delete(
			`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);
		await api.dispose();
	} );

	test( 'is for administrators only', async () => {
		const own = await createConfiguration( 'individual_email', 'Private', {
			recipient: RECIPIENT,
		} );
		expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		const [ execution ] = ( await executionsOf( own.id ) ).items;

		const anon = await request.newContext( { baseURL: BASE_URL } );
		for ( const path of [
			EXECUTIONS,
			`${ EXECUTIONS }/${ execution.id }`,
			`${ EXECUTIONS }/${ execution.id }/deliveries`,
			`${ CONFIGURATIONS }/${ own.id }/executions`,
			`${ CONFIGURATIONS }/${ own.id }/executions/${ execution.id }/deliveries`,
		] ) {
			expect( ( await anon.get( path ) ).status() ).toBe( 401 );
			const forbidden = await api.get( path, {
				headers: subscriberHeaders,
			} );
			expect( forbidden.status() ).toBe( 403 );
			expect( await forbidden.text() ).not.toContain( RECIPIENT );
		}
		await anon.dispose();
	} );

	test( 'validates filters and page sizes', async () => {
		for ( const params of [
			{ per_page: 101 },
			{ per_page: 0 },
			{ page: 0 },
			{ outcome: 'delivered' },
			{ channel: 'sms' },
			{ origin: 'manual' },
			{ after: 'yesterday' },
			{ configuration: 'Not An ID!' },
		] ) {
			const res = await api.get( EXECUTIONS, {
				headers: adminHeaders,
				params,
			} );
			expect( res.status(), JSON.stringify( params ) ).toBe( 400 );
		}
		expect(
			(
				await api.get( `${ EXECUTIONS }/999999999`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 404 );
	} );

	test( 'tables have unique source keys and a scheduled cleanup', () => {
		const schema = fixture( 'schema' );
		expect( schema.version ).toBe( '1' );
		expect( schema.executionKeys ).toContain( 'source_key' );
		expect( schema.deliveryKeys ).toContain( 'source_key' );
		expect( schema.cleanupScheduled ).toBe( true );
	} );

	test( 'records each test send with its delivery and outcome', async () => {
		const own = await createConfiguration(
			'individual_email',
			'Organizer copy',
			{ recipient: RECIPIENT }
		);
		await api.delete( MAIL_LOG, { headers: adminHeaders } );

		expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: RECIPIENT },
		} );
		expect( ( await sendTest( own.id ) ).status() ).toBe( 500 );
		await api.post( MAIL_FAILURE, {
			headers: adminHeaders,
			data: { email: '' },
		} );

		const { items, total } = await executionsOf( own.id );
		expect( total ).toBe( 2 );
		const [ failed, accepted ] = items;
		expect( accepted ).toMatchObject( {
			configuration: {
				id: own.id,
				name: 'Organizer copy',
				name_source: 'snapshot',
				exists: true,
			},
			channel: 'individual_email',
			origin: 'test',
			lifecycle: 'completed',
			outcome: 'success',
			counts: { unit: 'recipients', accepted: 1, failed: 0 },
			completeness: 'complete',
			legacy: null,
		} );
		expect( accepted.week_start ).toMatch( /^\d{4}-\d{2}-\d{2}$/ );
		expect( accepted.started_at ).toMatch( /Z$/ );
		expect( failed ).toMatchObject( {
			outcome: 'failure',
			counts: { accepted: 0, failed: 1 },
		} );

		const [ delivery ] = await deliveriesOf( own.id, accepted.id );
		expect( delivery ).toMatchObject( {
			recipient: RECIPIENT,
			outcome: 'accepted',
			legacy: false,
			part: null,
		} );
		expect( delivery.attempted_at ).toMatch( /Z$/ );
		expect(
			( await deliveriesOf( own.id, failed.id ) )[ 0 ]
		).toMatchObject( {
			outcome: 'failed',
			reason_code: 'send_failed',
		} );

		// A test never consumes or releases a scheduled send's claim.
		expect( fixture( `claims ${ own.id }` ).claims ).toBe( 0 );
	} );

	test( 'records refused tests of every channel without deliveries', async () => {
		const individual = await createConfiguration(
			'individual_email',
			'No address'
		);
		const telegram = await createConfiguration( 'telegram', 'No chats' );

		expect( ( await sendTest( individual.id ) ).status() ).toBe( 400 );
		expect( ( await sendTest( telegram.id ) ).status() ).toBe( 400 );

		const [ missing ] = ( await executionsOf( individual.id ) ).items;
		expect( missing ).toMatchObject( {
			origin: 'test',
			outcome: 'failure',
			reason_code: 'missing_recipient',
			counts: { accepted: 0, failed: 0, skipped: 0, unknown: 0 },
		} );

		const telegramRes = await api.get(
			`${ CONFIGURATIONS }/${ telegram.id }/executions`,
			{ headers: adminHeaders }
		);
		const body = await telegramRes.text();
		const [ refused ] = JSON.parse( body );
		expect( refused ).toMatchObject( {
			channel: 'telegram',
			origin: 'test',
			outcome: 'failure',
			counts: { unit: 'message_parts', accepted: 0 },
		} );
		expect( refused.reason_code ).not.toBe( '' );
		expect( body ).not.toContain( TOKEN_OPTION );
		expect( body ).not.toMatch( /\d{6,}:[A-Za-z0-9_-]{20,}/ );
	} );

	test( 'records a scheduled send once per occurrence', async () => {
		const own = await createConfiguration( 'individual_email', 'Weekly', {
			recipient: RECIPIENT,
			enabled: true,
			skip_empty: false,
		} );
		const run = () =>
			runScript(
				'notification-configurations-fixture.php',
				'E2E_NOTIFICATION_CONFIGURATIONS',
				`run ${ own.id }`
			);
		run();
		run();

		const { items, total } = await executionsOf( own.id, {
			origin: 'scheduled',
		} );
		expect( total ).toBe( 1 );
		expect( items[ 0 ] ).toMatchObject( {
			origin: 'scheduled',
			outcome: 'success',
			lifecycle: 'completed',
			counts: { accepted: 1 },
		} );
		expect( items[ 0 ].occurrence ).toMatch( /^\d{4}-W\d{2}$/ );
		expect( await deliveriesOf( own.id, items[ 0 ].id ) ).toHaveLength( 1 );
		expect( fixture( `claims ${ own.id }` ).claims ).toBe( 1 );
	} );

	test( 'records each group email recipient reported by Fair Audience', async () => {
		const participant = fixture( `participant ${ SUBSCRIBER_EMAIL }` );
		try {
			const own = await createConfiguration( 'bulk_email', 'Members', {
				enabled: true,
				source_slug: sourceSlug,
				skip_empty: false,
			} );
			fixture( `run-bulk ${ own.id }` );

			const { items, total } = await executionsOf( own.id );
			expect( total ).toBe( 1 );
			const execution = items[ 0 ];
			expect( execution ).toMatchObject( {
				channel: 'bulk_email',
				origin: 'scheduled',
				lifecycle: 'completed',
				counts: { unit: 'recipients' },
			} );
			expect( [ 'success', 'partial' ] ).toContain( execution.outcome );

			const deliveries = [];
			for ( let page = 1; ; page++ ) {
				const batch = await list(
					`${ CONFIGURATIONS }/${ own.id }/executions/${ execution.id }/deliveries`,
					{ page, per_page: 100 }
				);
				deliveries.push( ...batch.items );
				if ( page >= batch.pages ) {
					break;
				}
			}
			const { accepted, failed, skipped, unknown } = execution.counts;
			expect( deliveries ).toHaveLength(
				accepted + failed + skipped + unknown
			);
			expect(
				deliveries.find( ( d ) => d.recipient === SUBSCRIBER_EMAIL )
			).toMatchObject( {
				recipient_name: 'History 1920',
				outcome: 'accepted',
			} );
		} finally {
			fixture( `remove-participant ${ participant.participantId }` );
		}
	} );

	test( 'paginates and filters newest first', async () => {
		const own = await createConfiguration( 'individual_email', 'Paged', {
			recipient: RECIPIENT,
		} );
		const other = await createConfiguration( 'individual_email', 'Other', {
			recipient: RECIPIENT,
		} );
		for ( let i = 0; i < 3; i++ ) {
			expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		}
		expect( ( await sendTest( other.id ) ).status() ).toBe( 200 );

		const first = await executionsOf( own.id, { per_page: 2 } );
		expect( first ).toMatchObject( { total: 3, pages: 2 } );
		expect( first.items ).toHaveLength( 2 );
		const second = await executionsOf( own.id, { per_page: 2, page: 2 } );
		expect( second.items ).toHaveLength( 1 );
		const ids = [ ...first.items, ...second.items ].map( ( e ) => e.id );
		expect( ids ).toEqual( [ ...ids ].sort( ( a, b ) => b - a ) );

		const global = await list( EXECUTIONS, {
			configuration: own.id,
			channel: 'individual_email',
			origin: 'test',
			outcome: 'success',
		} );
		expect( global.items.map( ( e ) => e.id ) ).toEqual( ids );

		expect(
			( await executionsOf( own.id, { outcome: 'failure' } ) ).total
		).toBe( 0 );
		expect(
			( await executionsOf( own.id, { origin: 'scheduled' } ) ).total
		).toBe( 0 );
		expect(
			( await executionsOf( own.id, { channel: 'telegram' } ) ).total
		).toBe( 0 );

		const startedAt = first.items[ 0 ].started_at;
		const tomorrow = new Date( Date.now() + 86400000 ).toISOString();
		expect(
			( await executionsOf( own.id, { after: tomorrow } ) ).total
		).toBe( 0 );
		expect(
			( await executionsOf( own.id, { before: '2000-01-01T00:00:00' } ) )
				.total
		).toBe( 0 );
		expect(
			( await executionsOf( own.id, { after: startedAt } ) ).total
		).toBeGreaterThanOrEqual( 1 );

		const all = await list( EXECUTIONS, { per_page: 100 } );
		expect( all.total ).toBeGreaterThanOrEqual( 4 );
	} );

	test( 'keeps each configuration to its own executions', async () => {
		const own = await createConfiguration( 'individual_email', 'Mine', {
			recipient: RECIPIENT,
		} );
		const other = await createConfiguration( 'individual_email', 'Yours', {
			recipient: RECIPIENT,
		} );
		expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		const [ execution ] = ( await executionsOf( own.id ) ).items;

		for ( const path of [
			`${ CONFIGURATIONS }/${ other.id }/executions/${ execution.id }`,
			`${ CONFIGURATIONS }/${ other.id }/executions/${ execution.id }/deliveries`,
		] ) {
			expect(
				( await api.get( path, { headers: adminHeaders } ) ).status()
			).toBe( 404 );
		}
		expect( ( await executionsOf( other.id ) ).total ).toBe( 0 );
		expect(
			(
				await api.get(
					`${ CONFIGURATIONS }/${ own.id }/executions/${ execution.id }`,
					{ headers: adminHeaders }
				)
			).status()
		).toBe( 200 );
	} );

	test( 'keeps history readable after its configuration changes or is removed', async () => {
		const own = await createConfiguration( 'individual_email', 'Before', {
			recipient: RECIPIENT,
		} );
		expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		await api.post( `${ CONFIGURATIONS }/${ own.id }`, {
			headers: adminHeaders,
			data: { name: 'After', recipient: 'changed-1920@example.test' },
		} );
		runScript(
			'notification-configurations-fixture.php',
			'E2E_NOTIFICATION_CONFIGURATIONS',
			`remove ${ own.id }`
		);

		const [ execution ] = ( await executionsOf( own.id ) ).items;
		expect( execution.configuration ).toMatchObject( {
			id: own.id,
			name: 'Before',
			exists: false,
		} );
		expect(
			( await deliveriesOf( own.id, execution.id ) )[ 0 ]
		).toMatchObject( {
			recipient: RECIPIENT,
		} );
	} );

	test( 'imports earlier history once, marked as legacy', async () => {
		const telegram = await createConfiguration( 'telegram', 'Old summary' );
		const individual = await createConfiguration(
			'individual_email',
			'Old copy'
		);
		const seeded = fixture(
			`seed-legacy ${ telegram.id } ${ individual.id }`
		);
		expect( seeded.migrated ).toBe( true );
		expect( seeded.executionsAfterTwo ).toBe( seeded.executionsAfterOne );

		const { items } = await executionsOf( telegram.id );
		expect( items ).toHaveLength( 2 );
		const run = items.find( ( e ) => e.week_start === seeded.weekStart );
		expect( run ).toMatchObject( {
			configuration: {
				name: 'Old summary',
				name_source: 'migration_fallback',
			},
			origin: 'scheduled',
			occurrence: seeded.weekStart,
			outcome: 'partial',
			completeness: 'legacy',
			legacy: { status: 'partial' },
			counts: {
				unit: 'destinations',
				accepted: 1,
				failed: 1,
				skipped: null,
			},
		} );
		const runDeliveries = await deliveriesOf( telegram.id, run.id );
		expect(
			runDeliveries.map( ( d ) => [
				d.recipient,
				d.part,
				d.outcome,
				d.legacy,
			] )
		).toEqual( [
			[ '@legacy_one', 1, 'accepted', true ],
			[ '@legacy_two', 1, 'failed', true ],
			[ '@legacy_two', 2, 'skipped', true ],
		] );
		expect( runDeliveries[ 2 ].attempted_at ).toBeNull();

		const unmatched = items.find( ( e ) => e.id !== run.id );
		expect( unmatched ).toMatchObject( {
			occurrence: seeded.unmatchedWeek,
			outcome: 'unknown',
			reason_code: 'legacy_unmatched',
			completeness: 'legacy',
			counts: { accepted: null, unknown: null },
		} );
		expect(
			( await deliveriesOf( telegram.id, unmatched.id ) )[ 0 ]
		).toMatchObject( {
			outcome: 'unknown',
			reason_code: 'internal_error',
		} );

		const [ copy ] = ( await executionsOf( individual.id ) ).items;
		expect( copy ).toMatchObject( {
			occurrence: seeded.sendWeek,
			outcome: 'success',
			legacy: { status: 'sent' },
			counts: { accepted: null },
		} );
		expect(
			( await deliveriesOf( individual.id, copy.id ) )[ 0 ]
		).toMatchObject( {
			recipient: 'legacy-1920@example.test',
			outcome: 'accepted',
		} );

		// The import changes no delivery claim.
		expect( fixture( `claims ${ telegram.id }` ).claims ).toBe( 4 );
	} );

	test( 'reports an abandoned execution with unknown outcomes', async () => {
		const own = await createConfiguration( 'individual_email', 'Stopped' );
		const { executionId } = fixture( `stale ${ own.id }` );

		const execution = await (
			await api.get( `${ EXECUTIONS }/${ executionId }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( execution ).toMatchObject( {
			lifecycle: 'abandoned',
			outcome: 'unknown',
			counts: { unknown: 1 },
		} );
		expect(
			( await deliveriesOf( own.id, executionId ) )[ 0 ]
		).toMatchObject( {
			outcome: 'unknown',
			reason_code: 'interrupted',
			finished_at: null,
		} );
		expect(
			( await executionsOf( own.id, { outcome: 'unknown' } ) ).total
		).toBe( 1 );
	} );

	test( 'deletes history past its retention without touching claims', async () => {
		const own = await createConfiguration( 'individual_email', 'Retained', {
			recipient: RECIPIENT,
			enabled: true,
			skip_empty: false,
		} );
		runScript(
			'notification-configurations-fixture.php',
			'E2E_NOTIFICATION_CONFIGURATIONS',
			`run ${ own.id }`
		);
		expect( ( await sendTest( own.id ) ).status() ).toBe( 200 );
		const [ recent, old ] = ( await executionsOf( own.id ) ).items;

		fixture( `age ${ old.id } 400` );
		fixture( 'cleanup' );

		expect(
			(
				await api.get( `${ EXECUTIONS }/${ old.id }`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 404 );
		expect(
			(
				await api.get( `${ EXECUTIONS }/${ recent.id }`, {
					headers: adminHeaders,
				} )
			).status()
		).toBe( 200 );
		expect( fixture( `claims ${ own.id }` ).claims ).toBe( 1 );
	} );
} );
