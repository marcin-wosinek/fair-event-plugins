/**
 * Playwright API tests for split-allocation validation (#2435).
 *
 * POST and PUT /fair-finance/v1/financial-entries/{id}/split share one
 * allocation check: at least two allocations, each nonzero, adding up to the
 * original entry amount within a 0.01 float tolerance. Editing additionally
 * rejects duplicate and foreign allocation IDs. A rejected request must
 * leave the entry and its allocations unchanged.
 */

import { test, expect } from '@playwright/test';
import { splitFixtures } from './helpers/split-fixtures.js';

const COUNT_ERROR = {
	code: 'rest_invalid_allocations',
	message: 'At least 2 allocations are required.',
};
const ZERO_ERROR = {
	code: 'rest_invalid_allocation_amount',
	message: 'Each allocation amount must be nonzero.',
};
const MISMATCH_ERROR = {
	code: 'rest_allocation_mismatch',
	message: 'Total allocations must match the original entry amount.',
};

// Shared by POST and PUT; amounts are for a 100.00 entry.
const INVALID_ALLOCATIONS = [
	[ 'an empty array', [], COUNT_ERROR ],
	[ 'a single allocation', [ { amount: 100 } ], COUNT_ERROR ],
	[ 'a zero amount', [ { amount: 100 }, { amount: 0 } ], ZERO_ERROR ],
	[
		'a zero amount before a mismatch',
		[ { amount: 0 }, { amount: 5 } ],
		ZERO_ERROR,
	],
	[
		'a total above the tolerance',
		[ { amount: 60 }, { amount: 40.02 } ],
		MISMATCH_ERROR,
	],
	[
		'a total below the entry amount',
		[ { amount: 60 }, { amount: 39.98 } ],
		MISMATCH_ERROR,
	],
];

