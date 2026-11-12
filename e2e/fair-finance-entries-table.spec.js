/**
 * Fair Finance Entries on the shared admin table (#2208): row menus work
 * from the keyboard, dialogs return focus to the row that opened them,
 * a deletion moves focus to the page heading, split and transfer
 * allocations name their entry, and the list stacks into labeled rows
 * without sideways scrolling at 375px.
 */
import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

const API = '/wp-json/fair-finance/v1';
const STAMP = Date.now().toString( 36 );
const NAMES = {
	ordinary: `E2E table cost ${ STAMP }`,
	split: `E2E table split ${ STAMP }`,
	transfer: `E2E table transfer ${ STAMP }`,
	removable: `E2E table removable ${ STAMP }`,
	budgetA: `E2E table budget A ${ STAMP }`,
	budgetB: `E2E table budget B ${ STAMP }`,
};
const ENTRIES_PAGE = '/wp-admin/admin.php?page=fair-finance-entries';

test.describe( 'Fair Finance entries table', () => {
	let api;
	const ids = {};
	const budgetIds = [];

	const post = async ( path, data ) => {
		const res = await api.post( `${ API }${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const focusedPage = ( id ) => `${ ENTRIES_PAGE }&entry_id=${ id }`;

	test.beforeAll( async ( { baseURL } ) => {
		api = await request.newContext( { baseURL } );
		for ( const name of [ NAMES.budgetA, NAMES.budgetB ] ) {
			budgetIds.push( ( await post( '/budgets', { name } ) ).id );
		}
		const entry = ( description, amount ) =>
			post( '/financial-entries', {
				amount,
				description,
				entry_type: 'cost',
				entry_date: '2032-02-01',
			} );

		ids.ordinary = ( await entry( NAMES.ordinary, 45.5 ) ).id;
		ids.removable = ( await entry( NAMES.removable, 12 ) ).id;
		ids.split = ( await entry( NAMES.split, 300 ) ).id;
		await post( `/financial-entries/${ ids.split }/split`, {
			allocations: [
				{
					budget_id: budgetIds[ 0 ],
					amount: 200,
					description: `Allocation A ${ STAMP }`,
				},
				{
					budget_id: budgetIds[ 1 ],
					amount: 100,
					description: `Allocation B ${ STAMP }`,
				},
			],
		} );
		ids.transfer = (
			await post( '/financial-entries/transfer', {
				amount: 120,
				entry_date: '2032-02-02',
				source_budget_id: budgetIds[ 0 ],
				target_budget_id: budgetIds[ 1 ],
				description: NAMES.transfer,
			} )
		).id;
	} );

	test.afterAll( async () => {
		await api.delete( `${ API }/financial-entries/${ ids.split }/split`, {
			headers: adminHeaders,
		} );
		for ( const id of [
			ids.ordinary,
			ids.removable,
			ids.split,
			ids.transfer,
		] ) {
			if ( id ) {
				await api.delete( `${ API }/financial-entries/${ id }`, {
					headers: adminHeaders,
				} );
			}
		}
		for ( const id of budgetIds ) {
			await api.delete( `${ API }/budgets/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'row menu and editor are keyboard operable and return focus', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( focusedPage( ids.ordinary ) );

		const row = page.getByRole( 'row', {
			name: new RegExp( NAMES.ordinary ),
		} );
		await expect( row ).toContainText( '€45.50' );

		// The menu opens from the keyboard, moves with arrows, and Escape
		// returns focus to its trigger.
		const trigger = row.getByRole( 'button', {
			name: `More actions for “${ NAMES.ordinary }”`,
		} );
		await trigger.focus();
		await page.keyboard.press( 'Enter' );
		const menu = page.getByRole( 'menu', {
			name: `More actions for “${ NAMES.ordinary }”`,
		} );
		await expect( menu.getByRole( 'menuitem' ) ).toHaveText( [
			'Split',
			'Match',
			'Delete',
		] );
		// Opening focuses the first item; arrows move through the menu.
		await expect(
			menu.getByRole( 'menuitem', { name: 'Split' } )
		).toBeFocused();
		await page.keyboard.press( 'ArrowDown' );
		await expect(
			menu.getByRole( 'menuitem', { name: 'Match' } )
		).toBeFocused();
		await page.keyboard.press( 'Escape' );
		await expect( menu ).toHaveCount( 0 );
		await expect( trigger ).toBeFocused();

		// The editor returns focus to the Edit action on cancel.
		const edit = row.getByRole( 'button', {
			name: `Edit “${ NAMES.ordinary }”`,
		} );
		await edit.focus();
		await page.keyboard.press( 'Enter' );
		const dialog = page.getByRole( 'dialog' );
		await expect( dialog ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toHaveCount( 0 );
		await expect( edit ).toBeFocused();
	} );

	test( 'split and transfer rows keep their allocations and editors', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( focusedPage( ids.split ) );

		const splitRow = page
			.getByRole( 'row', {
				name: new RegExp( NAMES.split ),
			} )
			.first();
		await expect( splitRow ).toContainText( 'Split into 2 allocations' );
		const toggle = splitRow.getByRole( 'button', {
			name: 'Show 2 allocations',
		} );
		await expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		await toggle.click();
		await expect(
			splitRow.getByRole( 'button', { name: 'Hide 2 allocations' } )
		).toHaveAttribute( 'aria-expanded', 'true' );
		const allocation = page.getByRole( 'row', {
			name: new RegExp( `Allocation A ${ STAMP }` ),
		} );
		await expect( allocation ).toContainText(
			`Part of split entry “${ NAMES.split }”`
		);
		await expect( allocation ).toContainText( '€200.00' );
		await expect( allocation.getByRole( 'button' ) ).toHaveCount( 0 );

		// Deleting a split entry is unavailable, with the reason shown.
		await splitRow
			.getByRole( 'button', {
				name: `More actions for “${ NAMES.split }”`,
			} )
			.click();
		const blockedDelete = page.getByRole( 'menuitem', { name: /Delete/ } );
		await expect( blockedDelete ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await expect( blockedDelete ).toContainText(
			'Unsplit this entry before deleting it.'
		);
		await page.keyboard.press( 'Escape' );

		// Edit split opens the split editor.
		await splitRow
			.getByRole( 'button', { name: `Edit split “${ NAMES.split }”` } )
			.click();
		await expect( page.getByRole( 'dialog' ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );

		// A transfer shows both budgets and edits in the transfer editor.
		await page.goto( focusedPage( ids.transfer ) );
		const transferRow = page
			.getByRole( 'row', { name: new RegExp( NAMES.transfer ) } )
			.first();
		await expect( transferRow ).toContainText(
			`${ NAMES.budgetA } → ${ NAMES.budgetB }`
		);
		await transferRow
			.getByRole( 'button', { name: 'Show 2 allocations' } )
			.click();
		await expect(
			page.getByText( `Part of transfer “${ NAMES.transfer }”` )
		).toHaveCount( 2 );
		const editTransfer = transferRow.getByRole( 'button', {
			name: `Edit “${ NAMES.transfer }”`,
		} );
		await editTransfer.click();
		await expect(
			page.getByRole( 'dialog', { name: /transfer/i } )
		).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( editTransfer ).toBeFocused();
	} );

	test( 'deleting from the row menu moves focus to the heading', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto( focusedPage( ids.removable ) );

		await page
			.getByRole( 'button', {
				name: `More actions for “${ NAMES.removable }”`,
			} )
			.click();
		await page.getByRole( 'menuitem', { name: 'Delete' } ).click();
		const confirm = page.getByRole( 'dialog', {
			name: `Delete entry — ${ NAMES.removable }`,
		} );
		await expect( confirm ).toContainText( 'This cannot be undone.' );
		await confirm.getByRole( 'button', { name: 'Delete entry' } ).click();
		await expect( confirm ).toHaveCount( 0 );
		await expect(
			page
				.locator( '.components-notice__content' )
				.getByText( `Entry “${ NAMES.removable }” deleted.` )
		).toBeVisible();
		await expect(
			page.getByRole( 'heading', { name: 'Financial Entries' } )
		).toBeFocused();
		ids.removable = null;
	} );

	test( 'stacks into labeled rows without sideways scrolling on mobile', async ( {
		page,
	} ) => {
		await page.setViewportSize( { width: 375, height: 812 } );
		await loginAsAdmin( page );
		await page.goto( focusedPage( ids.split ) );

		const row = page
			.getByRole( 'row', { name: new RegExp( NAMES.split ) } )
			.first();
		await row.getByRole( 'button', { name: 'Show 2 allocations' } ).click();
		await expect( row.locator( 'td[data-label="Amount"]' ) ).toContainText(
			'€300.00'
		);

		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect( overflow ).toBeLessThanOrEqual( 0 );

		// Empty desktop cells are hidden rather than shown as blank labels.
		const allocation = page.getByRole( 'row', {
			name: new RegExp( `Allocation A ${ STAMP }` ),
		} );
		await expect( allocation ).toContainText(
			`Part of split entry “${ NAMES.split }”`
		);
		const visibleEmpty = await allocation
			.locator( '.fair-finance-entries__empty-cell' )
			.evaluateAll(
				( cells ) =>
					cells.filter(
						( cell ) => getComputedStyle( cell ).display !== 'none'
					).length
			);
		expect( visibleEmpty ).toBe( 0 );
	} );
} );
