/**
 * Fair Finance Entries Link filter (#2134): selecting an event shows its
 * costs (including ones linked only by URL) and income, switching to a
 * URL-only link replaces the selection, and clearing restores the list.
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
const STAMP = Date.now().toString( 36 );
const EVENT_TITLE = `E2E filter event ${ STAMP }`;
const OTHER_URL = `https://example.org/e2e-other-${ STAMP }/`;
const OTHER_LABEL = `e2e other ${ STAMP }`;
const DESCRIPTIONS = {
	urlCost: `E2E URL-linked cost ${ STAMP }`,
	idIncome: `E2E ID-linked income ${ STAMP }`,
	otherCost: `E2E other link cost ${ STAMP }`,
	unrelated: `E2E unrelated cost ${ STAMP }`,
};

test.describe( 'Fair Finance entries Link filter', () => {
	let api;
	let postId;
	let eventDateId;
	const entryIds = [];

	const createEntry = async ( data ) => {
		const res = await api.post( ENTRIES_API, {
			headers: adminHeaders,
			data: { entry_type: 'cost', entry_date: '2032-01-05', ...data },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		entryIds.push( ( await res.json() ).id );
	};

	test.beforeAll( async ( { baseURL } ) => {
		api = await request.newContext( { baseURL } );

		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: EVENT_TITLE, status: 'publish' },
		} );
		expect( post.ok(), await post.text() ).toBeTruthy();
		postId = ( await post.json() ).id;

		const ensure = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect( ensure.ok(), await ensure.text() ).toBeTruthy();
		eventDateId = ( await ensure.json() ).id;

		const eventDate = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const displayUrl = ( await eventDate.json() ).display_url;
		expect( displayUrl ).toBeTruthy();

		// A cost linked only by the event's URL, as a pasted link stores it.
		await createEntry( {
			amount: 12,
			description: DESCRIPTIONS.urlCost,
			event_url: displayUrl,
		} );
		await createEntry( {
			amount: 30,
			entry_type: 'income',
			description: DESCRIPTIONS.idIncome,
			event_date_id: eventDateId,
		} );
		await createEntry( {
			amount: 7,
			description: DESCRIPTIONS.otherCost,
			event_url: OTHER_URL,
		} );
		await createEntry( {
			amount: 5,
			description: DESCRIPTIONS.unrelated,
		} );
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES_API }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test( 'selects, switches and clears an event link', async ( { page } ) => {
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/admin.php?page=fair-finance-entries' );

		const row = ( key ) =>
			page.getByRole( 'row', {
				name: new RegExp( DESCRIPTIONS[ key ] ),
			} );
		const link = page.getByRole( 'combobox', { name: 'Link' } );

		await expect( row( 'unrelated' ) ).toBeVisible();
		// The Link filter is under More filters.
		await page.getByRole( 'button', { name: /^More filters/ } ).click();

		// The event and the URL-only link share one dropdown.
		await expect(
			link.getByRole( 'option', { name: EVENT_TITLE } )
		).toHaveCount( 1 );
		await expect(
			link.getByRole( 'option', { name: OTHER_LABEL } )
		).toHaveCount( 1 );

		await link.selectOption( { label: EVENT_TITLE } );
		await expect( row( 'urlCost' ) ).toBeVisible();
		await expect( row( 'idIncome' ) ).toBeVisible();
		await expect( row( 'otherCost' ) ).toHaveCount( 0 );
		await expect( row( 'unrelated' ) ).toHaveCount( 0 );

		await link.selectOption( { label: OTHER_LABEL } );
		await expect( row( 'otherCost' ) ).toBeVisible();
		await expect( row( 'urlCost' ) ).toHaveCount( 0 );
		await expect( row( 'idIncome' ) ).toHaveCount( 0 );

		await link.selectOption( { label: 'All Links' } );
		for ( const key of Object.keys( DESCRIPTIONS ) ) {
			await expect( row( key ) ).toBeVisible();
		}
	} );
} );
