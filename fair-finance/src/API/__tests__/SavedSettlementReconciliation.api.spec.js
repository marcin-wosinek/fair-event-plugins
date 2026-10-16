import { test, expect, request } from '@playwright/test';

const headers = {
	Authorization:
		'Basic ' +
		Buffer.from(
			`${ process.env.WP_ADMIN_USER || 'admin' }:${ process.env.WP_ADMIN_PASSWORD || 'password' }`
		).toString( 'base64' ),
};
const FIXTURE = '/wp-json/fair-e2e/v1/settlements/reconciliation';
const ROOT = '/wp-json/fair-finance/v1/reconciliation/settlements';
const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';

test.describe( 'Saved settlement reconciliation', () => {
	let api;
	let fixture;
	const post = async ( path, data ) => api.post( path, { headers, data } );
	const seed = async ( options = {} ) => {
		const response = await post( FIXTURE, options );
		expect( response.ok(), await response.text() ).toBeTruthy();
		fixture = await response.json();
		return fixture;
	};
	const selection = () => ( {
		entry_id: fixture.entry_id,
		currency: 'EUR',
		account_id: fixture.account_id,
	} );
	const preview = async ( selected = selection() ) => {
		const response = await post(
			`${ ROOT }/${ fixture.settlement_id }/preview`,
			selected
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return response.json();
	};
	const confirm = ( data, extra = {} ) =>
		post( `${ ROOT }/${ fixture.settlement_id }/confirm`, {
			...selection(),
			fingerprint: data.fingerprint,
			state: 'full',
			...extra,
		} );
	const cleanup = async () => {
		await post( FIXTURE, { action: 'cleanup' } );
		await post( '/wp-json/fair-e2e/v1/settlements/reset', {} );
	};
	test.beforeAll( async () => {
		api = await request.newContext( {
			baseURL: process.env.WP_BASE_URL || 'http://localhost:8889',
		} );
	} );
	test.beforeEach( cleanup );
	test.afterAll( async () => {
		await cleanup();
		await api.dispose();
	} );

	for ( const origin of [ 'api', 'csv' ] ) {
		test( `reconciles ${ origin } evidence locally, retains aggregate fees, and repeats safely`, async () => {
			await seed( { origin } );
			const count = await api.get(
				'/wp-json/fair-e2e/v1/settlements/state',
				{ headers }
			);
			const before = await count.json();
			const data = await preview();
			expect( data.can_full ).toBeTruthy();
			expect( data.explanation.net ).toBe( '38.55' );
			expect( data.allocation.supported ).toBeFalsy();
			const responses = await Promise.all( [
				confirm( data ),
				confirm( data ),
			] );
			for ( const response of responses )
				expect( response.ok(), await response.text() ).toBeTruthy();
			const current = await preview();
			expect( current.decision.current_state ).toBe( 'full' );
			expect( current.history ).toHaveLength( 1 );
			expect( ( await confirm( current ) ).ok() ).toBeTruthy();
			expect( ( await preview() ).history ).toHaveLength( 1 );
			expect(
				current.movements.filter( ( row ) => row.transaction_id )
			).toHaveLength( 2 );
			expect( current.bank_rows ).toHaveLength( 1 );
			const unmatched = await (
				await api.get( `${ ENTRIES }?unmatched=true&per_page=100`, {
					headers,
				} )
			).json();
			expect(
				unmatched.entries.map( ( entry ) => entry.id )
			).not.toContain( fixture.entry_id );
			const after = await (
				await api.get( '/wp-json/fair-e2e/v1/settlements/state', {
					headers,
				} )
			).json();
			expect( after.requests ).toBe( before.requests );
		} );
	}

	test( 'requires explicit context, detects mismatches, and never auto-selects ambiguous bank candidates', async () => {
		await seed();
		expect(
			( await preview( { entry_id: fixture.entry_id } ) ).can_partial
		).toBeFalsy();
		expect(
			( await preview( { ...selection(), currency: 'USD' } ) ).can_partial
		).toBeFalsy();
		const other = await post( ENTRIES, {
			amount: 38.55,
			entry_type: 'income',
			entry_date: '2026-05-02',
			description: 'Reconcile fixture RECONCILE.2605.01',
		} );
		expect( other.ok() ).toBeTruthy();
		const response = await api.get(
			`${ ROOT }/${ fixture.settlement_id }/candidates`,
			{ headers }
		);
		const candidates = await response.json();
		expect(
			candidates.filter( ( row ) => row.amount === '38.55' ).length
		).toBeGreaterThanOrEqual( 2 );
		expect( candidates[ 0 ].reasons.length ).toBeGreaterThan( 0 );
		expect( ( await preview( {} ) ).bank ).toBeNull();
	} );

	test( 'saves Partial and completes after a local payment arrives without reimport', async () => {
		await seed( { missing: true } );
		const incomplete = await preview();
		expect( incomplete.can_full ).toBeFalsy();
		expect( ( await confirm( incomplete ) ).status() ).toBe( 409 );
		expect(
			( await confirm( incomplete, { state: 'partial' } ) ).ok()
		).toBeTruthy();
		await post( FIXTURE, { action: 'arrive' } );
		const complete = await preview();
		expect( complete.revisions.csv.id ).toBe(
			String( fixture.revision_id )
		);
		expect( complete.decision.current_state ).toBe( 'needs_review' );
		expect( complete.can_full ).toBeTruthy();
		expect( ( await confirm( complete ) ).ok() ).toBeTruthy();
		expect( ( await preview() ).history ).toHaveLength( 2 );
	} );

	test( 'blocks unknown movements and ambiguous local references', async () => {
		await seed( { variant: 'unknown' } );
		expect( ( await preview() ).can_full ).toBeFalsy();
		await post( FIXTURE, { action: 'duplicate' } );
		const ambiguous = await preview();
		expect(
			ambiguous.movements.find(
				( row ) => row.payment_reference === 'tr_reconcile02'
			).transactions
		).toHaveLength( 2 );
		expect( ambiguous.can_full ).toBeFalsy();
	} );

	test( 'rejects stale previews and flags source changes without rewriting history', async () => {
		await seed();
		const initial = await preview();
		await post( FIXTURE, { action: 'arrive' } );
		expect( ( await confirm( initial ) ).status() ).toBe( 409 );
		await cleanup();
		await seed();
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		const before = await preview();
		await post( FIXTURE, {
			action: 'metadata',
			settlement_id: fixture.settlement_id,
		} );
		expect( ( await preview() ).decision.current_state ).toBe( 'full' );
		await post( FIXTURE, {
			action: 'source_change',
			settlement_id: fixture.settlement_id,
		} );
		const changed = await preview();
		expect( changed.decision.current_state ).toBe( 'needs_review' );
		expect( changed.history ).toEqual( before.history );
	} );

	test( 'preserves manual allocations and requires explicit adoption of compatible matches', async () => {
		await seed();
		const match = await post( `${ ENTRIES }/${ fixture.entry_id }/match`, {
			transaction_ids: fixture.transaction_ids,
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();
		const data = await preview();
		expect( data.adoption_required ).toBeTruthy();
		expect( data.bank_rows ).toHaveLength( 3 );
		expect( ( await confirm( data ) ).status() ).toBe( 409 );
		expect(
			( await confirm( data, { adopt_existing: true } ) ).ok()
		).toBeTruthy();
		expect( ( await preview() ).bank_rows ).toEqual( data.bank_rows );
		const unmatch = await api.delete(
			`${ ENTRIES }/${ fixture.entry_id }/match`,
			{ headers }
		);
		expect( unmatch.status() ).toBe( 409 );
	} );

	test( 'allocates only exact supported amounts and rolls back every write on failure', async () => {
		await seed( { variant: 'plain' } );
		const data = await preview();
		expect( data.allocation.supported ).toBeTruthy();
		await post( FIXTURE, { action: 'fail_write', enabled: true } );
		expect( ( await confirm( data, { allocate: true } ) ).status() ).toBe(
			500
		);
		await post( FIXTURE, { action: 'fail_write', enabled: false } );
		const unchanged = await preview();
		expect( unchanged.decision ).toBeNull();
		expect( unchanged.history ).toHaveLength( 0 );
		expect( unchanged.bank_rows ).toHaveLength( 1 );
		expect( unchanged.links ).toHaveLength( 0 );
		expect(
			( await confirm( unchanged, { allocate: true } ) ).ok()
		).toBeTruthy();
		expect( ( await preview() ).bank_rows ).toHaveLength( 3 );
	} );

	test( 'detects bank edits and deletion of linked transactions', async () => {
		await seed();
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		await post( FIXTURE, {
			action: 'delete_transaction',
			transaction_id: fixture.transaction_ids[ 0 ],
		} );
		expect( ( await preview() ).decision.current_state ).toBe(
			'needs_review'
		);
	} );

	test( 'finds later bank imports beyond the first hundred entries', async () => {
		await seed( { bank_padding: 105 } );
		const firstRevision = fixture.revision_id;
		const candidateResponse = await api.get(
			`${ ROOT }/${ fixture.settlement_id }/candidates`,
			{ headers }
		);
		const candidates = await candidateResponse.json();
		expect(
			candidates.find( ( row ) => Number( row.id ) === fixture.entry_id )
		).toBeTruthy();
		await api.delete( `${ ENTRIES }/${ fixture.entry_id }`, { headers } );
		expect( ( await preview() ).can_full ).toBeFalsy();
		const imported = await post( ENTRIES, {
			amount: 38.55,
			entry_type: 'income',
			entry_date: '2026-05-02',
			description: 'Reconcile fixture later bank import',
		} );
		fixture.entry_id = ( await imported.json() ).id;
		const later = await preview();
		expect( later.revisions.csv.id ).toBe( String( firstRevision ) );
		expect( later.can_full ).toBeTruthy();
		expect( ( await confirm( later ) ).ok() ).toBeTruthy();
	} );

	test( 'a later refund can reference a payment already matched to an earlier bank entry', async () => {
		await seed( { variant: 'refund' } );
		const earlier = await post( ENTRIES, {
			amount: 15,
			entry_type: 'income',
			entry_date: '2026-04-02',
			description: 'Reconcile fixture earlier payout',
		} );
		const earlierId = ( await earlier.json() ).id;
		expect(
			(
				await post( `${ ENTRIES }/${ earlierId }/match`, {
					transaction_id: fixture.transaction_ids[ 1 ],
				} )
			).ok()
		).toBeTruthy();
		const refund = await preview();
		expect( refund.can_full ).toBeTruthy();
		expect( refund.whole_transaction_ids ).not.toContain(
			fixture.transaction_ids[ 1 ]
		);
		expect( ( await confirm( refund ) ).ok() ).toBeTruthy();
	} );

	test( 'prevents duplicate movement membership and guards account convergence until release', async () => {
		await seed();
		const original = { ...fixture };
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		const accountResponse = await post(
			`/wp-json/fair-payments-connector/v1/settlements/accounts/${ fixture.account_id }/confirm`,
			{ organization_id: 'org_e2e0001' }
		);
		expect( accountResponse.status() ).toBe( 409 );
		await seed( {
			account_id: original.account_id,
			reuse_transactions: true,
		} );
		const duplicate = await preview();
		expect( duplicate.can_partial ).toBeFalsy();
		expect( duplicate.bank_issues.join( ' ' ) ).toContain(
			'another saved settlement'
		);
		fixture = original;
		expect(
			( await confirm( await preview(), { state: 'released' } ) ).ok()
		).toBeTruthy();
		expect( ( await preview() ).history ).toHaveLength( 2 );
		expect( ( await preview() ).decision ).toBeNull();
		const convergence = await post( FIXTURE, {
			action: 'converge',
			settlement_id: fixture.settlement_id,
		} );
		expect( convergence.ok(), await convergence.text() ).toBeTruthy();
		fixture.settlement_id = ( await convergence.json() ).settlement_id;
		expect( ( await preview() ).history ).toHaveLength( 2 );
	} );

	test( 'a bank edit or deletion marks the saved decision for review and keeps its evidence', async () => {
		await seed();
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		const original = await preview();
		const changed = await api.put( `${ ENTRIES }/${ fixture.entry_id }`, {
			headers,
			data: {
				amount: 38.54,
				entry_type: 'income',
				entry_date: '2026-05-02',
				description: 'Reconcile fixture bank edit',
			},
		} );
		expect( changed.ok() ).toBeTruthy();
		expect( ( await preview() ).decision.current_state ).toBe(
			'needs_review'
		);
		await api.delete( `${ ENTRIES }/${ fixture.entry_id }`, { headers } );
		const deleted = await preview();
		expect( deleted.decision.current_state ).toBe( 'needs_review' );
		expect( deleted.history ).toEqual( original.history );
		expect(
			( await confirm( deleted, { state: 'released' } ) ).ok()
		).toBeTruthy();
	} );

	test( 'requires administrator access and validates input', async () => {
		await seed();
		const anonymous = await api.post(
			`${ ROOT }/${ fixture.settlement_id }/preview`
		);
		expect( anonymous.status() ).toBe( 401 );
		expect(
			(
				await post( `${ ROOT }/${ fixture.settlement_id }/confirm`, {
					state: 'full',
				} )
			).status()
		).toBe( 400 );
		expect(
			( await post( `${ ROOT }/9999999/preview`, {} ) ).status()
		).toBe( 404 );
	} );
} );
