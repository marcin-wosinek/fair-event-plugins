/**
 * E2E: the Manage Event List tab loads existing signups regardless of
 * whether Fair Audience is active (#1672), numbers confirmed tickets, keeps
 * email addresses out of the table, and shows each configured extra as a
 * column (#1683). Each ticket is its own row with its own reference, type
 * and extras, with and without Fair Audience, and the export has one entry
 * per ticket with the purchase total given once (#1708). Deleting a
 * registration happens only on the List tab; the Audience tab offers no
 * Delete action (#1710).
 */

import { readFile } from 'node:fs/promises';
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';
const FAIR_AUDIENCE_PLUGIN = 'fair-audience/fair-audience';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: {
					message: error?.message,
					code: error?.code,
					data: error?.data,
				},
			};
		}
	}, options );

	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${
				options.path
			} failed: ${ JSON.stringify( result.error ) }`
		);
	}

	return result.data;
}

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

// A separate visitor, so fair-audience's session cookie does not tie the
// purchase to an earlier buyer.
async function buyAsVisitor( data ) {
	const visitor = await request.newContext( { baseURL: BASE_URL } );
	const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
		data: { _honeypot: '', ...data },
	} );
	const body = await res.json();
	await visitor.dispose();
	expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
}

async function setPluginStatus( page, status ) {
	return apiFetch( page, {
		path: `/wp/v2/plugins/${ FAIR_AUDIENCE_PLUGIN }`,
		method: 'PUT',
		data: { status },
	} );
}

test.describe( 'Manage Event — List tab', () => {
	test.setTimeout( 60_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let originalAudienceStatus;
	const signup = {
		name: `List Tab Tester ${ Date.now() }`,
		email: `manage-event-list-${ Date.now() }@example.test`,
		ticketType: 'List Tab Admission',
		selectedExtra: 'List Tab Dinner',
		otherExtra: 'List Tab Party',
	};
	const group = {
		name: `List Tab Group ${ Date.now() }`,
		email: `manage-event-list-group-${ Date.now() }@example.test`,
	};
	let groupReferences = [];

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		const plugins = await apiFetch( adminPage, {
			path: '/wp/v2/plugins',
		} );
		const fairAudience = plugins.find(
			( plugin ) => plugin.plugin === FAIR_AUDIENCE_PLUGIN
		);
		expect( fairAudience ).toBeDefined();
		originalAudienceStatus = fairAudience.status;

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Manage Event List e2e ${ Date.now() }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Manage Event List e2e',
				link_type: 'post',
				start_datetime: '2036-02-01 10:00:00',
				end_datetime: '2036-02-01 12:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: signup.ticketType,
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Always available',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 0,
					},
				],
				settings: {},
				options: [
					{ name: signup.selectedExtra, price: 0 },
					{ name: signup.otherExtra, price: 0 },
				],
			},
		} );
		const ticketTypeId = tickets.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();
		const selectedExtraId = tickets.options?.find(
			( option ) => option.name === signup.selectedExtra
		)?.id;
		expect( selectedExtraId ).toBeTruthy();

		// Extras are recorded by Fair Audience, so sign up while it is active.
		await setPluginStatus( adminPage, 'active' );

		await apiFetch( adminPage, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDateId,
				name: signup.name,
				email: signup.email,
				ticket_type_id: ticketTypeId,
				quantity: 1,
				ticket_option_ids: [ selectedExtraId ],
			},
		} );

		const otherExtraId = tickets.options?.find(
			( option ) => option.name === signup.otherExtra
		)?.id;
		await buyAsVisitor( {
			event_date_id: eventDateId,
			name: group.name,
			email: group.email,
			ticket_type_id: ticketTypeId,
			quantity: 3,
			ticket_activities: [
				[ selectedExtraId ],
				[ otherExtraId, selectedExtraId ],
				[],
			],
		} );
		const listed = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		groupReferences = listed
			.find( ( row ) => row.email === group.email )
			.tickets.map( ( t ) => t.reference );
		expect( groupReferences ).toHaveLength( 3 );
	} );

	test.afterAll( async () => {
		if ( originalAudienceStatus ) {
			await setPluginStatus( adminPage, originalAudienceStatus ).catch(
				() => {}
			);
		}
		if ( eventDateId ) {
			const signups = await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			} ).catch( () => [] );
			for ( const row of signups ) {
				await apiFetch( adminPage, {
					path: `/fair-events/v1/get-tickets/${ row.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	for ( const audienceStatus of [ 'active', 'inactive' ] ) {
		test( `loads existing signups with fair-audience ${ audienceStatus }`, async () => {
			await setPluginStatus( adminPage, audienceStatus );
			await adminPage.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=list`
			);

			await expect(
				adminPage.getByRole( 'tab', { name: 'List' } )
			).toHaveAttribute( 'aria-selected', 'true' );

			const row = adminPage.getByRole( 'row', {
				name: new RegExp( signup.name ),
			} );
			await expect( row ).toContainText( signup.ticketType );
			await expect( row.getByRole( 'cell' ).first() ).toHaveText( '1' );
			await expect( adminPage.getByRole( 'table' ) ).not.toContainText(
				signup.email
			);
			await expect(
				adminPage.getByRole( 'columnheader', { name: 'Email' } )
			).toHaveCount( 0 );
			await expect(
				adminPage.getByRole( 'columnheader', { name: 'Amount' } )
			).toHaveCount( 0 );
			await expect(
				adminPage.getByRole( 'columnheader', {
					name: signup.selectedExtra,
				} )
			).toBeVisible();
			await expect(
				adminPage.getByRole( 'columnheader', {
					name: signup.otherExtra,
				} )
			).toBeVisible();

			// Extras come from each ticket, with or without Fair Audience.
			const indicators = row.getByRole( 'img' );
			await expect( indicators ).toHaveCount( 2 );
			await expect( indicators.nth( 0 ) ).toHaveAccessibleName(
				'Selected'
			);
			await expect( indicators.nth( 1 ) ).toHaveAccessibleName(
				'Not selected'
			);
			await expect( indicators.nth( 0 ) ).toHaveText( '✓' );
			await expect( indicators.nth( 1 ) ).toHaveText( '' );

			// A three-ticket purchase is three numbered rows, each with its
			// own reference and extras.
			const groupRows = adminPage.getByRole( 'row', {
				name: new RegExp( group.name ),
			} );
			await expect( groupRows ).toHaveCount( 3 );
			const expectedExtras = [
				[ 'Selected', 'Not selected' ],
				[ 'Selected', 'Selected' ],
				[ 'Not selected', 'Not selected' ],
			];
			// Numbering counts tickets: the group's rows are consecutive.
			const firstNumber = Number(
				await groupRows
					.nth( 0 )
					.getByRole( 'cell' )
					.first()
					.textContent()
			);
			for ( const [ index, reference ] of groupReferences.entries() ) {
				const groupRow = groupRows.nth( index );
				await expect( groupRow.getByRole( 'cell' ).first() ).toHaveText(
					String( firstNumber + index )
				);
				await expect( groupRow ).toContainText(
					`Ticket ${ index + 1 } (${ reference })`
				);
				const groupIndicators = groupRow.getByRole( 'img' );
				for ( const [ i, name ] of expectedExtras[ index ].entries() ) {
					await expect(
						groupIndicators.nth( i )
					).toHaveAccessibleName( name );
				}
			}
			await expect(
				adminPage.getByRole( 'columnheader', { name: 'Qty' } )
			).toHaveCount( 0 );
			// Registration actions sit on the first ticket only.
			await expect(
				groupRows.nth( 0 ).getByRole( 'button', { name: 'Delete' } )
			).toBeVisible();
			await expect(
				groupRows.nth( 1 ).getByRole( 'button', { name: 'Delete' } )
			).toHaveCount( 0 );

			const audienceTab = adminPage.getByRole( 'tab', {
				name: 'Audience',
			} );
			if ( audienceStatus === 'active' ) {
				await expect( audienceTab ).toBeVisible();
			} else {
				await expect( audienceTab ).toHaveCount( 0 );
			}
		} );
	}

	test( 'exports one CSV row per ticket with the purchase total once', async () => {
		await setPluginStatus( adminPage, 'inactive' );
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=list`
		);
		await adminPage.getByRole( 'button', { name: 'Export' } ).click();
		const dialog = adminPage.getByRole( 'dialog', { name: 'Export' } );
		await dialog.getByRole( 'radio', { name: 'CSV' } ).check();
		const downloading = adminPage.waitForEvent( 'download' );
		await dialog.getByRole( 'button', { name: 'Download CSV' } ).click();
		const csv = (
			await readFile( await ( await downloading ).path(), 'utf8' )
		)
			.replace( /^\uFEFF/, '' )
			.split( '\r\n' );

		expect( csv[ 0 ] ).toBe(
			'Email,Name,Ticket,Ticket Type,Extras,Purchase total (once per registration),Status,Transaction,Mailing,Date'
		);
		const groupLines = csv.filter( ( line ) =>
			line.startsWith( `${ group.email },` )
		);
		expect( groupLines ).toHaveLength( 3 );
		groupReferences.forEach( ( reference, index ) =>
			expect( groupLines[ index ] ).toContain(
				`Ticket ${ index + 1 } (${ reference })`
			)
		);
		expect( groupLines[ 0 ] ).toContain( `,${ signup.selectedExtra },` );
		expect( groupLines[ 1 ] ).toContain(
			`"${ signup.selectedExtra }, ${ signup.otherExtra }"`
		);
		// Free purchase: 0 on the first ticket, blank on its siblings.
		const totals = groupLines.map(
			( line ) => line.split( ',' ).slice( -5 )[ 0 ]
		);
		expect( totals[ 0 ] ).not.toBe( '' );
		expect( totals.slice( 1 ) ).toEqual( [ '', '' ] );
		expect( csv.filter( Boolean ) ).toHaveLength( 1 + 1 + 3 );

		// The mailing filter narrows the export the same way as the table.
		// The footer button, not the header's close icon.
		await dialog.getByText( 'Close', { exact: true } ).click();
		await adminPage
			.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
			.check();
		await expect(
			adminPage.getByText(
				'Nothing to export — no registrations match the current filter.'
			)
		).toBeVisible();
		await expect(
			adminPage.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
	} );

	test( 'deletes a registration from the List tab, not the Audience tab', async () => {
		await setPluginStatus( adminPage, 'active' );
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=audience`
		);

		const audienceRow = adminPage
			.getByRole( 'row', { name: new RegExp( signup.name ) } )
			.first();
		await expect(
			audienceRow.getByRole( 'button', { name: 'Edit participant' } )
		).toBeVisible();
		await expect(
			audienceRow.getByRole( 'button', { name: 'Delete' } )
		).toHaveCount( 0 );

		await adminPage.getByRole( 'tab', { name: 'List' } ).click();
		const listRow = adminPage.getByRole( 'row', {
			name: new RegExp( signup.name ),
		} );
		await listRow.getByRole( 'button', { name: 'Delete' } ).click();
		// The open dialog hides the table from the accessibility tree, so wait
		// for the DELETE itself before asserting the row is gone.
		const deleted = adminPage.waitForResponse( ( response ) =>
			/get-tickets(\/|%2F)\d+/.test( response.url() )
		);
		await adminPage
			.getByRole( 'button', { name: 'Delete registration' } )
			.click();
		expect( ( await deleted ).ok() ).toBe( true );

		await expect( adminPage.getByRole( 'dialog' ) ).toHaveCount( 0 );
		await expect( listRow ).toHaveCount( 0 );
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		expect(
			signups.filter( ( row ) => row.name === signup.name )
		).toHaveLength( 0 );
	} );
} );
