/**
 * Playwright API tests for the Unbudgeted entries filter (#2343).
 *
 * GET /fair-finance/v1/financial-entries?budget_id=none lists a split
 * parent only when at least one of its allocations has no budget, and an
 * unsplit entry only when it has no budget itself. Each eligible parent
 * appears once with all of its allocations, and `total` / `pages` count the
 * listed rows.
 *
 * Every entry sits on a date no other spec uses, and each request narrows
 * the list to that date, so other specs' leftovers never interfere.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
	'base64'
);
const headers = { Authorization: `Basic ${ adminAuth }` };

const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const BUDGETS = '/wp-json/fair-finance/v1/budgets';

// One day per test, so the tests stay independent of each other.
const DAYS = {
	eligibility: '2017-06-19',
	budgetChanges: '2017-06-20',
	pagination: '2017-06-21',
	combined: '2017-06-22',
};

test.describe( 'FinancialEntry Unbudgeted filter', () => {
	let api;
	let budgetId;
	const entryIds = [];

	const createEntry = async ( day, data = {} ) => {
		const res = await api.post( ENTRIES, {
			headers,
			data: {
				entry_date: day,
				entry_type: 'cost',
				amount: 10,
				description: 'Unbudgeted filter test entry',
				...data,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const id = ( await res.json() ).id;
		entryIds.push( id );
		return id;
	};

	const split = async ( parentId, allocations, method = 'post' ) => {
		const res = await api[ method ]( `${ ENTRIES }/${ parentId }/split`, {
			headers,
			data: { allocations },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return ( await res.json() ).children.map( ( child ) => child.id );
	};

	const createSplit = async ( day, allocations ) => {
		const amount = allocations.reduce( ( sum, a ) => sum + a.amount, 0 );
		const parentId = await createEntry( day, { amount } );
		const childIds = await split( parentId, allocations );
		return { parentId, childIds };
	};

	const list = async ( day, params = {} ) => {
		const query = new URLSearchParams( {
			budget_id: 'none',
			date_from: day,
			date_to: day,
			per_page: '50',
			...params,
		} );
		const res = await api.get( `${ ENTRIES }?${ query }`, { headers } );
		expect( res.status(), await res.text() ).toBe( 200 );
		return res.json();
	};

	const listedIds = async ( day, params ) =>
		( await list( day, params ) ).entries.map( ( entry ) => entry.id );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.post( BUDGETS, {
			headers,
			data: { name: `Unbudgeted filter ${ Date.now() }` },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		budgetId = ( await res.json() ).id;
	} );

	test.afterAll( async () => {
		// Deleting a parent also removes its allocations.
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		}
		if ( budgetId ) {
			await api.delete( `${ BUDGETS }/${ budgetId }`, { headers } );
		}
		await api.dispose();
	} );

	test( 'lists splits with an unbudgeted allocation and unbudgeted ordinary entries', async () => {
		const day = DAYS.eligibility;

		const fully = await createSplit( day, [
			{ amount: 30, budget_id: budgetId },
			{ amount: 20, budget_id: budgetId },
		] );
		const partially = await createSplit( day, [
			{ amount: 30, budget_id: budgetId },
			{ amount: 15 },
			{ amount: 5 },
		] );
		const entirely = await createSplit( day, [
			{ amount: 25 },
			{ amount: 25 },
		] );
		const budgeted = await createEntry( day, { budget_id: budgetId } );
		const unbudgeted = await createEntry( day );

		const body = await list( day );
		const ids = body.entries.map( ( entry ) => entry.id );

		expect( ids.sort() ).toEqual(
			[ partially.parentId, entirely.parentId, unbudgeted ].sort()
		);
		expect( ids ).not.toContain( fully.parentId );
		expect( ids ).not.toContain( budgeted );
		expect( body.total ).toBe( 3 );
		expect( body.pages ).toBe( 1 );

		// Allocations are listed under their parent, never as rows.
		for ( const childId of [
			...fully.childIds,
			...partially.childIds,
			...entirely.childIds,
		] ) {
			expect( ids ).not.toContain( childId );
		}

		// An eligible parent carries every allocation, budgeted or not.
		const partialRow = body.entries.find(
			( entry ) => entry.id === partially.parentId
		);
		expect(
			partialRow.children.map( ( child ) => child.id ).sort()
		).toEqual( [ ...partially.childIds ].sort() );
		expect(
			partialRow.children.filter( ( child ) => child.budget_id )
		).toHaveLength( 1 );

		const ordinaryRow = body.entries.find(
			( entry ) => entry.id === unbudgeted
		);
		expect( ordinaryRow.children ).toBeUndefined();
	} );

	test( 'follows assigning and removing allocation budgets', async () => {
		const day = DAYS.budgetChanges;

		const { parentId } = await createSplit( day, [
			{ amount: 30, budget_id: budgetId },
			{ amount: 20 },
		] );
		expect( await listedIds( day ) ).toEqual( [ parentId ] );

		// Budgeting the last unbudgeted allocation removes the split.
		await split(
			parentId,
			[
				{ amount: 30, budget_id: budgetId },
				{ amount: 20, budget_id: budgetId },
			],
			'put'
		);
		const emptied = await list( day );
		expect( emptied.entries ).toEqual( [] );
		expect( emptied.total ).toBe( 0 );
		expect( emptied.pages ).toBe( 0 );

		// Removing an allocation's budget brings it back, with every allocation.
		const childIds = await split(
			parentId,
			[ { amount: 30, budget_id: budgetId }, { amount: 20 } ],
			'put'
		);
		const restored = await list( day );
		expect( restored.entries.map( ( entry ) => entry.id ) ).toEqual( [
			parentId,
		] );
		expect( restored.total ).toBe( 1 );
		expect(
			restored.entries[ 0 ].children.map( ( child ) => child.id ).sort()
		).toEqual( [ ...childIds ].sort() );
	} );

	test( 'paginates eligible rows once each', async () => {
		const day = DAYS.pagination;

		const expected = [];
		for ( let i = 0; i < 2; i++ ) {
			const { parentId } = await createSplit( day, [
				{ amount: 10, budget_id: budgetId },
				{ amount: 5 },
				{ amount: 5 },
			] );
			expected.push( parentId );
			await createSplit( day, [
				{ amount: 10, budget_id: budgetId },
				{ amount: 10, budget_id: budgetId },
			] );
			expected.push( await createEntry( day ) );
		}
		await createEntry( day, { budget_id: budgetId } );

		const seen = [];
		for ( const page of [ 1, 2, 3 ] ) {
			const body = await list( day, {
				per_page: '2',
				page: String( page ),
			} );
			expect( body.total ).toBe( 4 );
			expect( body.pages ).toBe( 2 );
			expect( body.entries ).toHaveLength( page < 3 ? 2 : 0 );
			seen.push( ...body.entries.map( ( entry ) => entry.id ) );
		}

		expect( new Set( seen ).size ).toBe( seen.length );
		expect( seen.sort() ).toEqual( expected.sort() );
	} );

	test( 'keeps focused-entry precedence and standalone allocations under tag filters', async () => {
		const day = DAYS.combined;
		const tag = `unbudgeted-filter-${ Date.now() }`;

		const fully = await createSplit( day, [
			{ amount: 30, budget_id: budgetId, tag },
			{ amount: 20, budget_id: budgetId, tag },
		] );
		const partially = await createSplit( day, [
			{ amount: 30, budget_id: budgetId, tag },
			{ amount: 20, tag },
		] );
		const taggedOrdinary = await createEntry( day, { tag } );
		await createEntry( day, { tag, budget_id: budgetId } );

		// A focused entry wins over the Unbudgeted filter.
		const focused = await list( day, {
			entry_id: String( fully.parentId ),
		} );
		expect( focused.entries.map( ( entry ) => entry.id ) ).toEqual( [
			fully.parentId,
		] );
		expect( focused.total ).toBe( 1 );

		// With a tag filter, matching unbudgeted allocations stay standalone
		// rows; split parents carry no tag of their own.
		const tagged = await list( day, { tag } );
		const ids = tagged.entries.map( ( entry ) => entry.id );
		expect( ids.sort() ).toEqual(
			[ partially.childIds[ 1 ], taggedOrdinary ].sort()
		);
		expect( tagged.total ).toBe( 2 );
		const allocationRow = tagged.entries.find(
			( entry ) => entry.id === partially.childIds[ 1 ]
		);
		expect( allocationRow.parent.id ).toBe( partially.parentId );
	} );
} );
