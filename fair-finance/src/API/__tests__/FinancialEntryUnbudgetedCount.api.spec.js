/**
 * Playwright API tests for the count of entries awaiting a budget (#2088).
 *
 * GET /fair-finance/v1/financial-entries/unbudgeted-count returns
 * `{ count }`: standalone entries and split allocations without a budget,
 * across every entry type and date. Split parents are excluded, because
 * their allocations are counted instead.
 *
 * The count covers the whole ledger, so other specs' leftovers are part of
 * it. Every assertion compares against a baseline read in the same test.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const basicAuth = ( user, password ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ user }:${ password }` ).toString(
		'base64'
	) }`,
} );
const headers = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const COUNT = `${ ENTRIES }/unbudgeted-count`;
const BUDGETS = '/wp-json/fair-finance/v1/budgets';

test.describe( 'FinancialEntry unbudgeted count', () => {
	let api;
	let budgetId;
	const entryIds = [];

	const getCount = async () => {
		const res = await api.get( COUNT, { headers } );
		expect( res.status(), await res.text() ).toBe( 200 );
		const body = await res.json();
		expect( Object.keys( body ) ).toEqual( [ 'count' ] );
		expect( Number.isInteger( body.count ) ).toBe( true );
		expect( body.count ).toBeGreaterThanOrEqual( 0 );
		return body.count;
	};

	const entryPayload = ( data ) => ( {
		entry_date: '2026-03-10',
		entry_type: 'cost',
		amount: 10,
		description: 'Unbudgeted count test entry',
		...data,
	} );

	const createEntry = async ( data ) => {
		const res = await api.post( ENTRIES, {
			headers,
			data: entryPayload( data ),
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const id = ( await res.json() ).id;
		entryIds.push( id );
		return id;
	};

	const updateEntry = async ( id, data ) => {
		const res = await api.put( `${ ENTRIES }/${ id }`, {
			headers,
			data: entryPayload( data ),
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.post( BUDGETS, {
			headers,
			data: { name: `Unbudgeted count ${ Date.now() }` },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		budgetId = ( await res.json() ).id;
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		}
		if ( budgetId ) {
			await api.delete( `${ BUDGETS }/${ budgetId }`, { headers } );
		}
		await api.dispose();
	} );

	test( 'counts unbudgeted entries of every type and date, not budgeted ones', async () => {
		const before = await getCount();

		await createEntry( { entry_type: 'cost', entry_date: '2019-01-01' } );
		await createEntry( { entry_type: 'income', entry_date: '2031-12-31' } );
		await createEntry( { budget_id: budgetId } );

		expect( await getCount() ).toBe( before + 2 );
	} );

	test( 'counts unbudgeted split allocations and excludes the split parent', async () => {
		const before = await getCount();

		const parentId = await createEntry( { amount: 100 } );
		expect( await getCount() ).toBe( before + 1 );

		const split = await api.post( `${ ENTRIES }/${ parentId }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 50, budget_id: budgetId },
					{ amount: 30 },
					{ amount: 20 },
				],
			},
		} );
		expect( split.status(), await split.text() ).toBe( 201 );

		// The parent no longer counts; its two unbudgeted allocations do.
		expect( await getCount() ).toBe( before + 2 );

		// Unsplitting removes the allocations and the parent counts again.
		const unsplit = await api.delete( `${ ENTRIES }/${ parentId }/split`, {
			headers,
		} );
		expect( unsplit.ok(), await unsplit.text() ).toBeTruthy();
		expect( await getCount() ).toBe( before + 1 );
	} );

	test( 'excludes a split parent whose allocations are all budgeted', async () => {
		const before = await getCount();

		const parentId = await createEntry( { amount: 40 } );
		const split = await api.post( `${ ENTRIES }/${ parentId }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 25, budget_id: budgetId },
					{ amount: 15, budget_id: budgetId },
				],
			},
		} );
		expect( split.status(), await split.text() ).toBe( 201 );

		expect( await getCount() ).toBe( before );
	} );

	test( 'follows assigning and removing a budget', async () => {
		const id = await createEntry( {} );
		const unassigned = await getCount();

		await updateEntry( id, { budget_id: budgetId } );
		expect( await getCount() ).toBe( unassigned - 1 );

		await updateEntry( id, {} );
		expect( await getCount() ).toBe( unassigned );

		const deleted = await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		expect( deleted.ok() ).toBeTruthy();
		expect( await getCount() ).toBe( unassigned - 1 );
	} );

	test( 'requires a logged-in administrator', async () => {
		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		expect( ( await anonymous.get( COUNT ) ).status() ).toBe( 401 );
		await anonymous.dispose();

		const username = `unbudgeted-count-subscriber-${ Date.now() }`;
		const password = 'Unbudgeted-count-test-2088!';
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok(), await userRes.text() ).toBeTruthy();
		const userId = ( await userRes.json() ).id;
		try {
			const res = await api.get( COUNT, {
				headers: basicAuth( username, password ),
			} );
			expect( res.status() ).toBe( 403 );
		} finally {
			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers }
			);
		}
	} );
} );
