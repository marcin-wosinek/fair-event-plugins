/**
 * Playwright API tests for unmatching an entry from all its transactions
 * (#1986):
 *  - GET /fair-finance/v1/financial-entries/{id} lists every association
 *    unmatching would remove — junction links, a legacy-column link, and
 *    links whose transaction record is gone — plus settlement protection.
 *  - DELETE /fair-finance/v1/financial-entries/{id}/match clears both the
 *    junction links and the legacy column, persists, and repeats safely.
 *
 * Protected settlement associations are covered in
 * SavedSettlementReconciliation.api.spec.js.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';
const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'FinancialEntryController — unmatching (#1986)', () => {
	let api;
	const transactionIds = [];
	const entryIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const entryId of entryIds ) {
			await api.delete( `${ ENTRIES }/${ entryId }`, {
				headers: adminHeaders,
			} );
		}
		for ( const transactionId of transactionIds ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/test-transactions?id=${ transactionId }`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	const createTransaction = async ( amount ) => {
		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: adminHeaders,
			data: {
				amount,
				description: `Unmatch transaction ${ Date.now() }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const transactionId = ( await res.json() ).id;
		transactionIds.push( transactionId );
		return transactionId;
	};

	const createEntry = async ( amount, extra = {} ) => {
		const res = await api.post( ENTRIES, {
			headers: adminHeaders,
			data: {
				amount,
				entry_type: 'income',
				entry_date: '2026-01-01',
				description: 'Unmatch payout',
				...extra,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const entryId = ( await res.json() ).id;
		entryIds.push( entryId );
		return entryId;
	};

	const getEntry = async ( entryId ) => {
		const res = await api.get( `${ ENTRIES }/${ entryId }`, {
			headers: adminHeaders,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const unmatch = ( entryId, headers = adminHeaders ) =>
		api.delete( `${ ENTRIES }/${ entryId }/match`, { headers } );

	test( 'lists every linked transaction, then removes them all persistently', async () => {
		const first = await createTransaction( 10 );
		const second = await createTransaction( 15 );
		const entryId = await createEntry( 25 );
		const match = await api.post( `${ ENTRIES }/${ entryId }/match`, {
			headers: adminHeaders,
			data: { transaction_ids: [ first, second ] },
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();

		const before = await getEntry( entryId );
		expect( before.unmatch.settlement_protected ).toBe( false );
		expect(
			before.unmatch.transactions.map( ( t ) => [ t.id, t.amount ] )
		).toEqual( [
			[ first, 10 ],
			[ second, 15 ],
		] );

		const res = await unmatch( entryId );
		expect( res.ok(), await res.text() ).toBeTruthy();

		// A fresh read, as after a reload, shows no association left.
		const after = await getEntry( entryId );
		expect( after.transaction_ids ).toEqual( [] );
		expect( after.transaction_id ).toBeNull();
		expect( after.unmatch.transactions ).toEqual( [] );

		// Repeating is a harmless no-op, so a retry after a lost response is safe.
		const again = await unmatch( entryId );
		expect( again.ok(), await again.text() ).toBeTruthy();
	} );

	test( 'includes a legacy-column link and clears it', async () => {
		const transactionId = await createTransaction( 30 );
		const entryId = await createEntry( 30, {
			transaction_id: transactionId,
		} );

		const before = await getEntry( entryId );
		expect( before.transaction_ids ).toEqual( [] );
		expect( before.unmatch.transactions.map( ( t ) => t.id ) ).toEqual( [
			transactionId,
		] );

		expect( ( await unmatch( entryId ) ).ok() ).toBeTruthy();
		expect( ( await getEntry( entryId ) ).transaction_id ).toBeNull();
	} );

	test( 'reports a link whose transaction record is gone instead of omitting it', async () => {
		const kept = await createTransaction( 5 );
		const gone = await createTransaction( 7 );
		const entryId = await createEntry( 12 );
		const match = await api.post( `${ ENTRIES }/${ entryId }/match`, {
			headers: adminHeaders,
			data: { transaction_ids: [ kept, gone ] },
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();
		await api.delete(
			`/wp-json/fair-e2e/v1/test-transactions?id=${ gone }`,
			{
				headers: adminHeaders,
			}
		);

		const { unmatch: details } = await getEntry( entryId );
		expect( details.transactions ).toContainEqual( {
			id: gone,
			missing: true,
		} );
		expect(
			details.transactions.find( ( t ) => t.id === kept ).missing
		).toBe( false );
	} );

	test( 'returns 404 for a missing entry and refuses anonymous requests', async () => {
		expect( ( await unmatch( 999999999 ) ).status() ).toBe( 404 );

		const transactionId = await createTransaction( 8 );
		const entryId = await createEntry( 8, {
			transaction_id: transactionId,
		} );
		const anonymous = await unmatch( entryId, {} );
		expect( [ 401, 403 ] ).toContain( anonymous.status() );
		expect( ( await getEntry( entryId ) ).transaction_id ).toBe(
			transactionId
		);
	} );
} );
