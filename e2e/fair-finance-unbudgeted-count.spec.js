/**
 * Fair Finance entries awaiting a budget (#2088): the Entries page shows how
 * many entries still need a budget, and the count follows assigning and
 * removing a budget from the entry editor.
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

const ENTRIES_API = '/wp-json/fair-finance/v1/financial-entries';
const BUDGETS_API = '/wp-json/fair-finance/v1/budgets';
const STAMP = Date.now().toString( 36 );
const DESCRIPTION = `E2E unbudgeted entry ${ STAMP }`;
const BUDGET_NAME = `E2E count budget ${ STAMP }`;
const COUNT_TEXT = /^(\d+) entr(?:y is|ies are) waiting for a budget\.$/;

test.describe( 'Fair Finance entries awaiting a budget', () => {
	let api;
	let entryId;
	let budgetId;

	test.beforeAll( async ( { baseURL } ) => {
		api = await request.newContext( { baseURL } );
		const budget = await api.post( BUDGETS_API, {
			headers: adminHeaders,
			data: { name: BUDGET_NAME },
		} );
		expect( budget.ok(), await budget.text() ).toBeTruthy();
		budgetId = ( await budget.json() ).id;

		const entry = await api.post( ENTRIES_API, {
			headers: adminHeaders,
			data: {
				amount: 18.9,
				entry_type: 'cost',
				entry_date: '2026-05-04',
				description: DESCRIPTION,
			},
		} );
		expect( entry.ok(), await entry.text() ).toBeTruthy();
		entryId = ( await entry.json() ).id;
	} );

	test.afterAll( async () => {
		await api.delete( `${ ENTRIES_API }/${ entryId }`, {
			headers: adminHeaders,
		} );
		await api.delete( `${ BUDGETS_API }/${ budgetId }`, {
			headers: adminHeaders,
		} );
		await api.dispose();
	} );

	test( 'updates the count when a budget is assigned and removed', async ( {
		page,
	} ) => {
		await loginAsAdmin( page );
		await page.goto(
			`/wp-admin/admin.php?page=fair-finance-entries&entry_id=${ entryId }`
		);

		const count = page.locator( '.fair-finance-unbudgeted-count' );
		await expect( count ).toHaveText( COUNT_TEXT );
		const initial = Number(
			( await count.textContent() ).match( COUNT_TEXT )[ 1 ]
		);
		expect( initial ).toBeGreaterThan( 0 );

		const row = page.getByRole( 'row', {
			name: new RegExp( DESCRIPTION ),
		} );
		const dialog = page.getByRole( 'dialog' );

		const saveBudget = async ( label ) => {
			await row.getByRole( 'button', { name: 'Edit' } ).click();
			// EntryForm loads the entry in an effect after mounting; a change
			// before that render would be applied to the empty defaults.
			await expect( dialog.getByLabel( 'Amount' ) ).toHaveValue( '18.9' );
			await dialog
				.getByLabel( 'Budget Category' )
				.selectOption( { label } );
			await dialog
				.getByRole( 'button', { name: 'Update Entry' } )
				.click();
			await expect( dialog ).toHaveCount( 0 );
			await expect(
				page
					.locator( '.components-notice__content' )
					.getByText( 'Entry updated successfully.' )
			).toBeVisible();
		};

		await saveBudget( BUDGET_NAME );
		await expect( count ).toHaveText(
			initial - 1 === 1
				? '1 entry is waiting for a budget.'
				: `${ initial - 1 } entries are waiting for a budget.`
		);

		await saveBudget( '-- No Budget --' );
		await expect( count ).toHaveText(
			initial === 1
				? '1 entry is waiting for a budget.'
				: `${ initial } entries are waiting for a budget.`
		);

		// Cancelling the editor leaves the count as it is.
		await row.getByRole( 'button', { name: 'Edit' } ).click();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toHaveCount( 0 );
		await expect( count ).toHaveText(
			initial === 1
				? '1 entry is waiting for a budget.'
				: `${ initial } entries are waiting for a budget.`
		);
	} );
} );
