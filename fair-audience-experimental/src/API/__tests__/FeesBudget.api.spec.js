/**
 * Playwright API tests for the budget a membership fee is linked to (#1802):
 *   GET  /fair-finance/v1/budgets
 *   POST /fair-audience/v1/fees
 *   GET  /fair-audience/v1/fees, /fair-audience/v1/fees/{id}
 *   PUT  /fair-audience/v1/fees/{id}
 *
 * Covers who may list budgets, creating a fee with and without a budget,
 * reading the link back by ID and by name, keeping it through an update that
 * does not mention it, moving it to another budget, clearing it with an
 * explicit null, refusing a budget that is not a positive integer ID, and
 * reading fees while the Fair Finance budgets table is missing — the stored
 * link stays, only the name is unavailable.
 *
 * Fixtures (two budgets, a group and the fees) are created through the admin
 * REST API and removed at the end of the suite. The budgets table is hidden
 * and restored by e2e/mu-plugins/fair-e2e-fee-budgets.php.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

function basicAuth( user, password ) {
	return {
		Authorization:
			'Basic ' +
			Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
	};
}

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

test.describe( 'FeesController: the budget a fee is linked to', () => {
	let api;
	let groupId;
	let budgetId;
	let budgetName;
	let otherBudgetId;
	let otherBudgetName;
	const feeIds = [];

	const adminPost = async ( path, data ) => {
		const res = await api.post( `/wp-json${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	const adminGet = async ( path ) => {
		const res = await api.get( `/wp-json${ path }`, {
			headers: adminHeaders,
		} );
		expect( res.ok(), `${ path }: ${ await res.text() }` ).toBeTruthy();
		return res.json();
	};

	const createFee = async ( data ) => {
		const fee = await adminPost( '/fair-audience/v1/fees', {
			name: `Budget Fee ${ Date.now() }-${ feeIds.length }`,
			group_id: groupId,
			amount: 25,
			...data,
		} );
		feeIds.push( fee.id );
		return fee.id;
	};

	const updateFee = ( feeId, data ) =>
		api.put( `/wp-json/fair-audience/v1/fees/${ feeId }`, {
			headers: adminHeaders,
			data,
		} );

	const listedFee = async ( feeId ) =>
		( await adminGet( '/fair-audience/v1/fees' ) ).find(
			( row ) => Number( row.id ) === feeId
		);

	const setBudgetsTablePresent = async ( present ) => {
		const body = await adminPost(
			'/fair-e2e/v1/fee-budgets/finance-table',
			{
				present,
			}
		);
		expect( body.present ).toBe( present );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// An interrupted earlier run may have left the table hidden.
		await setBudgetsTablePresent( true );

		budgetName = `Fee Budget ${ Date.now() }`;
		budgetId = (
			await adminPost( '/fair-finance/v1/budgets', {
				name: budgetName,
			} )
		).id;
		otherBudgetName = `Other Fee Budget ${ Date.now() }`;
		otherBudgetId = (
			await adminPost( '/fair-finance/v1/budgets', {
				name: otherBudgetName,
			} )
		).id;
		groupId = (
			await adminPost( '/fair-audience/v1/groups', {
				name: `Fee Budget Members ${ Date.now() }`,
			} )
		).id;
	} );

	test.afterAll( async () => {
		await api.post( '/wp-json/fair-e2e/v1/fee-budgets/finance-table', {
			headers: adminHeaders,
			data: { present: true },
		} );
		for ( const id of feeIds ) {
			await api.delete( `/wp-json/fair-audience/v1/fees/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( groupId ) {
			await api.delete( `/wp-json/fair-audience/v1/groups/${ groupId }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of [ budgetId, otherBudgetId ] ) {
			if ( id ) {
				await api.delete( `/wp-json/fair-finance/v1/budgets/${ id }`, {
					headers: adminHeaders,
				} );
			}
		}
		await api.dispose();
	} );

	test( 'only an administrator can list budgets', async () => {
		const anonymous = await api.get( '/wp-json/fair-finance/v1/budgets' );
		expect( anonymous.status() ).toBe( 401 );

		const username = `fee-budget-subscriber-${ Date.now() }`;
		const password = 'Fee-budget-test-1802!';
		const user = await adminPost( '/wp/v2/users', {
			username,
			password,
			email: `${ username }@example.test`,
			roles: [ 'subscriber' ],
		} );
		const forbidden = await api.get( '/wp-json/fair-finance/v1/budgets', {
			headers: basicAuth( username, password ),
		} );
		await api.delete(
			`/wp-json/wp/v2/users/${ user.id }?force=true&reassign=1`,
			{ headers: adminHeaders }
		);
		expect( forbidden.status() ).toBe( 403 );

		const budgets = await adminGet( '/fair-finance/v1/budgets' );
		expect(
			budgets.find( ( budget ) => Number( budget.id ) === budgetId ).name
		).toBe( budgetName );
	} );

	test( 'a fee created with a budget reads back linked to it, by ID and by name', async () => {
		const feeId = await createFee( { budget_id: budgetId } );

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( Number( fee.budget_id ) ).toBe( budgetId );
		expect( fee.budget_name ).toBe( budgetName );

		const row = await listedFee( feeId );
		expect( Number( row.budget_id ) ).toBe( budgetId );
		expect( row.budget_name ).toBe( budgetName );
	} );

	test( 'a fee created without a budget, or with a null one, is unlinked', async () => {
		for ( const data of [ {}, { budget_id: null } ] ) {
			const feeId = await createFee( data );

			const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
			expect( fee.budget_id ).toBeNull();
			expect( fee.budget_name ).toBeNull();

			const row = await listedFee( feeId );
			expect( row.budget_id ).toBeNull();
			expect( row.budget_name ).toBeNull();
		}
	} );

	test( 'an update that does not mention the budget keeps the link', async () => {
		const feeId = await createFee( { budget_id: budgetId } );

		const res = await api.put(
			`/wp-json/fair-audience/v1/fees/${ feeId }`,
			{
				headers: adminHeaders,
				data: {
					name: 'Renamed Budget Fee',
					description: 'Updated without touching the budget.',
					due_date: '2026-12-31',
					status: 'closed',
				},
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( fee.name ).toBe( 'Renamed Budget Fee' );
		expect( fee.status ).toBe( 'closed' );
		expect( Number( fee.budget_id ) ).toBe( budgetId );
		expect( fee.budget_name ).toBe( budgetName );
	} );

	test( 'an update with another budget moves the link to it', async () => {
		const feeId = await createFee( { budget_id: budgetId } );

		const res = await updateFee( feeId, { budget_id: otherBudgetId } );
		expect( res.ok(), await res.text() ).toBeTruthy();

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( Number( fee.budget_id ) ).toBe( otherBudgetId );
		expect( fee.budget_name ).toBe( otherBudgetName );

		const row = await listedFee( feeId );
		expect( Number( row.budget_id ) ).toBe( otherBudgetId );
		expect( row.budget_name ).toBe( otherBudgetName );
	} );

	test( 'an update can link a fee that had no budget', async () => {
		const feeId = await createFee( {} );

		const res = await updateFee( feeId, { budget_id: budgetId } );
		expect( res.ok(), await res.text() ).toBeTruthy();

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( Number( fee.budget_id ) ).toBe( budgetId );
		expect( fee.budget_name ).toBe( budgetName );
	} );

	test( 'an update with a null budget clears the link and nothing else', async () => {
		const feeId = await createFee( { budget_id: budgetId } );
		const before = await adminGet( `/fair-audience/v1/fees/${ feeId }` );

		const res = await updateFee( feeId, { budget_id: null } );
		expect( res.ok(), await res.text() ).toBeTruthy();

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( fee.budget_id ).toBeNull();
		expect( fee.budget_name ).toBeNull();
		expect( fee.name ).toBe( before.name );
		expect( fee.status ).toBe( before.status );
		expect( ( await listedFee( feeId ) ).budget_id ).toBeNull();
	} );

	test( 'a budget that is not a positive integer ID is refused and changes nothing', async () => {
		const feeId = await createFee( { budget_id: budgetId } );

		for ( const invalid of [ 0, -3, 1.5, 'abc', '', true, [ budgetId ] ] ) {
			const res = await updateFee( feeId, {
				name: 'Must not be saved',
				budget_id: invalid,
			} );
			expect( res.status(), JSON.stringify( invalid ) ).toBe( 400 );
			expect( ( await res.json() ).code ).toBe( 'rest_invalid_param' );
		}

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( Number( fee.budget_id ) ).toBe( budgetId );
		expect( fee.name ).not.toBe( 'Must not be saved' );

		const created = await api.post( '/wp-json/fair-audience/v1/fees', {
			headers: adminHeaders,
			data: {
				name: 'Invalid Budget Fee',
				group_id: groupId,
				amount: 25,
				budget_id: 'abc',
			},
		} );
		expect( created.status() ).toBe( 400 );
	} );

	test( 'changing a fee budget needs an administrator', async () => {
		const feeId = await createFee( { budget_id: budgetId } );

		const anonymous = await api.put(
			`/wp-json/fair-audience/v1/fees/${ feeId }`,
			{ data: { budget_id: null } }
		);
		expect( anonymous.status() ).toBe( 401 );

		const fee = await adminGet( `/fair-audience/v1/fees/${ feeId }` );
		expect( Number( fee.budget_id ) ).toBe( budgetId );
	} );

	test( 'fees stay readable and keep their link while the budgets table is missing', async () => {
		const linkedId = await createFee( { budget_id: budgetId } );

		await setBudgetsTablePresent( false );
		let fee;
		let row;
		let unlinkedFee;
		try {
			fee = await adminGet( `/fair-audience/v1/fees/${ linkedId }` );
			row = await listedFee( linkedId );

			// Creating and reading an unlinked fee does not need the table.
			const unlinkedId = await createFee( {} );
			unlinkedFee = await adminGet(
				`/fair-audience/v1/fees/${ unlinkedId }`
			);
		} finally {
			await setBudgetsTablePresent( true );
		}

		expect( Number( fee.budget_id ) ).toBe( budgetId );
		expect( fee.budget_name ).toBeNull();
		expect( fee.group_name ).toBeTruthy();
		expect( Number( row.budget_id ) ).toBe( budgetId );
		expect( row.budget_name ).toBeNull();
		expect( unlinkedFee.budget_id ).toBeNull();

		// With the table back, the stored link resolves to its name again.
		const restored = await adminGet(
			`/fair-audience/v1/fees/${ linkedId }`
		);
		expect( Number( restored.budget_id ) ).toBe( budgetId );
		expect( restored.budget_name ).toBe( budgetName );
	} );
} );