test.describe( 'Split allocation validation (#2435)', () => {
	const STAMP = Date.now().toString( 36 );
	const TAG = `split-validation-${ STAMP }`;
	const fixtures = splitFixtures( {
		entry_date: '2033-06-06',
		description: `Split validation entry ${ STAMP }`,
		tag: TAG,
	} );
	const { split, focused } = fixtures;
	const createEntry = ( amount = 100 ) => fixtures.createEntry( { amount } );

	const createSplit = async ( amounts = [ 60, 40 ] ) => {
		const id = await createEntry(
			amounts.reduce( ( sum, amount ) => sum + amount, 0 )
		);
		const res = await split(
			id,
			amounts.map( ( amount, index ) => ( {
				amount,
				description: `Part ${ index + 1 }`,
			} ) )
		);
		expect( res.status(), await res.text() ).toBe( 201 );
		const entry = await focused( id );
		return { id, childIds: entry.children.map( ( child ) => child.id ) };
	};

	const expectRejected = async ( res, expected ) => {
		expect( res.status(), await res.text() ).toBe( 400 );
		expect( await res.json() ).toMatchObject( expected );
	};

	test.beforeAll( () => fixtures.open() );
	test.afterAll( () => fixtures.close() );

	test( 'POST rejects invalid allocations without changing the entry', async () => {
		const id = await createEntry();
		const before = await focused( id );
		expect( before.children || [] ).toHaveLength( 0 );

		for ( const [ label, allocations, expected ] of INVALID_ALLOCATIONS ) {
			await test.step( label, async () => {
				await expectRejected(
					await split( id, allocations ),
					expected
				);
			} );
		}

		const after = await focused( id );
		expect( after ).toEqual( before );
		expect( after.tag ).toBe( TAG );
		expect( after.children || [] ).toHaveLength( 0 );
	} );

	test( 'PUT rejects invalid allocations without changing the split', async () => {
		const { id, childIds } = await createSplit();
		const before = await focused( id );

		for ( const [ label, allocations, expected ] of INVALID_ALLOCATIONS ) {
			await test.step( label, async () => {
				// Existing IDs keep the request otherwise valid for an edit.
				const withIds = allocations.map( ( allocation, index ) =>
					childIds[ index ]
						? { ...allocation, id: childIds[ index ] }
						: allocation
				);
				await expectRejected(
					await split( id, withIds, 'put' ),
					expected
				);
			} );
		}

		expect( await focused( id ) ).toEqual( before );
	} );

	test( 'PUT rejects duplicate and foreign allocation IDs without changing either split', async () => {
		const target = await createSplit();
		const other = await createSplit( [ 30, 70 ] );
		const targetBefore = await focused( target.id );
		const otherBefore = await focused( other.id );

		await expectRejected(
			await split(
				target.id,
				[
					{ id: target.childIds[ 0 ], amount: 50 },
					{ id: target.childIds[ 0 ], amount: 50 },
				],
				'put'
			),
			{
				code: 'rest_duplicate_allocation_id',
				message: 'Each existing allocation can be listed only once.',
			}
		);

		await expectRejected(
			await split(
				target.id,
				[
					{ id: target.childIds[ 0 ], amount: 50 },
					{ id: other.childIds[ 0 ], amount: 50 },
				],
				'put'
			),
			{
				code: 'rest_invalid_allocation_id',
				message:
					'An allocation does not belong to this entry. Reload the entry and edit its split again.',
			}
		);

		expect( await focused( target.id ) ).toEqual( targetBefore );
		expect( await focused( other.id ) ).toEqual( otherBefore );
	} );

	test( 'POST and PUT apply the same 0.01 float tolerance', async () => {
		// Each case: entry amount, allocations, expected acceptance. The
		// "nominal" cases both differ by one cent in decimal arithmetic but
		// land on opposite sides of the float comparison; the refactor keeps
		// today's results for both.
		const cases = [
			[ 'below one cent', 100, [ 60, 39.995 ], true ],
			[ 'nominally one cent, float below', 0.1, [ 0.05, 0.06 ], true ],
			[ 'nominally one cent, float above', 1, [ 0.5, 0.49 ], false ],
			[ 'above one cent', 100, [ 60, 39.98 ], false ],
		];

		for ( const [ label, amount, amounts, accepted ] of cases ) {
			await test.step( `POST ${ label }`, async () => {
				const id = await createEntry( amount );
				const res = await split(
					id,
					amounts.map( ( value ) => ( { amount: value } ) )
				);
				if ( accepted ) {
					expect( res.status(), await res.text() ).toBe( 201 );
				} else {
					await expectRejected( res, MISMATCH_ERROR );
					expect(
						( await focused( id ) ).children || []
					).toHaveLength( 0 );
				}
			} );

			await test.step( `PUT ${ label }`, async () => {
				// Start from a valid two-way split of the same amount.
				const id = await createEntry( amount );
				expect(
					(
						await split( id, [
							{ amount: amount / 2 },
							{ amount: amount / 2 },
						] )
					).status()
				).toBe( 201 );
				const before = await focused( id );
				const res = await split(
					id,
					amounts.map( ( value, index ) => ( {
						id: before.children[ index ].id,
						amount: value,
					} ) ),
					'put'
				);
				if ( accepted ) {
					expect( res.status(), await res.text() ).toBe( 200 );
				} else {
					await expectRejected( res, MISMATCH_ERROR );
					expect( await focused( id ) ).toEqual( before );
				}
			} );
		}
	} );

	test( 'accepts signed allocations and keeps submitted IDs on edit', async () => {
		const id = await createEntry();

		let res = await split( id, [ { amount: 120 }, { amount: -20 } ] );
		expect( res.status(), await res.text() ).toBe( 201 );
		const childIds = ( await res.json() ).children.map(
			( child ) => child.id
		);
		expect( childIds ).toHaveLength( 2 );
		expect(
			( await focused( id ) ).children.map( ( child ) => child.amount )
		).toEqual( [ 120, -20 ] );

		res = await split(
			id,
			[
				{ id: childIds[ 0 ], amount: 130 },
				{ id: childIds[ 1 ], amount: -30 },
			],
			'put'
		);
		expect( res.status(), await res.text() ).toBe( 200 );
		const children = ( await focused( id ) ).children;
		expect( children.map( ( child ) => child.id ) ).toEqual( childIds );
		expect( children.map( ( child ) => child.amount ) ).toEqual( [
			130, -30,
		] );
	} );
} );
