/**
 * Playwright API tests for Connected Site budget resolution during
 * reconciliation (#1612):
 *  - GET /fair-finance/v1/reconciliation exposes each unmatched
 *    transaction's connected_site_id and resolved source_budget_id, so the
 *    admin UI can propose a budget without a second round trip.
 *  - POST /fair-finance/v1/financial-entries/{id}/match applies an
 *    administrator-reviewed budget_id, never overwriting an entry that
 *    already has one, and never on a repeated match.
 *
 * A transaction imported from a Connected Site carries connected_site_id in
 * metadata rather than a real column (see Transaction::import()).
 * `POST /wp-json/fair-e2e/v1/test-transactions` (e2e/mu-plugins/fair-e2e-
 * support.php) writes that same metadata shape directly — the test-only-
 * support pattern TESTING.md documents — so this suite can exercise real
 * ConnectedSiteBudgetResolver lookups without a live remote import.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'FinancialEntryController — Connected Site budget resolution (#1612)', () => {
	let api;
	const budgetIds = [];
	const siteIds = [];
	const transactionIds = [];
	const entryIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const entryId of entryIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/financial-entries/${ entryId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const transactionId of transactionIds ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/test-transactions?id=${ transactionId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const siteId of siteIds ) {
			await api.delete(
				`/wp-json/fair-payments-connector/v1/admin/connected-sites/${ siteId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const budgetId of budgetIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	const createBudget = async () => {
		const res = await api.post( '/wp-json/fair-finance/v1/budgets', {
			headers: adminHeaders,
			data: {
				name: `Site reconciliation test ${ Date.now() }-${ Math.random() }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const budgetId = ( await res.json() ).id;
		budgetIds.push( budgetId );
		return budgetId;
	};

	const createSite = async ( budgetId = null ) => {
		const res = await api.post(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{
				headers: adminHeaders,
				data: {
					label: `Site ${ Date.now() }-${ Math.random() }`,
					base_url: 'https://example.test',
					token: 'test-token',
					budget_id: budgetId,
				},
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const site = await res.json();
		siteIds.push( site.id );
		return site.id;
	};

	const createTransaction = async ( {
		amount = 20,
		connectedSiteId = null,
	} = {} ) => {
		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: adminHeaders,
			data: {
				amount,
				connected_site_id: connectedSiteId,
				description: `Site reconciliation transaction ${ Date.now() }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const transactionId = ( await res.json() ).id;
		transactionIds.push( transactionId );
		return transactionId;
	};

	const createBankEntry = async ( amount, budgetId = null ) => {
		const res = await api.post(
			'/wp-json/fair-finance/v1/financial-entries',
			{
				headers: adminHeaders,
				data: {
					amount,
					entry_type: 'income',
					entry_date: '2026-01-01',
					description: 'Settlement payout',
					budget_id: budgetId,
				},
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const entryId = ( await res.json() ).id;
		entryIds.push( entryId );
		return entryId;
	};

	const getReconciliationTransaction = async ( transactionId ) => {
		const res = await api.get( '/wp-json/fair-finance/v1/reconciliation', {
			headers: adminHeaders,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const body = await res.json();
		return body.unmatched_transactions.find(
			( t ) => t.id === transactionId
		);
	};

	test( 'GET /reconciliation resolves a Connected Site transaction’s source budget', async () => {
		const budgetId = await createBudget();
		const siteId = await createSite( budgetId );
		const txId = await createTransaction( { connectedSiteId: siteId } );

		const tx = await getReconciliationTransaction( txId );
		expect( tx.connected_site_id ).toBe( siteId );
		expect( tx.source_budget_id ).toBe( budgetId );
	} );

	test( 'GET /reconciliation resolves no budget for an unlinked site or a local transaction', async () => {
		const siteId = await createSite();
		const txFromUnbudgetedSite = await createTransaction( {
			connectedSiteId: siteId,
		} );
		const txLocal = await createTransaction();

		const fromSite =
			await getReconciliationTransaction( txFromUnbudgetedSite );
		expect( fromSite.source_budget_id ).toBeNull();

		const local = await getReconciliationTransaction( txLocal );
		expect( local.connected_site_id ).toBeNull();
		expect( local.source_budget_id ).toBeNull();
	} );

	test( 'a reviewed budget_id is applied to a single-transaction match on an unbudgeted entry', async () => {
		const budgetId = await createBudget();
		const siteId = await createSite( budgetId );
		const txId = await createTransaction( {
			amount: 15,
			connectedSiteId: siteId,
		} );
		const entryId = await createBankEntry( 15 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_id: txId, budget_id: budgetId },
			}
		);
		expect( matchRes.ok(), await matchRes.text() ).toBeTruthy();
		expect( ( await matchRes.json() ).budget_id ).toBe( budgetId );
	} );

	test( 'a reviewed budget_id is never applied when the entry already has a budget', async () => {
		const existingBudgetId = await createBudget();
		const proposedBudgetId = await createBudget();
		const siteId = await createSite( proposedBudgetId );
		const txId = await createTransaction( {
			amount: 9,
			connectedSiteId: siteId,
		} );
		const entryId = await createBankEntry( 9, existingBudgetId );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_id: txId, budget_id: proposedBudgetId },
			}
		);
		expect( matchRes.ok(), await matchRes.text() ).toBeTruthy();
		expect( ( await matchRes.json() ).budget_id ).toBe( existingBudgetId );
	} );

	test( 'an explicit null reviewed budget_id leaves a new match unbudgeted', async () => {
		const budgetId = await createBudget();
		const siteId = await createSite( budgetId );
		const txId = await createTransaction( {
			amount: 7,
			connectedSiteId: siteId,
		} );
		const entryId = await createBankEntry( 7 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_id: txId, budget_id: null },
			}
		);
		expect( matchRes.ok(), await matchRes.text() ).toBeTruthy();
		expect( ( await matchRes.json() ).budget_id ).toBeNull();
	} );

	test( 'a reviewed budget_id applies uniformly to every allocation of a new multi-transaction split', async () => {
		const commonBudgetId = await createBudget();
		const siteA = await createSite( commonBudgetId );
		const siteB = await createSite( await createBudget() );

		const txOne = await createTransaction( {
			amount: 10,
			connectedSiteId: siteA,
		} );
		const txTwo = await createTransaction( {
			amount: 12,
			connectedSiteId: siteB,
		} );
		const entryId = await createBankEntry( 22 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: {
					transaction_ids: [ txOne, txTwo ],
					budget_id: commonBudgetId,
				},
			}
		);
		expect( matchRes.ok(), await matchRes.text() ).toBeTruthy();

		const getRes = await api.get(
			'/wp-json/fair-finance/v1/financial-entries?per_page=100',
			{ headers: adminHeaders }
		);
		const parent = ( await getRes.json() ).entries.find(
			( e ) => e.id === entryId
		);
		expect( parent.children ).toHaveLength( 2 );
		parent.children.forEach( ( child ) => {
			expect( child.budget_id ).toBe( commonBudgetId );
		} );
	} );

	test( 'an invalid reviewed budget_id is rejected', async () => {
		const txId = await createTransaction( { amount: 5 } );
		const entryId = await createBankEntry( 5 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_id: txId, budget_id: 999999999 },
			}
		);
		expect( matchRes.status() ).toBe( 400 );
	} );
} );
