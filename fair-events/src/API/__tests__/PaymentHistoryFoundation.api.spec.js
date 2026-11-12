/**
 * Live coverage for the payment history foundation (#2138, stage 2 of
 * #2111): purchase provenance keeps a backfilled relationship from counting
 * twice in capacity and Statistics, and payment link storage enforces its
 * invariants against the real database (PAYMENT_HISTORY_MIGRATION.md §4.3,
 * §5.1, §10).
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingFields, startOf } from '../../../../e2e/support/event-timing.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

async function login( api ) {
	await api.post( '/wp-login.php', {
		form: { log: ADMIN_USER, pwd: ADMIN_PASSWORD, rememberme: 'forever' },
	} );
	const nonce = await api.get( '/wp-admin/admin-ajax.php?action=rest-nonce' );
	expect( nonce.ok() ).toBeTruthy();
	return { 'X-WP-Nonce': await nonce.text() };
}

// Fixtures run without blocking the event loop, so idle keep-alive
// connections aren't closed unnoticed between requests.
async function runFixture( script, action, data, marker ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			`wp-content/mu-plugins/scripts/${ script }`,
			action,
			JSON.stringify( data ),
		],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	const match = stdout.match( new RegExp( `${ marker }:(\\{.*\\})` ) );
	if ( ! match ) {
		throw new Error( `Expected ${ marker } output, got:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

const tickets = ( action, data ) =>
	runFixture(
		'seed-event-statistics-tickets.php',
		action,
		data,
		'E2E_EVENT_STATISTICS_TICKETS'
	);

const links = ( action, data = {} ) =>
	runFixture( 'payment-links.php', action, data, 'E2E_PAYMENT_LINKS' );

function siteNow() {
	return new Date().toISOString().slice( 0, 19 ).replace( 'T', ' ' );
}

function link( signupId, amount, extra = {} ) {
	return {
		signup_id: signupId,
		role: 'charge',
		allocated_amount: amount,
		attribution: 'backfill',
		evidence: { type: 'metadata_signup_ids' },
		...extra,
	};
}

test.describe( 'Payment history foundation', () => {
	// Every check seeds through WP-CLI calls that take seconds each.
	test.describe.configure( { timeout: 120 * 1000 } );

	let api;
	let adminHeaders;
	const eventIds = [];
	const eventDateIds = [];
	const participantIds = [];
	const transactionIds = [];
	const signupIds = [];
	let series;

	async function createEventDate( name ) {
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Payment history ${ name }`, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		const eventId = ( await post.json() ).id;
		eventIds.push( eventId );

		const start = new Date( Date.now() + 10 * 86400000 )
			.toISOString()
			.slice( 0, 10 );
		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Payment history ${ name } date`,
				...timingFields( `${ start } 10:00:00`, `${ start } 22:00:00` ),
			},
		} );
		expect( date.ok() ).toBeTruthy();
		const eventDateId = ( await date.json() ).id;
		eventDateIds.push( eventDateId );
		const linked = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventId } }
		);
		expect( linked.ok() ).toBeTruthy();
		return eventDateId;
	}

	async function addRelationship( eventDateId ) {
		const participant = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Payment history participant',
					email: `payment-history-${ Date.now() }-${ participantIds.length }@example.test`,
				},
			}
		);
		expect( participant.ok() ).toBeTruthy();
		const participantId = ( await participant.json() ).id;
		participantIds.push( participantId );
		const relationship = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{
				headers: adminHeaders,
				data: { participant_id: participantId, label: 'signed_up' },
			}
		);
		expect( relationship.ok() ).toBeTruthy();
		return {
			participantId,
			relationshipId: ( await relationship.json() ).id,
		};
	}

	async function statistics( eventDateId ) {
		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/statistics`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		return response.json();
	}

	async function capacityTaken( eventDateId ) {
		const response = await api.get(
			`/wp-json/fair-e2e/v1/ticket-capacity?event_date_ids[]=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		return ( await response.json() ).event_dates[ eventDateId ];
	}

	async function seedSignup( data ) {
		const result = await tickets( 'signup', data );
		signupIds.push( result.signupId );
		return result;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		adminHeaders = await login( api );
	} );

	test.afterAll( async () => {
		await links( 'cleanup', { transactionIds, signupIds } );
		const seriesIds = series ? series.occurrenceIds : [];
		await tickets( 'cleanup', {
			eventDateIds: [ ...eventDateIds, ...seriesIds ],
		} );
		if ( series ) {
			await runFixture(
				'cleanup-event.php',
				String( series.eventId ),
				series.eventDateId,
				'E2E_CLEANUP'
			).catch( () => {} );
		}
		for ( const id of participantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{ headers: adminHeaders }
			);
		}
		for ( const eventId of eventIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: 'true' },
			} );
		}
		await api.dispose();
	} );

	test( 'storage is installed with its keys and survives repeated installs', async () => {
		const expectSchema = ( schema ) => {
			expect( schema.version ).toBe( '3.54.0' );
			expect( schema.linksTable ).toBe( true );
			expect( schema.engine ).toBe( 'InnoDB' );
			expect( schema.indexes.idx_signup_transaction_role ).toEqual( {
				unique: true,
				columns: [ 'signup_id', 'transaction_id', 'role' ],
			} );
			expect( schema.indexes.idx_transaction_id.unique ).toBe( false );
			expect( schema.provenanceColumn.type ).toMatch(
				/^bigint(\(20\))? unsigned$/
			);
			expect( schema.provenanceColumn.null ).toBe( 'YES' );
			expect( schema.provenanceUnique ).toBe( true );
			expect( schema.storageAvailable ).toBe( true );
		};

		expectSchema( await links( 'schema' ) );
		const reinstalled = await links( 'reinstall' );
		expectSchema( reinstalled.first );
		expectSchema( reinstalled.second );
	} );

	test( 'an upgrade from 3.48.0 adds the storage once, and repeating it changes nothing', async () => {
		const upgrade = await links( 'upgrade' );

		expect( upgrade.before.linksTable ).toBe( false );
		expect( upgrade.before.provenanceColumn ).toBeNull();
		expect( upgrade.before.storageAvailable ).toBe( false );
		for ( const run of [ upgrade.first, upgrade.second ] ) {
			expect( run.version ).toBe( '3.54.0' );
			expect( run.linksTable ).toBe( true );
			expect( run.provenanceUnique ).toBe( true );
			expect( run.storageAvailable ).toBe( true );
		}
		expect( upgrade.second ).toEqual( upgrade.first );
	} );

	test( 'a purchase backfilled from a relationship counts once; relationships never count in capacity or Statistics', async () => {
		const eventDateId = await createEventDate( 'provenance' );
		const legacy = await addRelationship( eventDateId );
		const yoga = { optionId: 910001, name: 'Provenance yoga' };
		await tickets( 'participant-option', {
			relationshipId: legacy.relationshipId,
			...yoga,
		} );

		// A relationship alone is no admission (#2251).
		let body = await statistics( eventDateId );
		expect( body.total_tickets ).toBe( 0 );
		expect( await capacityTaken( eventDateId ) ).toBe( 0 );

		// The purchase backfilled from that relationship has no participant
		// match (as after anonymization), so only provenance ties them.
		await seedSignup( {
			eventDateId,
			participantId: null,
			quantity: 1,
			createdAt: siteNow(),
			legacyEventParticipantId: legacy.relationshipId,
			units: [ { status: 'confirmed' } ],
		} );
		body = await statistics( eventDateId );
		expect( body.total_tickets ).toBe( 1 );
		expect( await capacityTaken( eventDateId ) ).toBe( 1 );

		// Nor is a relationship without provenance.
		const other = await addRelationship( eventDateId );
		body = await statistics( eventDateId );
		expect( body.total_tickets ).toBe( 1 );
		expect( await capacityTaken( eventDateId ) ).toBe( 1 );

		// A purchase by the same participant counts once. Its
		// participant-scope activity is the purchase's, carried by its one
		// ticket as the shadow writes and the backfill copy it, and never
		// counted twice (§4.4, §8.8).
		await seedSignup( {
			eventDateId,
			participantId: other.participantId,
			quantity: 1,
			createdAt: siteNow(),
			legacyEventParticipantId: other.relationshipId,
			units: [
				{
					status: 'confirmed',
					activities: [
						{ optionId: yoga.optionId, name: yoga.name },
					],
				},
			],
		} );
		await tickets( 'participant-option', {
			relationshipId: other.relationshipId,
			...yoga,
		} );
		body = await statistics( eventDateId );
		expect( body.total_tickets ).toBe( 2 );
		expect( body.tickets_per_activity ).toEqual( [
			{ id: yoga.optionId, name: yoga.name, count: 1 },
		] );
		expect( await capacityTaken( eventDateId ) ).toBe( 2 );

		// Provenance is the admission whatever the purchase's status: a
		// cancelled backfilled purchase doesn't bring the relationship back.
		const cancelled = await addRelationship( eventDateId );
		await seedSignup( {
			eventDateId,
			participantId: null,
			quantity: 1,
			status: 'cancelled',
			createdAt: siteNow(),
			legacyEventParticipantId: cancelled.relationshipId,
			units: [ { status: 'cancelled' } ],
		} );
		expect( ( await statistics( eventDateId ) ).total_tickets ).toBe( 2 );
		expect( await capacityTaken( eventDateId ) ).toBe( 2 );

		// One relationship can be the provenance of only one purchase.
		const duplicate = await links( 'provenance-duplicate', {
			eventDateId,
			relationshipId: legacy.relationshipId,
		} );
		signupIds.push( ...duplicate.signupIds );
		expect( duplicate.inserted ).toEqual( [ false, false ] );
		expect( duplicate.duplicateKey ).toBe( true );
	} );

	test( 'a whole-series pass backfilled on the master counts once on each occurrence', async () => {
		series = await runFixture(
			'seed-event.php',
			'three-ticket-scopes',
			{ omitMulti: true },
			'E2E_SEED'
		);
		const [ masterId, firstId ] = series.occurrenceIds;
		const [ wholeSeriesTypeId ] = series.extraTypeIds;
		const master = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ masterId }`,
			{ headers: adminHeaders }
		);
		expect( master.ok() ).toBeTruthy();
		const masterStart = startOf( await master.json() );

		const pass = await addRelationship( masterId );
		await tickets( 'relationship-ticket-type', {
			relationshipId: pass.relationshipId,
			ticketTypeId: wholeSeriesTypeId,
		} );
		// The relationship alone counts nowhere.
		expect( ( await statistics( firstId ) ).total_tickets ).toBe( 0 );

		await seedSignup( {
			eventDateId: masterId,
			participantId: null,
			ticketTypeId: wholeSeriesTypeId,
			quantity: 1,
			createdAt: `${ masterStart.slice( 0, 10 ) } 00:00:00`,
			legacyEventParticipantId: pass.relationshipId,
			units: [ { status: 'confirmed' } ],
		} );
		for ( const id of series.occurrenceIds ) {
			expect( ( await statistics( id ) ).total_tickets ).toBe( 1 );
		}
	} );

	test( 'links enforce uniqueness, repeat as no-ops and never exceed the total', async () => {
		const eventDateId = await createEventDate( 'links' );
		const seeded = await links( 'seed', {
			eventDateId,
			signups: 3,
			amount: 36,
		} );
		transactionIds.push( seeded.transactionId );
		signupIds.push( ...seeded.signupIds );
		const [ first, second, third ] = seeded.signupIds;
		const shared = [ link( first, 12 ), link( second, 12 ) ];

		const written = await links( 'write', {
			transactionId: seeded.transactionId,
			links: shared,
		} );
		expect( written ).toMatchObject( { inserted: 2, unchanged: 0 } );
		const repeated = await links( 'write', {
			transactionId: seeded.transactionId,
			links: shared,
		} );
		expect( repeated ).toMatchObject( { inserted: 0, unchanged: 2 } );

		// A conflicting duplicate is refused with the whole set, and the
		// stored link keeps its allocation.
		const conflict = await links( 'write', {
			transactionId: seeded.transactionId,
			links: [
				link( third, 1 ),
				link( first, 10, { attribution: 'live' } ),
			],
		} );
		expect( conflict.error ).toBe( 'payment_link_conflict' );
		const over = await links( 'write', {
			transactionId: seeded.transactionId,
			links: [ link( third, 12.01 ) ],
		} );
		expect( over.error ).toBe( 'allocation_exceeds_total' );

		let stored = await links( 'links', {
			transactionId: seeded.transactionId,
		} );
		expect(
			stored.links.map( ( row ) => [
				row.signup_id,
				row.allocated_amount,
				row.attribution,
			] )
		).toEqual( [
			[ String( first ), '12.00', 'backfill' ],
			[ String( second ), '12.00', 'backfill' ],
		] );

		// The database itself refuses a second (purchase, transaction, role).
		const raw = await links( 'raw-duplicate', {
			signupId: first,
			transactionId: seeded.transactionId,
			role: 'charge',
		} );
		expect( raw ).toEqual( { inserted: false, duplicateKey: true } );

		// Links stay when Connector loses the transaction, and the reader
		// says it is missing instead of reporting nothing.
		await links( 'delete-transaction', {
			transactionId: seeded.transactionId,
		} );
		stored = await links( 'links', {
			transactionId: seeded.transactionId,
			signupId: first,
		} );
		expect( stored.links ).toHaveLength( 2 );
		expect( stored.history.payment_information ).toBe( 'available' );
		expect( stored.history.links[ 0 ] ).toMatchObject( {
			transaction: null,
			transaction_missing: true,
		} );
		const missing = await links( 'write', {
			transactionId: seeded.transactionId,
			links: [ link( third, 1 ) ],
		} );
		expect( missing.error ).toBe( 'missing_transaction' );
	} );

	test( 'concurrent writers of one transaction are serialized and cannot exceed its total together', async () => {
		const eventDateId = await createEventDate( 'concurrency' );
		const seeded = await links( 'seed', {
			eventDateId,
			signups: 2,
			amount: 36,
		} );
		transactionIds.push( seeded.transactionId );
		signupIds.push( ...seeded.signupIds );
		const [ first, second ] = seeded.signupIds;

		// Each set fits on its own; together they would be 48 of 36. The
		// writers race inside the container: parallel `wp-env run` calls
		// break the environment for every later spec in the job.
		const { results } = await links( 'parallel', {
			runs: [
				{
					action: 'write',
					data: {
						transactionId: seeded.transactionId,
						links: [ link( first, 24 ) ],
					},
				},
				{
					action: 'write',
					data: {
						transactionId: seeded.transactionId,
						links: [ link( second, 24 ) ],
					},
				},
			],
		} );
		expect( results.filter( ( r ) => r.inserted === 1 ) ).toHaveLength( 1 );
		expect(
			results.filter( ( r ) => r.error === 'allocation_exceeds_total' )
		).toHaveLength( 1 );
		const stored = await links( 'links', {
			transactionId: seeded.transactionId,
		} );
		expect( stored.links ).toHaveLength( 1 );

		// A writer waits while another holds the transaction's lock.
		const other = await links( 'seed', {
			eventDateId,
			signups: 1,
			amount: 10,
		} );
		transactionIds.push( other.transactionId );
		signupIds.push( ...other.signupIds );
		const {
			results: [ hold, write ],
		} = await links( 'parallel', {
			runs: [
				{
					action: 'hold-lock',
					data: { transactionId: other.transactionId, seconds: 6 },
				},
				{
					action: 'write',
					delayMs: 1500,
					data: {
						transactionId: other.transactionId,
						links: [ link( other.signupIds[ 0 ], 10 ) ],
					},
				},
			],
		} );
		expect( hold.acquired ).toBe( true );
		expect( write.inserted ).toBe( 1 );
		expect( write.started ).toBeLessThan( hold.released );
		expect( write.finished ).toBeGreaterThanOrEqual( hold.released );
	} );
} );
