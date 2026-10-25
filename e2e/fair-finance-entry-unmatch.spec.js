/**
 * Fair Finance entry unmatching (#1986): Unmatch opens an accessible
 * confirmation naming the entry and every linked transaction. Cancel keeps
 * the associations; confirming removes them, and the change survives a
 * reload. The dialog is operable from the keyboard.
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
const TRANSACTIONS_API = '/wp-json/fair-e2e/v1/test-transactions';
const DESCRIPTION = `E2E unmatch payout ${ Date.now().toString( 36 ) }`;

test.describe( 'Fair Finance entry unmatching', () => {
	let api;
	let entryId;
	const transactionIds = [];

	test.beforeAll( async ( { baseURL } ) => {
		api = await request.newContext( { baseURL } );
		for ( const amount of [ 10, 15 ] ) {
			const res = await api.post( TRANSACTIONS_API, {
				headers: adminHeaders,
				data: { amount, description: `Ticket ${ amount }` },
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			transactionIds.push( ( await res.json() ).id );
		}
		const entry = await api.post( ENTRIES_API, {
			headers: adminHeaders,
			data: {
				amount: 25,
				entry_type: 'income',
				entry_date: '2026-05-04',
				description: DESCRIPTION,
			},
		} );
		expect( entry.ok(), await entry.text() ).toBeTruthy();
		entryId = ( await entry.json() ).id;
		const match = await api.post( `${ ENTRIES_API }/${ entryId }/match`, {
			headers: adminHeaders,
			data: { transaction_ids: transactionIds },
		} );
		expect( match.ok(), await match.text() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		await api.delete( `${ ENTRIES_API }/${ entryId }/match`, {
			headers: adminHeaders,
		} );
		await api.delete( `${ ENTRIES_API }/${ entryId }`, {
			headers: adminHeaders,
		} );
		for ( const id of transactionIds ) {
			await api.delete( `${ TRANSACTIONS_API }?id=${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'confirms, cancels and unmatches from the keyboard', async ( {
		page,
	} ) => {
		const entryPage = `/wp-admin/admin.php?page=fair-finance-entries&entry_id=${ entryId }`;
		await loginAsAdmin( page );
		await page.goto( entryPage );

		const row = page.getByRole( 'row', {
			name: new RegExp( DESCRIPTION ),
		} );
		const trigger = row.getByRole( 'button', { name: 'Unmatch' } );
		await expect( row ).toContainText( 'Yes (2)' );

		// Cancel with Escape: nothing changes and focus returns to the row.
		await trigger.focus();
		await page.keyboard.press( 'Enter' );
		const dialog = page.getByRole( 'dialog', {
			name: `Unmatch entry — ${ DESCRIPTION }`,
		} );
		await expect(
			dialog.getByText( 'This removes the links to all 2 transactions:' )
		).toBeVisible();
		await expect( dialog.getByRole( 'listitem' ) ).toHaveCount( 2 );
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toHaveCount( 0 );
		await expect( trigger ).toBeFocused();
		await expect( row ).toContainText( 'Yes (2)' );

		// Confirm from the keyboard.
		await page.keyboard.press( 'Enter' );
		const confirm = dialog.getByRole( 'button', {
			name: 'Unmatch',
			exact: true,
		} );
		await expect( confirm ).toBeEnabled();
		await confirm.focus();
		await page.keyboard.press( 'Enter' );
		await expect( dialog ).toHaveCount( 0 );
		await expect(
			page
				.locator( '.components-notice__content' )
				.getByText( 'Entry unmatched successfully.' )
		).toBeVisible();
		await expect(
			row.getByRole( 'button', { name: 'Match' } )
		).toBeFocused();

		// The change persists after a reload.
		await page.reload();
		await expect( row ).toContainText( 'No' );
		await expect(
			row.getByRole( 'button', { name: 'Match' } )
		).toBeVisible();
	} );
} );
