/**
 * Playwright API tests for creating a transfer between budgets (#1802):
 *   POST /fair-finance/v1/financial-entries/transfer
 *
 * Sends the payload the Create Transfer dialog on Fair Audience's Fee Detail
 * sends: with a description, and with the description left out when the
 * field is empty. Also covers who may create a transfer and that both sides
 * must be different budgets.
 *
 * Two budgets are created through the admin REST API; they and the transfers
 * are removed at the end of the suite.
 */

import { test, expect, request } from '@playwright/test';

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

const TRANSFER_ROUTE = '/wp-json/fair-finance/v1/financial-entries/transfer';

test.describe( 'FinancialEntryController: creating a transfer', () => {
	let api;
	let sourceBudgetId;
	let targetBudgetId;
	const entryIds = [];

	const createBudget = async ( name ) => {
		const res = await api.post( '/wp-json/fair-finance/v1/budgets', {
			headers: adminHeaders,
			data: { name },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return ( await res.json() ).id;
	};

	/** The dialog's payload; `overrides` adds or replaces fields. */
	const transferPayload = ( overrides = {} ) => ( {
		amount: 25,
		entry_date: '2026-10-12',
		source_budget_id: sourceBudgetId,
		target_budget_id: targetBudgetId,
		participant_id: 101,
		...overrides,
	} );

	const postTransfer = ( data, headers = adminHeaders ) =>
		api.post( TRANSFER_ROUTE, { headers, data } );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const stamp = Date.now();
		sourceBudgetId = await createBudget( `Transfer Source ${ stamp }` );
		targetBudgetId = await createBudget( `Transfer Target ${ stamp }` );
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/financial-entries/${ id }`,
				{ headers: adminHeaders }
			);
		}
		for ( const id of [ sourceBudgetId, targetBudgetId ] ) {
			if ( id ) {
				await api.delete( `/wp-json/fair-finance/v1/budgets/${ id }`, {
					headers: adminHeaders,
				} );
			}
		}
		await api.dispose();
	} );

	test( 'only an administrator can create a transfer', async () => {
		const anonymous = await postTransfer( transferPayload(), {} );
		expect( anonymous.status() ).toBe( 401 );
	} );

	test( 'a transfer with a description moves the amount from the source to the target budget', async () => {
		const res = await postTransfer(
			transferPayload( { description: 'Membership 2026 — Ada Example' } )
		);
		expect( res.status(), await res.text() ).toBe( 201 );

		const entry = await res.json();
		entryIds.push( entry.id );
		expect( entry.entry_type ).toBe( 'transfer' );
		expect( Number( entry.amount ) ).toBe( 25 );
		expect( entry.description ).toBe( 'Membership 2026 — Ada Example' );
		expect( Number( entry.participant_id ) ).toBe( 101 );

		const side = ( type ) =>
			entry.children.find( ( child ) => child.entry_type === type );
		expect( entry.children ).toHaveLength( 2 );
		expect( Number( side( 'cost' ).budget_id ) ).toBe( sourceBudgetId );
		expect( Number( side( 'income' ).budget_id ) ).toBe( targetBudgetId );
		expect( Number( side( 'cost' ).amount ) ).toBe( 25 );
		expect( Number( side( 'income' ).amount ) ).toBe( 25 );
	} );

	test( 'a transfer without a description is created', async () => {
		const res = await postTransfer( transferPayload() );
		expect( res.status(), await res.text() ).toBe( 201 );

		const entry = await res.json();
		entryIds.push( entry.id );
		expect( entry.entry_type ).toBe( 'transfer' );
		expect( entry.description || '' ).toBe( '' );
		expect( entry.children ).toHaveLength( 2 );
	} );

	test( 'the same budget on both sides is rejected', async () => {
		const res = await postTransfer(
			transferPayload( { target_budget_id: sourceBudgetId } )
		);
		expect( res.status() ).toBe( 400 );
		expect( ( await res.json() ).code ).toBe( 'rest_same_budget' );
	} );
} );
