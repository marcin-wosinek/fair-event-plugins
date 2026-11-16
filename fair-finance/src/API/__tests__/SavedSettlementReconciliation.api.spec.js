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
	const allocations = ( data ) =>
		data.bank_rows
			.filter( ( row ) => Number( row.id ) !== fixture.entry_id )
			.map( ( row ) => ( {
				amount: row.amount,
				description: row.description,
				budget_id: row.budget_id,
				event_url: row.event_url,
				event_date_id: row.event_date_id,
			} ) );
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
			// An aggregate fee no longer prevents a split: it becomes an
			// explicit settlement-level row instead of being attributed.
			expect( data.allocation.status ).toBe( 'proposed' );
			expect( data.allocation.method ).toBe( 'settlement_deductions' );
			expect(
				data.allocation.rows.map( ( row ) => [ row.kind, row.amount ] )
			).toEqual( [
				[ 'transaction', '25.00' ],
				[ 'transaction', '15.00' ],
				[ 'settlement', '-1.45' ],
			] );
			const responses = await Promise.all( [
				confirm( data ),
				confirm( data ),
			] );
			for ( const response of responses )
				expect( response.ok(), await response.text() ).toBeTruthy();
			const current = await preview();
			expect( current.decision.current_state ).toBe( 'full' );
			const anonymousUnmatch = await api.delete(
				`${ ENTRIES }/${ fixture.entry_id }/match`
			);
			expect( anonymousUnmatch.status() ).toBe( 401 );
			expect( current.history ).toHaveLength( 1 );
			expect( ( await confirm( current ) ).ok() ).toBeTruthy();
			expect( ( await preview() ).history ).toHaveLength( 1 );
			expect(
				current.movements.filter( ( row ) => row.transaction_id )
			).toHaveLength( 2 );
			expect( allocations( current ) ).toEqual( [
				expect.objectContaining( {
					amount: '25.00',
					description: 'Reconcile fixture payment 1',
				} ),
				expect.objectContaining( {
					amount: '15.00',
					description: 'Reconcile fixture payment 2',
				} ),
				expect.objectContaining( {
					amount: '-1.45',
					description: 'Reconcile fixture aggregate fees',
					budget_id: null,
				} ),
			] );
			expect( current.allocation.status ).toBe( 'allocated' );
			expect(
				JSON.parse( current.history[ 0 ].reviewed ).allocation_ids
			).toHaveLength( 3 );
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
		// The manual match used the saved settlement's evidence for its split.
		expect( data.bank_rows ).toHaveLength( 4 );
		expect( data.allocation.status ).toBe( 'allocated' );
		expect( ( await confirm( data ) ).status() ).toBe( 409 );
		expect(
			( await confirm( data, { adopt_existing: true } ) ).ok()
		).toBeTruthy();
		expect( ( await preview() ).bank_rows ).toEqual( data.bank_rows );
		// The Entries screen learns of the protection before offering Unmatch.
		const entry = await api.get( `${ ENTRIES }/${ fixture.entry_id }`, {
			headers,
		} );
		expect( ( await entry.json() ).unmatch.settlement_protected ).toBe(
			true
		);
		const unmatch = await api.delete(
			`${ ENTRIES }/${ fixture.entry_id }/match`,
			{ headers }
		);
		expect( unmatch.status() ).toBe( 409 );
		expect( ( await unmatch.json() ).code ).toBe(
			'reconciliation_entry_in_use'
		);
	} );

	test( 'allocates only exact supported amounts and rolls back every write on failure', async () => {
		await seed( { variant: 'plain' } );
		const data = await preview();
		expect( data.allocation.status ).toBe( 'proposed' );
		expect( data.allocation.method ).toBe( 'transaction_net' );
		await post( FIXTURE, { action: 'fail_write', enabled: true } );
		expect( ( await confirm( data ) ).status() ).toBe( 500 );
		await post( FIXTURE, { action: 'fail_write', enabled: false } );
		const unchanged = await preview();
		expect( unchanged.decision ).toBeNull();
		expect( unchanged.history ).toHaveLength( 0 );
		expect( unchanged.bank_rows ).toHaveLength( 1 );
		expect( unchanged.links ).toHaveLength( 0 );
		expect( ( await confirm( unchanged ) ).ok() ).toBeTruthy();
		expect( ( await preview() ).bank_rows ).toHaveLength( 3 );
	} );

	test( 'a fee-bearing payout splits equivalently from settlement review and manual matching', async () => {
		await seed();
		const reviewed = await preview();
		expect( ( await confirm( reviewed ) ).ok() ).toBeTruthy();
		const fromSettlement = allocations( await preview() );
		await cleanup();
		await seed();
		// The bank-transfer screen and legacy CSV review both match through
		// this endpoint, with the selected or resolved transactions.
		const planned = await post(
			`${ ENTRIES }/${ fixture.entry_id }/match-preview`,
			{ transaction_ids: fixture.transaction_ids }
		);
		expect( ( await planned.json() ).status ).toBe( 'proposed' );
		const match = await post( `${ ENTRIES }/${ fixture.entry_id }/match`, {
			transaction_ids: fixture.transaction_ids,
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();
		const matched = await match.json();
		expect( matched.allocation.allocation_ids ).toHaveLength( 3 );
		expect( allocations( await preview() ) ).toEqual( fromSettlement );
		expect(
			(
				await post( `${ ENTRIES }/${ fixture.entry_id }/match`, {
					transaction_ids: fixture.transaction_ids,
				} )
			).ok()
		).toBeTruthy();
		expect( allocations( await preview() ) ).toEqual( fromSettlement );
	} );

	test( 'a manual match the evidence cannot explain stays unsplit with a reason', async () => {
		await seed();
		const created = await post( ENTRIES, {
			amount: 50,
			entry_type: 'income',
			entry_date: '2026-05-02',
			description: 'Reconcile fixture unexplained payout',
		} );
		const entryId = ( await created.json() ).id;
		const match = await post( `${ ENTRIES }/${ entryId }/match`, {
			transaction_ids: fixture.transaction_ids,
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();
		const { allocation, transaction_ids: linked } = await match.json();
		expect( allocation.status ).toBe( 'unsupported' );
		expect( allocation.reason ).toContain( '40.00' );
		expect( allocation.allocation_ids ).toEqual( [] );
		expect( linked.sort() ).toEqual(
			[ ...fixture.transaction_ids ].sort()
		);
		const entries = await (
			await api.get( `${ ENTRIES }?per_page=100`, { headers } )
		).json();
		expect(
			entries.entries.find( ( entry ) => entry.id === entryId )
				.children ?? []
		).toHaveLength( 0 );
	} );

	test( 'transaction-attributed fees explain the payout without subtracting the aggregate fee again', async () => {
		await seed( { transaction_fees: true } );
		const data = await preview();
		expect( data.allocation.method ).toBe( 'transaction_net' );
		expect( ( await confirm( data ) ).ok() ).toBeTruthy();
		expect(
			allocations( await preview() ).map( ( row ) => row.amount )
		).toEqual( [ '24.10', '14.45' ] );
	} );

	test( 'fractional-cent fees are allocated only as their exact whole-cent total', async () => {
		await seed( { variant: 'fractional' } );
		const data = await preview();
		expect( data.can_full ).toBeTruthy();
		expect( data.allocation.rows.map( ( row ) => row.amount ) ).toEqual( [
			'25.00',
			'15.00',
			'-1.45',
		] );
	} );

	test( 'a refund in the payout is a signed allocation of its own payment', async () => {
		await seed( { variant: 'refund' } );
		const data = await preview();
		expect( data.can_full ).toBeTruthy();
		expect( ( await confirm( data ) ).ok() ).toBeTruthy();
		expect( allocations( await preview() ) ).toEqual( [
			expect.objectContaining( { amount: '25.00' } ),
			expect.objectContaining( {
				amount: '-15.00',
				description: 'Refund: Reconcile fixture payment 2',
			} ),
		] );
	} );

	test( 'an already-confirmed unsplit entry is repaired once, keeping its association', async () => {
		await seed();
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		const unsplit = await api.delete(
			`${ ENTRIES }/${ fixture.entry_id }/split`,
			{ headers }
		);
		expect( unsplit.ok(), await unsplit.text() ).toBeTruthy();
		const missing = await preview();
		expect( missing.decision.state ).toBe( 'full' );
		expect( missing.allocation.status ).toBe( 'proposed' );
		const repairs = await Promise.all( [
			confirm( missing ),
			confirm( missing ),
		] );
		for ( const response of repairs )
			expect( response.ok(), await response.text() ).toBeTruthy();
		const repaired = await preview();
		expect( repaired.decision.current_state ).toBe( 'full' );
		expect( repaired.bank_rows ).toHaveLength( 4 );
		expect( repaired.history ).toHaveLength( 2 );
		expect(
			JSON.parse( repaired.history[ 1 ].reviewed ).allocation
		).toEqual(
			expect.objectContaining( { repair: true, status: 'proposed' } )
		);
		expect( ( await confirm( repaired ) ).ok() ).toBeTruthy();
		expect( ( await preview() ).bank_rows ).toHaveLength( 4 );
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

	const suggestions = async ( entryId, query = '' ) =>
		api.get(
			`/wp-json/fair-finance/v1/reconciliation/entries/${ entryId }/settlement-suggestions${ query }`,
			{ headers }
		);

	for ( const origin of [ 'api', 'csv' ] ) {
		test( `suggests a saved ${ origin } settlement for its bank entry from local data`, async () => {
			await seed( { origin } );
			const before = await (
				await api.get( '/wp-json/fair-e2e/v1/settlements/state', {
					headers,
				} )
			).json();
			const response = await suggestions( fixture.entry_id );
			expect( response.ok(), await response.text() ).toBeTruthy();
			const data = await response.json();
			const found = data.items.find(
				( row ) => row.id === fixture.settlement_id
			);
			expect( found ).toBeTruthy();
			// A CSV-only record is compared by its supported explanation.
			expect( found.amount ).toBe( '38.55' );
			expect( found.state ).toBeNull();
			expect( found.reasons ).toEqual(
				expect.arrayContaining( [
					'Payout reference appears in the bank description.',
					'The amount matches exactly.',
				] )
			);
			const after = await (
				await api.get( '/wp-json/fair-e2e/v1/settlements/state', {
					headers,
				} )
			).json();
			expect( after.requests ).toBe( before.requests );
		} );
	}

	test( 'exposes ambiguous suggestions, pages them, and hides settlements associated elsewhere', async () => {
		const first = { ...( await seed() ) };
		const second = { ...( await seed( { reuse_transactions: true } ) ) };
		const ranked = await ( await suggestions( first.entry_id ) ).json();
		const ids = ranked.items.map( ( row ) => row.id );
		expect( ids ).toEqual(
			expect.arrayContaining( [
				first.settlement_id,
				second.settlement_id,
			] )
		);
		expect( ranked.ambiguous ).toBeTruthy();
		const paged = await (
			await suggestions( first.entry_id, '?per_page=1&page=2' )
		).json();
		expect( paged.items ).toHaveLength( 1 );
		expect( paged.page ).toBe( 2 );
		expect( paged.pages ).toBe( ranked.total );
		expect( paged.items[ 0 ].id ).toBe( ranked.items[ 1 ].id );

		fixture = first;
		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		const remaining = await ( await suggestions( second.entry_id ) ).json();
		expect( remaining.items.map( ( row ) => row.id ) ).not.toContain(
			first.settlement_id
		);
		expect( ( await suggestions( first.entry_id ) ).status() ).toBe( 409 );
		// A proposal never replaces an existing association.
		const proposed = await preview( {
			...selection(),
			entry_id: second.entry_id,
		} );
		expect( proposed.can_partial ).toBeFalsy();
		expect( proposed.bank_issues ).toContain(
			'Release the existing bank association before selecting a different entry.'
		);
	} );

	test( 'shows settlement associations on the overview once, with their current state', async () => {
		await seed( { missing: true } );
		expect(
			( await confirm( await preview(), { state: 'partial' } ) ).ok()
		).toBeTruthy();
		const overview = async () =>
			(
				await api.get( '/wp-json/fair-finance/v1/reconciliation', {
					headers,
				} )
			).json();
		let data = await overview();
		let rows = data.matched_entries.filter(
			( row ) => row.id === fixture.entry_id
		);
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].transactions ).toHaveLength( 0 );
		expect( rows[ 0 ].settlement ).toMatchObject( {
			id: fixture.settlement_id,
			state: 'partial',
			current_state: 'partial',
		} );
		expect( data.unmatched_entries.map( ( row ) => row.id ) ).not.toContain(
			fixture.entry_id
		);

		await post( FIXTURE, { action: 'arrive' } );
		data = await overview();
		expect(
			data.matched_entries.find( ( row ) => row.id === fixture.entry_id )
				.settlement.current_state
		).toBe( 'needs_review' );

		expect( ( await confirm( await preview() ) ).ok() ).toBeTruthy();
		data = await overview();
		rows = data.matched_entries.filter(
			( row ) => row.id === fixture.entry_id
		);
		// Compatibility links and the settlement association share one row.
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].transactions ).toHaveLength( 2 );
		expect( rows[ 0 ].settlement.current_state ).toBe( 'full' );

		expect(
			( await confirm( await preview(), { state: 'released' } ) ).ok()
		).toBeTruthy();
		rows = ( await overview() ).matched_entries.filter(
			( row ) => row.id === fixture.entry_id
		);
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].settlement ).toBeNull();
	} );

	const recalculation = async () => {
		const response = await post(
			`${ ROOT }/${ fixture.settlement_id }/recalculate-preview`,
			{}
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return response.json();
	};
	const recalculate = ( data ) =>
		post( `${ ROOT }/${ fixture.settlement_id }/recalculate`, {
			fingerprint: data.fingerprint,
		} );
	const children = async () =>
		( await preview() ).bank_rows.filter(
			( row ) => Number( row.id ) !== fixture.entry_id
		);
	// A split created from gross payments and a combined cost row, before
	// the payment fees were recorded locally.
	const grossSplit = async () => {
		await seed( { origin: 'api', variant: 'compensation' } );
		const data = await preview();
		expect( data.can_full, JSON.stringify( data.issues ) ).toBeTruthy();
		expect( data.allocation.method ).toBe( 'settlement_deductions' );
		expect( data.allocation.reason ).toContain( 'no recorded Mollie fee' );
		expect( ( await confirm( data ) ).ok() ).toBeTruthy();
		const rows = await children();
		expect( rows.map( ( row ) => row.amount ) ).toEqual( [
			'25.00',
			'15.00',
			'-1.43',
		] );
		await post( FIXTURE, { action: 'record_fees' } );
		return rows;
	};

	test( 'net payments keep their recorded fees when the report lists a compensation', async () => {
		await seed( {
			origin: 'api',
			variant: 'compensation',
			transaction_fees: true,
		} );
		const data = await preview();
		expect( data.can_full, JSON.stringify( data.issues ) ).toBeTruthy();
		expect( data.explanation.net ).toBe( '38.57' );
		expect( data.allocation.status ).toBe( 'proposed' );
		expect( data.allocation.method ).toBe( 'transaction_net_adjustments' );
		expect(
			data.allocation.rows.map( ( row ) => [ row.kind, row.amount ] )
		).toEqual( [
			[ 'transaction', '24.10' ],
			[ 'transaction', '14.45' ],
			[ 'settlement', '0.02' ],
		] );
		expect( ( await confirm( data ) ).ok() ).toBeTruthy();
		expect( allocations( await preview() ) ).toEqual( [
			expect.objectContaining( { amount: '24.10' } ),
			expect.objectContaining( { amount: '14.45' } ),
			expect.objectContaining( {
				amount: '0.02',
				description: 'Reconcile fixture invoice compensation',
			} ),
		] );
	} );

	test( 'recalculates an existing split in place, keeping links, assignments and tags', async () => {
		const before = await grossSplit();
		const [ first, second, cost ] = before;
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( first.id ),
			tag: 'workshop',
		} );
		// Intentionally untagged, as #2341 allows.
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( second.id ),
			tag: null,
		} );
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( cost.id ),
			tag: 'fees',
		} );
		const untouched = await children();
		const { links } = await preview();
		const data = await recalculation();
		expect( data.status, JSON.stringify( data.reasons ) ).toBe(
			'proposed'
		);
		expect(
			data.changes.map( ( change ) => [
				Number( change.id ),
				change.action,
				change.proposed_amount,
				change.tag,
			] )
		).toEqual( [
			[ Number( first.id ), 'update', '24.10', 'workshop' ],
			[ Number( second.id ), 'update', '14.45', null ],
			[ Number( cost.id ), 'update', '0.02', 'fees' ],
		] );
		// Preview never writes.
		expect( await children() ).toEqual( untouched );
		const responses = await Promise.all( [
			recalculate( data ),
			recalculate( data ),
		] );
		for ( const response of responses )
			expect( response.ok(), await response.text() ).toBeTruthy();
		const after = await children();
		expect(
			after.map( ( row ) => [
				row.id,
				row.amount,
				row.tag,
				row.budget_id,
				row.event_url,
				row.description,
			] )
		).toEqual( [
			[
				first.id,
				'24.10',
				'workshop',
				first.budget_id,
				first.event_url,
				first.description,
			],
			[
				second.id,
				'14.45',
				null,
				second.budget_id,
				second.event_url,
				second.description,
			],
			[
				cost.id,
				'0.02',
				'fees',
				cost.budget_id,
				cost.event_url,
				'Reconcile fixture invoice compensation',
			],
		] );
		const current = await preview();
		expect( current.decision.current_state ).toBe( 'full' );
		expect( current.links ).toEqual( links );
		const recalculated = current.history.filter(
			( entry ) => entry.state === 'recalculated'
		);
		expect( recalculated ).toHaveLength( 1 );
		const reviewed = JSON.parse( recalculated[ 0 ].reviewed );
		expect( reviewed.recalculation.before ).toHaveLength( 3 );
		expect(
			reviewed.recalculation.after.map( ( row ) => row.tag )
		).toEqual( [ 'workshop', null, 'fees' ] );
		// Repeating is a no-op.
		const repeat = await recalculation();
		expect( repeat.status ).toBe( 'unchanged' );
		expect( ( await recalculate( repeat ) ).ok() ).toBeTruthy();
		expect(
			( await preview() ).history.filter(
				( entry ) => entry.state === 'recalculated'
			)
		).toHaveLength( 1 );
		expect( await children() ).toEqual( after );
	} );

	test( 'recalculation rejects stale previews and rolls back every write on failure', async () => {
		const before = await grossSplit();
		const data = await recalculation();
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( before[ 0 ].id ),
			tag: 'edited',
		} );
		const stale = await recalculate( data );
		expect( stale.status() ).toBe( 409 );
		expect( ( await stale.json() ).code ).toBe( 'reconciliation_stale' );
		const fresh = await recalculation();
		await post( FIXTURE, { action: 'fail_write', enabled: true } );
		expect( ( await recalculate( fresh ) ).status() ).toBe( 500 );
		await post( FIXTURE, { action: 'fail_write', enabled: false } );
		expect( ( await children() ).map( ( row ) => row.amount ) ).toEqual( [
			'25.00',
			'15.00',
			'-1.43',
		] );
		expect(
			( await preview() ).history.filter(
				( entry ) => entry.state === 'recalculated'
			)
		).toHaveLength( 0 );
		expect( ( await recalculate( fresh ) ).ok() ).toBeTruthy();
	} );

	test( 'recalculation warns about edited amounts and blocks manual or ambiguous splits', async () => {
		const before = await grossSplit();
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( before[ 0 ].id ),
			amount: '20.00',
		} );
		await post( FIXTURE, {
			action: 'categorize',
			entry_id: Number( before[ 2 ].id ),
			amount: '3.57',
		} );
		const warned = await recalculation();
		expect( warned.status ).toBe( 'proposed' );
		expect( warned.warnings.join( ' ' ) ).toContain( '20.00' );
		await post( FIXTURE, {
			action: 'add_child',
			entry_id: fixture.entry_id,
		} );
		const blocked = await recalculation();
		expect( blocked.status ).toBe( 'blocked' );
		expect( blocked.reasons.join( ' ' ) ).toContain( 'added after' );
		const refused = await recalculate( blocked );
		expect( refused.status() ).toBe( 409 );
		expect( await children() ).toHaveLength( 4 );
	} );

	const saveSplit = ( rows ) =>
		api.put( `${ ENTRIES }/${ fixture.entry_id }/split`, {
			headers,
			data: { allocations: rows },
		} );
	const editorRows = ( rows, keepIds ) =>
		rows.map( ( row ) => ( {
			...( keepIds ? { id: Number( row.id ) } : {} ),
			amount: Number( row.amount ),
			description: row.description,
			budget_id: row.budget_id ? Number( row.budget_id ) : null,
			event_url: row.event_url,
			event_date_id: row.event_date_id
				? Number( row.event_date_id )
				: null,
		} ) );
	const categorize = async ( rows, tags ) => {
		for ( const [ index, tag ] of tags.entries() )
			await post( FIXTURE, {
				action: 'categorize',
				entry_id: Number( rows[ index ].id ),
				tag,
			} );
	};

	test( 'ordinary split saves keep allocation IDs, tags and reconciliation identity', async () => {
		const before = await grossSplit();
		// Intentionally untagged second allocation, as #2341 allows.
		await categorize( before, [ 'workshop', null, 'fees' ] );
		const edited = editorRows( before, true );
		edited[ 0 ].event_url = 'https://example.test/workshop';
		const saved = await saveSplit( edited );
		expect( saved.ok(), await saved.text() ).toBeTruthy();
		const after = await children();
		expect(
			after.map( ( row ) => [
				row.id,
				row.amount,
				row.tag,
				row.event_url,
			] )
		).toEqual( [
			[
				before[ 0 ].id,
				'25.00',
				'workshop',
				'https://example.test/workshop',
			],
			[ before[ 1 ].id, '15.00', null, before[ 1 ].event_url ],
			[ before[ 2 ].id, '-1.43', 'fees', before[ 2 ].event_url ],
		] );
		// Invalid IDs are rejected without changing anything.
		const duplicate = await saveSplit( [
			edited[ 0 ],
			{ ...edited[ 1 ], id: edited[ 0 ].id },
			edited[ 2 ],
		] );
		expect( duplicate.status() ).toBe( 400 );
		expect( ( await duplicate.json() ).code ).toBe(
			'rest_duplicate_allocation_id'
		);
		const foreign = await saveSplit( [
			edited[ 0 ],
			{ ...edited[ 1 ], id: fixture.entry_id },
			edited[ 2 ],
		] );
		expect( foreign.status() ).toBe( 400 );
		expect( ( await foreign.json() ).code ).toBe(
			'rest_invalid_allocation_id'
		);
		expect( await children() ).toEqual( after );
		// Reconciliation still identifies every allocation directly.
		const data = await recalculation();
		expect( data.status, JSON.stringify( data.reasons ) ).toBe(
			'proposed'
		);
		expect( data.recovered ).toEqual( [] );
		expect( ( await recalculate( data ) ).ok() ).toBeTruthy();
		expect(
			( await children() ).map( ( row ) => [
				row.id,
				row.amount,
				row.tag,
			] )
		).toEqual( [
			[ before[ 0 ].id, '24.10', 'workshop' ],
			[ before[ 1 ].id, '14.45', null ],
			[ before[ 2 ].id, '0.02', 'fees' ],
		] );
		// A later ordinary save keeps the recalculated identity.
		expect(
			( await saveSplit( editorRows( await children(), true ) ) ).ok()
		).toBeTruthy();
		expect( ( await recalculation() ).status ).toBe( 'unchanged' );
	} );

	test( 'recalculation recovers allocations recreated by a legacy split save', async () => {
		const before = await grossSplit();
		const original = ( await preview() ).history.map(
			( entry ) => entry.reviewed
		);
		// The editor used to send no IDs, so every allocation was recreated.
		const legacy = await saveSplit( editorRows( before, false ) );
		expect( legacy.ok(), await legacy.text() ).toBeTruthy();
		const recreated = await children();
		expect( recreated.map( ( row ) => row.id ) ).not.toEqual(
			before.map( ( row ) => row.id )
		);
		await categorize( recreated, [ 'workshop', null, 'fees' ] );
		const untouched = await children();
		const data = await recalculation();
		expect( data.status, JSON.stringify( data.reasons ) ).toBe(
			'proposed'
		);
		expect(
			data.recovered.map( ( item ) => [ item.id, item.history_id ] )
		).toEqual(
			recreated.map( ( row, index ) => [
				Number( row.id ),
				Number( before[ index ].id ),
			] )
		);
		expect(
			data.changes.map( ( change ) => [
				Number( change.id ),
				change.recovered_from,
				change.proposed_amount,
				change.tag,
			] )
		).toEqual( [
			[
				Number( recreated[ 0 ].id ),
				Number( before[ 0 ].id ),
				'24.10',
				'workshop',
			],
			[
				Number( recreated[ 1 ].id ),
				Number( before[ 1 ].id ),
				'14.45',
				null,
			],
			[
				Number( recreated[ 2 ].id ),
				Number( before[ 2 ].id ),
				'0.02',
				'fees',
			],
		] );
		// Preview never writes.
		expect( await children() ).toEqual( untouched );
		expect( ( await recalculate( data ) ).ok() ).toBeTruthy();
		expect(
			( await children() ).map( ( row ) => [
				row.id,
				row.amount,
				row.tag,
			] )
		).toEqual( [
			[ recreated[ 0 ].id, '24.10', 'workshop' ],
			[ recreated[ 1 ].id, '14.45', null ],
			[ recreated[ 2 ].id, '0.02', 'fees' ],
		] );
		const history = ( await preview() ).history;
		// Earlier history is never rewritten.
		expect(
			history
				.filter( ( entry ) => entry.state !== 'recalculated' )
				.map( ( entry ) => entry.reviewed )
		).toEqual( original );
		const recalculated = history.filter(
			( entry ) => entry.state === 'recalculated'
		);
		expect( recalculated ).toHaveLength( 1 );
		const reviewed = JSON.parse( recalculated[ 0 ].reviewed );
		expect( reviewed.recalculation.recovered ).toEqual( data.recovered );
		expect( reviewed.allocation_ids ).toEqual(
			recreated.map( ( row ) => Number( row.id ) )
		);
		// Repeating needs no recovery and changes nothing.
		const repeat = await recalculation();
		expect( repeat.status ).toBe( 'unchanged' );
		expect( repeat.recovered ).toEqual( [] );
	} );

	test( 'recreated allocations whose amounts changed stay blocked', async () => {
		const before = await grossSplit();
		const rows = editorRows( before, false );
		rows[ 0 ].amount = 24;
		rows[ 1 ].amount = 16;
		expect( ( await saveSplit( rows ) ).ok() ).toBeTruthy();
		const blocked = await recalculation();
		expect( blocked.status ).toBe( 'blocked' );
		expect( blocked.recovered ).toEqual( [] );
		expect( blocked.reasons.join( ' ' ) ).toContain( 'added after' );
		expect( blocked.reasons.join( ' ' ) ).toContain( 'no longer exists' );
		const untouched = await children();
		expect( ( await recalculate( blocked ) ).status() ).toBe( 409 );
		expect( await children() ).toEqual( untouched );
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
		expect(
			(
				await api.get(
					`/wp-json/fair-finance/v1/reconciliation/entries/${ fixture.entry_id }/settlement-suggestions`
				)
			).status()
		).toBe( 401 );
		expect( ( await suggestions( 9999999 ) ).status() ).toBe( 404 );
	} );
} );
