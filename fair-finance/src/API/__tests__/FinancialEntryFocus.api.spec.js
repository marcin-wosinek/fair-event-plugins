/**
 * Playwright API tests for the focused single-entry view (#1291).
 *
 * GET /fair-finance/v1/financial-entries?entry_id=N and
 * GET /fair-finance/v1/financial-entries/totals?entry_id=N narrow the list
 * and its totals to one entry. Focus takes precedence over the other
 * filters, surfaces split children (normally hidden under their parent), and
 * counts a split parent once by its own amount.
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
const TOTALS = `${ ENTRIES }/totals`;

test.describe( 'FinancialEntry focused view', () => {
	let api;
	let plainId;
	let parentId;
	let childIds;

	const createEntry = async ( data ) => {
		const res = await api.post( ENTRIES, {
			headers,
			data: { entry_date: '2026-03-10', ...data },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).id;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		plainId = await createEntry( {
			amount: 12.5,
			entry_type: 'income',
			description: 'Focus test plain entry',
		} );

		parentId = await createEntry( {
			amount: 100,
			entry_type: 'cost',
			description: 'Focus test split parent',
		} );
		const split = await api.post( `${ ENTRIES }/${ parentId }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 60, description: 'Focus test child A' },
					{ amount: 40, description: 'Focus test child B' },
				],
			},
		} );
		expect( split.status() ).toBe( 201 );
		childIds = ( await split.json() ).children.map( ( c ) => c.id );
		expect( childIds ).toHaveLength( 2 );
	} );

	test.afterAll( async () => {
		for ( const id of [ plainId, parentId ] ) {
			if ( id ) {
				await api.delete( `${ ENTRIES }/${ id }`, { headers } );
			}
		}
		await api.dispose();
	} );

	test( 'returns only the focused entry and its totals', async () => {
		const res = await api.get( `${ ENTRIES }?entry_id=${ plainId }`, {
			headers,
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( body.entries.map( ( e ) => e.id ) ).toEqual( [ plainId ] );
		expect( body.total ).toBe( 1 );
		expect( body.pages ).toBe( 1 );

		const totals = await (
			await api.get( `${ TOTALS }?entry_id=${ plainId }`, { headers } )
		).json();
		expect( totals ).toEqual( {
			total_cost: 0,
			total_income: 12.5,
			balance: 12.5,
		} );
	} );

	test( 'surfaces a split child alone, with its parent for editing', async () => {
		const [ childId, siblingId ] = childIds;
		const body = await (
			await api.get( `${ ENTRIES }?entry_id=${ childId }`, { headers } )
		).json();

		expect( body.entries.map( ( e ) => e.id ) ).toEqual( [ childId ] );
		expect( body.entries[ 0 ].parent_entry_id ).toBe( parentId );
		expect( body.entries[ 0 ].parent.id ).toBe( parentId );
		expect( body.entries.map( ( e ) => e.id ) ).not.toContain( siblingId );

		const totals = await (
			await api.get( `${ TOTALS }?entry_id=${ childId }`, { headers } )
		).json();
		expect( totals.total_cost ).toBe( 60 );
	} );

	test( 'keeps a split parent with its children and counts it once', async () => {
		const body = await (
			await api.get( `${ ENTRIES }?entry_id=${ parentId }`, { headers } )
		).json();

		expect( body.entries.map( ( e ) => e.id ) ).toEqual( [ parentId ] );
		expect(
			body.entries[ 0 ].children.map( ( c ) => c.id ).sort()
		).toEqual( [ ...childIds ].sort() );

		const totals = await (
			await api.get( `${ TOTALS }?entry_id=${ parentId }`, { headers } )
		).json();
		expect( totals ).toEqual( {
			total_cost: 100,
			total_income: 0,
			balance: -100,
		} );
	} );

	test( 'takes precedence over the other filters', async () => {
		const query = `entry_id=${ plainId }&entry_type=cost&budget_id=none&date_from=2030-01-01`;
		const body = await (
			await api.get( `${ ENTRIES }?${ query }`, { headers } )
		).json();
		expect( body.entries.map( ( e ) => e.id ) ).toEqual( [ plainId ] );

		const totals = await (
			await api.get( `${ TOTALS }?${ query }`, { headers } )
		).json();
		expect( totals.total_income ).toBe( 12.5 );
	} );

	test( 'returns an empty result for a missing entry', async () => {
		const missing = 2147483000;
		const body = await (
			await api.get( `${ ENTRIES }?entry_id=${ missing }`, { headers } )
		).json();
		expect( body ).toEqual( { entries: [], total: 0, pages: 0 } );

		const totals = await (
			await api.get( `${ TOTALS }?entry_id=${ missing }`, { headers } )
		).json();
		expect( totals ).toEqual( {
			total_cost: 0,
			total_income: 0,
			balance: 0,
		} );
	} );

	for ( const invalid of [ '0', '-1', 'abc', '1.5' ] ) {
		test( `rejects entry_id=${ invalid } with 400`, async () => {
			for ( const route of [ ENTRIES, TOTALS ] ) {
				const res = await api.get(
					`${ route }?entry_id=${ encodeURIComponent( invalid ) }`,
					{ headers }
				);
				expect( res.status() ).toBe( 400 );
				expect( ( await res.json() ).code ).toBe(
					'rest_invalid_param'
				);
			}
		} );
	}

	test( 'still hides split children and rolls up children when unfocused', async () => {
		const body = await (
			await api.get(
				`${ ENTRIES }?date_from=2026-03-10&date_to=2026-03-10&per_page=100`,
				{ headers }
			)
		).json();
		const ids = body.entries.map( ( e ) => e.id );
		expect( ids ).toContain( parentId );
		for ( const childId of childIds ) {
			expect( ids ).not.toContain( childId );
		}

		// Unfocused totals count the children (60 + 40), never the parent too.
		const totals = await (
			await api.get(
				`${ TOTALS }?date_from=2026-03-10&date_to=2026-03-10`,
				{
					headers,
				}
			)
		).json();
		const expectedCost = body.entries
			.filter( ( e ) => e.entry_type === 'cost' )
			.reduce( ( sum, e ) => sum + Number( e.amount ), 0 );
		expect( totals.total_cost ).toBeCloseTo( expectedCost, 2 );
	} );

	test( 'requires authentication', async () => {
		for ( const route of [ ENTRIES, TOTALS ] ) {
			const res = await api.get( `${ route }?entry_id=${ plainId }` );
			expect( res.status() ).toBe( 401 );
		}
	} );
} );
