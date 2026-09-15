/**
 * Playwright API tests for event-budget resolution during reconciliation
 * (#1608): POST /fair-finance/v1/financial-entries/{id}/match preselects
 * each allocation's budget from the event its payment links to.
 *
 * Real transactions with a local `event_date_id` column (as opposed to the
 * metadata-only link an imported/remote transaction carries) can only be
 * produced today by a genuine Mollie payment, which this environment's
 * Mollie double is e2e-only (see EventSignupLedgerResolution.api.spec.js).
 * `POST /wp-json/fair-e2e/v1/test-transactions` (e2e/mu-plugins/fair-e2e-
 * support.php) inserts that row shape directly — the same test-only-support
 * pattern TESTING.md documents for capturing mail / replacing external
 * services — so this suite can exercise real EventBudgetResolver lookups
 * without a live payment.
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

test.describe( 'FinancialEntryController — event budget resolution on match', () => {
	let api;
	const postIds = [];
	const eventDateIds = [];
	const budgetIds = [];
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
		for ( const budgetId of budgetIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const eventDateId of eventDateIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const postId of postIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
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
				name: `Reconciliation test ${ Date.now() }-${ Math.random() }`,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const budgetId = ( await res.json() ).id;
		budgetIds.push( budgetId );
		return budgetId;
	};

	/**
	 * Create a fair_event post plus its linked event date, optionally linking
	 * it to a budget.
	 */
	const createEventWithBudget = async ( budgetId = null ) => {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Reconciliation event ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const ensureRes = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect( ensureRes.ok() ).toBeTruthy();
		const eventDateId = ( await ensureRes.json() ).id;
		eventDateIds.push( eventDateId );

		if ( budgetId ) {
			const budgetRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
				{ headers: adminHeaders, data: { budget_id: budgetId } }
			);
			expect( budgetRes.ok() ).toBeTruthy();
		}

		return eventDateId;
	};

	const createTransaction = async ( {
		amount = 20,
		eventDateId = null,
	} = {} ) => {
		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: adminHeaders,
			data: {
				amount,
				event_date_id: eventDateId,
				description: `Reconciliation transaction ${ Date.now() }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const transactionId = ( await res.json() ).id;
		transactionIds.push( transactionId );
		return transactionId;
	};

	const createBankEntry = async ( amount ) => {
		const res = await api.post(
			'/wp-json/fair-finance/v1/financial-entries',
			{
				headers: adminHeaders,
				data: {
					amount,
					entry_type: 'income',
					entry_date: '2026-01-01',
					description: 'Settlement payout',
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		const entryId = ( await res.json() ).id;
		entryIds.push( entryId );
		return entryId;
	};

	/**
	 * Fetch a parent entry with its `children` array embedded (the shape
	 * GET /financial-entries returns for an unsplit-filter query).
	 */
	const getEntryWithChildren = async ( entryId ) => {
		const res = await api.get(
			// 100 is the endpoint's schema maximum (get_collection_params()).
			'/wp-json/fair-finance/v1/financial-entries?per_page=100',
			{ headers: adminHeaders }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const body = await res.json();
		return body.entries.find( ( entry ) => entry.id === entryId );
	};

	test( 'a multi-transaction split preselects each allocation from its own event budget', async () => {
		const budgetId = await createBudget();
		const budgetedEventId = await createEventWithBudget( budgetId );
		const unbudgetedEventId = await createEventWithBudget();

		const txBudgeted = await createTransaction( {
			amount: 10,
			eventDateId: budgetedEventId,
		} );
		const txUnbudgeted = await createTransaction( {
			amount: 15,
			eventDateId: unbudgetedEventId,
		} );
		const txNoLink = await createTransaction( { amount: 5 } );

		const entryId = await createBankEntry( 30 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: {
					transaction_ids: [ txBudgeted, txUnbudgeted, txNoLink ],
				},
			}
		);
		expect( matchRes.ok(), await matchRes.text() ).toBeTruthy();

		const entry = await getEntryWithChildren( entryId );
		expect( entry.children ).toHaveLength( 3 );

		const byEventDateId = ( id ) =>
			entry.children.find( ( child ) => child.event_date_id === id );

		expect( byEventDateId( budgetedEventId ).budget_id ).toBe( budgetId );
		expect( byEventDateId( unbudgetedEventId ).budget_id ).toBeNull();

		const noLinkChild = entry.children.find(
			( child ) => null === child.event_date_id
		);
		expect( noLinkChild ).toBeTruthy();
		expect( noLinkChild.budget_id ).toBeNull();
	} );

	test( 'repeated allocations for the same event all get that event’s budget', async () => {
		const budgetId = await createBudget();
		const eventDateId = await createEventWithBudget( budgetId );

		const txOne = await createTransaction( { amount: 10, eventDateId } );
		const txTwo = await createTransaction( { amount: 12, eventDateId } );

		const entryId = await createBankEntry( 22 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_ids: [ txOne, txTwo ] },
			}
		);
		expect( matchRes.ok() ).toBeTruthy();

		const entry = await getEntryWithChildren( entryId );
		expect( entry.children ).toHaveLength( 2 );
		entry.children.forEach( ( child ) => {
			expect( child.budget_id ).toBe( budgetId );
			expect( child.event_date_id ).toBe( eventDateId );
		} );
	} );

	test( 'a deleted budget resolves to no budget on the allocation', async () => {
		const budgetId = await createBudget();
		const eventDateId = await createEventWithBudget( budgetId );

		const deleteRes = await api.delete(
			`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.ok() ).toBeTruthy();
		budgetIds.splice( budgetIds.indexOf( budgetId ), 1 );

		const txOne = await createTransaction( { amount: 8, eventDateId } );
		const txTwo = await createTransaction( { amount: 9 } );
		const entryId = await createBankEntry( 17 );

		const matchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_ids: [ txOne, txTwo ] },
			}
		);
		expect( matchRes.ok() ).toBeTruthy();

		const entry = await getEntryWithChildren( entryId );
		const child = entry.children.find(
			( c ) => c.event_date_id === eventDateId
		);
		expect( child.budget_id ).toBeNull();
	} );

	test( 're-matching an already-split entry never rewrites a budget the user picked', async () => {
		const budgetId = await createBudget();
		const eventDateId = await createEventWithBudget( budgetId );
		const otherBudgetId = await createBudget();

		const txOne = await createTransaction( { amount: 6, eventDateId } );
		const txTwo = await createTransaction( { amount: 7 } );
		const entryId = await createBankEntry( 13 );

		await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_ids: [ txOne, txTwo ] },
			}
		);

		const firstSplit = await getEntryWithChildren( entryId );
		const editedChild = firstSplit.children.find(
			( c ) => c.event_date_id === eventDateId
		);
		expect( editedChild.budget_id ).toBe( budgetId );

		// Simulate the organiser overriding the preselected budget.
		const overrideRes = await api.put(
			`/wp-json/fair-finance/v1/financial-entries/${ editedChild.id }`,
			{
				headers: adminHeaders,
				data: {
					amount: editedChild.amount,
					entry_type: editedChild.entry_type,
					entry_date: editedChild.entry_date,
					budget_id: otherBudgetId,
				},
			}
		);
		expect( overrideRes.ok(), await overrideRes.text() ).toBeTruthy();

		// Re-running the match (e.g. reprocessing the same settlement) must
		// leave the organiser's override in place.
		const rematchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ entryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_ids: [ txOne, txTwo ] },
			}
		);
		expect( rematchRes.ok() ).toBeTruthy();

		const afterRematch = await getEntryWithChildren( entryId );
		const stillEditedChild = afterRematch.children.find(
			( c ) => c.id === editedChild.id
		);
		expect( stillEditedChild.budget_id ).toBe( otherBudgetId );
	} );

	test( 'a single-transaction match seeds an empty budget but never overwrites an existing one', async () => {
		const budgetId = await createBudget();
		const eventDateId = await createEventWithBudget( budgetId );
		const preExistingBudgetId = await createBudget();

		const txForEmptyEntry = await createTransaction( {
			amount: 11,
			eventDateId,
		} );
		const txForBudgetedEntry = await createTransaction( {
			amount: 12,
			eventDateId,
		} );

		const emptyEntryId = await createBankEntry( 11 );
		const budgetedEntryId = await createBankEntry( 12 );

		// Give the second entry a budget before it's ever matched.
		await api.put(
			`/wp-json/fair-finance/v1/financial-entries/${ budgetedEntryId }`,
			{
				headers: adminHeaders,
				data: {
					amount: 12,
					entry_type: 'income',
					entry_date: '2026-01-01',
					budget_id: preExistingBudgetId,
				},
			}
		);

		const emptyMatchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ emptyEntryId }/match`,
			{ headers: adminHeaders, data: { transaction_id: txForEmptyEntry } }
		);
		expect( emptyMatchRes.ok() ).toBeTruthy();
		expect( ( await emptyMatchRes.json() ).budget_id ).toBe( budgetId );

		const budgetedMatchRes = await api.post(
			`/wp-json/fair-finance/v1/financial-entries/${ budgetedEntryId }/match`,
			{
				headers: adminHeaders,
				data: { transaction_id: txForBudgetedEntry },
			}
		);
		expect( budgetedMatchRes.ok() ).toBeTruthy();
		expect( ( await budgetedMatchRes.json() ).budget_id ).toBe(
			preExistingBudgetId
		);
	} );
} );
