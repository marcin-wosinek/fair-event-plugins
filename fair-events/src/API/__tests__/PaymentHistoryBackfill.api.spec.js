/**
 * Live coverage for the payment history backfill (#2139, stage 3 of #2111):
 * the dry run, the backfill's admissions, activities and attribution, its
 * findings, restart behaviour and the verification report
 * (PAYMENT_HISTORY_MIGRATION.md §4–6, §8.2–8.4, §8.9).
 *
 * The legacy history is synthetic: the payment-history-backfill.php WP-CLI
 * fixture writes it straight to the tables, as older plugin versions left
 * it, for the contract's worked examples 3, 4, 5, 7, 9, 11, 13, 14, 16 and
 * 20–22, and then makes it predate shadow writes. The fixture drives the
 * batches that WP-Cron runs on a site.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

// Fixtures run without blocking the event loop, so idle keep-alive
// connections aren't closed unnoticed between requests.
async function backfill( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/payment-history-backfill.php',
			action,
			JSON.stringify( data ),
		],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		}
	);
	const match = stdout.match( /E2E_PAYMENT_BACKFILL:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_PAYMENT_BACKFILL output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

function reasons( findings, sourceType, sourceId ) {
	return findings
		.filter(
			( finding ) =>
				finding.source_type === sourceType &&
				finding.source_id === sourceId &&
				finding.status === 'open'
		)
		.map( ( finding ) => finding.reason )
		.sort();
}

function links( state, transactionId ) {
	return ( state.links[ transactionId ] || [] ).map( ( link ) => ( {
		signup: Number( link.signup_id ),
		role: link.role,
		amount: Number( link.allocated_amount ),
		attribution: link.attribution,
	} ) );
}

test.describe.serial( 'Payment history backfill', () => {
	// Each step drives the site through WP-CLI calls that take seconds, and
	// a run covers everything the test site holds up to its cutoff.
	test.describe.configure( { timeout: 300 * 1000 } );

	let api;
	let eventId;
	const dates = {};
	let seed;

	async function state() {
		return backfill( 'state', {
			relationshipIds: Object.values( seed.relationships ),
			transactionIds: Object.values( seed.transactions ),
			signupIds: Object.values( seed.signups ),
			ledgerIds: seed.ledger,
			eventDateIds: Object.values( dates ),
		} );
	}

	function purchaseOf( current, key ) {
		return current.purchases[ seed.relationships[ key ] ] || [];
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const title = `Backfill ${ Date.now() }`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		eventId = ( await post.json() ).id;

		for ( const [ letter, day ] of [
			[ 'A', '10' ],
			[ 'B', '11' ],
			[ 'C', '12' ],
		] ) {
			const date = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title: `${ title } ${ letter }`,
						link_type: 'post',
						start_date: `2035-12-${ day }`,
						start_time: '10:00:00',
						end_date: `2035-12-${ day }`,
						end_time: '12:00:00',
					},
				}
			);
			const body = await date.json();
			expect( date.ok(), JSON.stringify( body ) ).toBeTruthy();
			dates[ letter ] = body.id;
		}

		seed = await backfill( 'seed', {
			eventId,
			dateA: dates.A,
			dateB: dates.B,
			dateC: dates.C,
		} );
		expect( seed.blockers ).toEqual( [] );
	} );

	test.afterAll( async () => {
		if ( seed ) {
			await backfill( 'cleanup', { seed } );
		}
		for ( const id of Object.values( dates ) ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( eventId ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
				headers: adminHeaders,
				params: { force: true },
			} );
		}
		await api?.dispose();
	} );

	test( 'the backfill refuses to start before a dry run', async () => {
		const started = await backfill( 'start', { backupConfirmed: true } );
		expect( started.error ).toBe( 'dry_run_required' );
	} );

	test( 'a dry run reports what the backfill would do and writes nothing', async () => {
		const { run } = await backfill( 'dry-run' );
		expect( run.status ).toBe( 'complete' );
		expect( run.counts.purchase_planned ).toBeGreaterThanOrEqual( 8 );
		// Paid money per currency: what would be attributed, and what not.
		expect( run.totals.EUR.unresolved ).toBeGreaterThanOrEqual( 47 );

		const current = await state();
		for ( const key of [ 'R3', 'R4', 'R20A', 'R22' ] ) {
			expect( purchaseOf( current, key ), key ).toEqual( [] );
		}
		expect( links( current, seed.transactions.T2 ) ).toEqual( [] );

		const findings = current.findings.dry_run;
		const t = seed.transactions;
		expect( reasons( findings, 'transaction', t.T10 ) ).toEqual( [
			'no_evidence',
		] );
		expect( reasons( findings, 'transaction', t.T13b ) ).toEqual( [
			'allocation_mismatch',
		] );
		expect( reasons( findings, 'transaction', t.T7 ) ).toEqual( [
			'ambiguous_activity_charge',
		] );
		expect(
			reasons( findings, 'relationship', seed.relationships.R13 )
		).toEqual( [ 'ambiguous_activity' ] );
		// Example 3 and 20 are attributable once their purchases exist.
		expect( reasons( findings, 'transaction', t.T2 ) ).toEqual( [] );
		expect( reasons( findings, 'transaction', t.T13 ) ).toEqual( [] );

		const ledgerReasons = findings
			.filter( ( finding ) => finding.source_type === 'ledger_row' )
			.map( ( finding ) => finding.reason )
			.sort();
		expect( ledgerReasons ).toEqual( [
			'missing_transaction',
			'unsupported_refund_record',
		] );
	} );

	test( 'the backfill needs a confirmed backup', async () => {
		const refused = await backfill( 'start', { backupConfirmed: false } );
		expect( refused.error ).toBe( 'backup_required' );

		const { run } = await backfill( 'start', { backupConfirmed: true } );
		expect( run.status ).toBe( 'running' );
		expect( run.phase ).toBe( 'admissions' );
		expect( run.started_by ).toBeDefined();
	} );

	test( 'legacy admissions become purchases with their history and payments', async () => {
		const { run } = await backfill( 'run', {
			untilPhase: 'transactions',
			batchSize: 5,
		} );
		expect( run.phase ).toBe( 'transactions' );
		expect( run.last_error ).toBeNull();

		const current = await state();

		// Example 3: one confirmed purchase at the relationship's time, its
		// check-in and activity on the unit, and its payment linked in the
		// same transaction.
		const [ b3 ] = purchaseOf( current, 'R3' );
		expect( b3 ).toMatchObject( {
			status: 'confirmed',
			quantity: '1',
			participant_id: String( seed.participants.P3 ),
			transaction_id: null,
		} );
		expect( Number( b3.amount ) ).toBe( 20 );
		expect( b3.units ).toHaveLength( 1 );
		expect( b3.units[ 0 ].attended_at ).not.toBeNull();
		expect( b3.units[ 0 ].activities ).toEqual( [
			{ ticket_option_id: '910001', status: 'confirmed' },
		] );
		expect( links( current, seed.transactions.T2 ) ).toEqual( [
			{
				signup: Number( b3.id ),
				role: 'charge',
				amount: 20,
				attribution: 'backfill',
			},
		] );

		// Example 4: an organizer-added participant, nothing paid.
		const [ b4 ] = purchaseOf( current, 'R4' );
		expect( b4.status ).toBe( 'confirmed' );
		expect( Number( b4.amount ) ).toBe( 0 );

		// Example 5: interest and collaborators never become purchases.
		expect( purchaseOf( current, 'R5a' ) ).toEqual( [] );
		expect( purchaseOf( current, 'R5b' ) ).toEqual( [] );

		// Participants with a purchase already, and a pending checkout.
		for ( const key of [ 'R7A', 'R9', 'R11', 'R13', 'R23' ] ) {
			expect( purchaseOf( current, key ), key ).toEqual( [] );
		}

		// Example 16: the relationship is still an admission.
		expect( purchaseOf( current, 'R16' ) ).toHaveLength( 1 );
	} );

	test( 'an interrupted batch repeated creates nothing twice', async () => {
		// The pending checkout completes while the backfill runs.
		await backfill( 'set-label', {
			relationshipId: seed.relationships.R23,
			label: 'signed_up',
		} );

		await backfill( 'rewind', { phase: 'admissions' } );
		const { run } = await backfill( 'run', {
			untilPhase: 'transactions',
			batchSize: 5,
		} );
		expect( run.last_error ).toBeNull();

		const current = await state();
		for ( const key of [ 'R3', 'R4', 'R16', 'R20A', 'R20B', 'R22' ] ) {
			expect( purchaseOf( current, key ), key ).toHaveLength( 1 );
		}
		expect( links( current, seed.transactions.T2 ) ).toHaveLength( 1 );
	} );

	test( 'the backfill attributes, reports and verifies', async () => {
		const { run } = await backfill( 'run', { batchSize: 50 } );
		expect( run.last_error ).toBeNull();
		expect( [ 'verified', 'verification_failed' ] ).toContain( run.status );

		const current = await state();
		const t = seed.transactions;
		const s = seed.signups;

		// Example 7: each occurrence gets its own share.
		expect( links( current, t.T3 ) ).toEqual(
			[ s.S7A, s.S7B, s.S7C ].map( ( signup ) => ( {
				signup,
				role: 'charge',
				amount: 12,
				attribution: 'backfill',
			} ) )
		);

		// Example 9: both paid attempts count and are reported.
		expect( links( current, t.T4 ) ).toEqual( [
			{
				signup: s.S9,
				role: 'charge',
				amount: 30,
				attribution: 'backfill',
			},
		] );
		expect( links( current, t.T5 ) ).toEqual( [
			{
				signup: s.S9,
				role: 'charge',
				amount: 30,
				attribution: 'backfill',
			},
		] );

		// Example 20: the multi-instance purchase splits by line.
		const [ b20a ] = purchaseOf( current, 'R20A' );
		const [ b20b ] = purchaseOf( current, 'R20B' );
		expect(
			links( current, t.T13 ).map( ( link ) => link.amount )
		).toEqual( [ 12, 12 ] );
		expect(
			links( current, t.T13 )
				.map( ( link ) => link.signup )
				.sort()
		).toEqual( [ Number( b20a.id ), Number( b20b.id ) ].sort() );

		// Example 22: the charge counts; the refund-labelled row is kept as a
		// record that never does.
		const [ b22 ] = purchaseOf( current, 'R22' );
		expect( links( current, t.T14 ) ).toEqual( [
			{
				signup: Number( b22.id ),
				role: 'charge',
				amount: 20,
				attribution: 'backfill',
			},
			{
				signup: Number( b22.id ),
				role: 'legacy_refund_record',
				amount: 0,
				attribution: 'backfill',
			},
		] );

		// Examples 11, 14, 21: unresolved money gets no partial link.
		for ( const key of [ 'T7', 'T10', 'T13b' ] ) {
			expect( links( current, t[ key ] ), key ).toEqual( [] );
		}

		// A checkout that completed during the run is admitted on revisit.
		expect( purchaseOf( current, 'R23' ) ).toHaveLength( 1 );

		const findings = current.findings.backfill;
		expect( reasons( findings, 'signup', s.S9 ) ).toEqual( [
			'multiple_paid_attempts',
		] );
		expect( reasons( findings, 'transaction', t.T7 ) ).toEqual( [
			'ambiguous_activity_charge',
		] );
		expect( reasons( findings, 'transaction', t.T10 ) ).toEqual( [
			'no_evidence',
		] );
		expect( reasons( findings, 'transaction', t.T13b ) ).toEqual( [
			'allocation_mismatch',
		] );
		expect(
			reasons( findings, 'relationship', seed.relationships.R13 )
		).toEqual( [ 'ambiguous_activity' ] );

		// The report: every seeded date compares cleanly. Shared payments,
		// refund records and unresolved money are explained differences.
		for ( const letter of [ 'A', 'B', 'C' ] ) {
			const comparison = current.comparisons[ dates[ letter ] ];
			expect( comparison, letter ).not.toBeNull();
			expect( comparison.blocking, letter ).toBe( false );
			expect( comparison.admissions.unexpected, letter ).toBe( 0 );
			expect( comparison.revenue.currencies.EUR.unexpected, letter ).toBe(
				0
			);
			// Each date has unresolved money that names it or is on it.
			expect( comparison.revenue_state, letter ).toBe( 'incomplete' );
		}

		const causes = ( letter ) =>
			Object.fromEntries(
				current.comparisons[
					dates[ letter ]
				].revenue.currencies.EUR.differences.map( ( difference ) => [
					difference.transaction_id,
					difference.cause,
				] )
			);
		expect( causes( 'A' ) ).toEqual( {
			[ t.T3 ]: 'shared_transaction',
			[ t.T13 ]: 'shared_transaction',
			[ t.T13b ]: 'unresolved',
		} );
		expect( causes( 'C' ) ).toEqual( {
			[ t.T3 ]: 'shared_transaction',
			[ t.T7 ]: 'unresolved',
			[ t.T14 ]: 'legacy_refund_record',
		} );
		const dateA = current.comparisons[ dates.A ];
		expect( dateA.revenue.currencies.EUR.target ).toBe( 44 );
		expect( dateA.admissions.source ).toBe( dateA.admissions.target );

		// Verification never blames the seeded history.
		const blockers = run.verification.blockers;
		expect( blockers.unexpected_differences || [] ).not.toEqual(
			expect.arrayContaining( [ dates.A ] )
		);
		for ( const id of Object.values( t ) ) {
			expect( blockers.unlisted_paid_transactions || [] ).not.toContain(
				id
			);
		}
		expect( current.status.ownership_cutover ).toBe( false );
	} );

	test( 'running the backfill again changes nothing', async () => {
		const before = await state();

		const started = await backfill( 'start', { backupConfirmed: true } );
		expect( started.run.status ).toBe( 'running' );
		const { run } = await backfill( 'run', { batchSize: 50 } );
		expect( run.last_error ).toBeNull();
		expect( run.counts.purchase_created || 0 ).toBe( 0 );

		const after = await state();
		expect( after.purchases ).toEqual( before.purchases );
		expect( after.links ).toEqual( before.links );
	} );
} );
