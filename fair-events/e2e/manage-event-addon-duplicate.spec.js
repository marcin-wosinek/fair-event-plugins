/**
 * E2E: an organizer duplicates add-ons in the Prices tab (#1785). The copy
 * appears right after its source with the source's current values, nothing is
 * saved until Save tickets, and after a reload the copy is a distinct add-on
 * while an earlier signup stays with the original. The action also works from
 * the keyboard and by touch at mobile width.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return {
				ok: false,
				error: { code: error?.code, message: error?.message },
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

test.describe( 'Manage Event — duplicate an add-on', () => {
	test.describe.configure( { mode: 'serial' } );
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupId;
	let yogaId;
	let dinnerId;
	const stamp = Date.now();
	const buyerEmail = `addon-duplicate-e2e-${ stamp }@example.test`;

	const editorUrl = () =>
		`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`;

	// The Add-ons panel starts collapsed.
	const openAddons = async ( page ) => {
		await page.goto( editorUrl() );
		await page
			.getByRole( 'button', { name: 'Add-ons', exact: true } )
			.click();
		await expect(
			page.getByPlaceholder( 'Add-on name' ).first()
		).toBeVisible();
	};
	const editorNames = ( page ) =>
		page
			.getByPlaceholder( 'Add-on name' )
			.evaluateAll( ( inputs ) => inputs.map( ( i ) => i.value ) );
	const addonRow = ( page, index ) =>
		page
			.locator( 'tr' )
			.filter( { has: page.getByPlaceholder( 'Add-on name' ) } )
			.nth( index );
	const saveTickets = async ( page ) => {
		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			page
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();
	};
	const storedOptions = async () =>
		(
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			} )
		).options.map( ( o ) => ( {
			id: Number( o.id ),
			name: o.name,
			short_name: o.short_name || '',
			price: Number( o.price ),
			capacity: o.capacity === null ? null : Number( o.capacity ),
		} ) );

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Add-on duplicate e2e ${ stamp }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Add-on duplicate e2e ${ stamp }`,
				link_type: 'post',
				start_date: '2039-04-05',
				start_time: '10:00:00',
				end_date: '2039-04-05',
				end_time: '12:00:00',
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
						name: 'Standard',
						capacity: null,
						activities_enabled: true,
						minimum_activities: 0,
						maximum_activities: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Always',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
				],
				options: [
					{
						name: 'Yoga',
						short_name: 'YG',
						price: 0,
						capacity: 20,
					},
					{ name: 'Dinner', price: 15, capacity: null },
				],
				settings: {},
			},
		} );
		yogaId = Number( tickets.options[ 0 ].id );
		dinnerId = Number( tickets.options[ 1 ].id );

		// An earlier signup that picked the add-on about to be duplicated,
		// bought as an anonymous visitor.
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const buyRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					_honeypot: '',
					event_date_id: eventDateId,
					name: `Addon duplicate ${ stamp }`,
					email: buyerEmail,
					ticket_type_id: tickets.ticket_types[ 0 ].id,
					ticket_option_ids: [ yogaId ],
				},
			}
		);
		const buyBody = await buyRes.json();
		await visitor.dispose();
		expect( buyRes.status(), JSON.stringify( buyBody ) ).toBe( 200 );
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		signupId = signups.find( ( row ) => row.email === buyerEmail ).id;
	} );

	test.afterAll( async () => {
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} ).catch( () => [] );
		for ( const row of signups ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets/${ row.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	test( 'a duplicate is edited, saved by Save tickets and reloaded as a distinct add-on', async () => {
		const savedBodies = [];
		adminPage.on( 'request', ( req ) => {
			if (
				req.method() !== 'GET' &&
				/\/tickets(\?|$)/.test( req.url() )
			) {
				savedBodies.push( req.postDataJSON() );
			}
		} );

		await openAddons( adminPage );
		expect( await editorNames( adminPage ) ).toEqual( [
			'Yoga',
			'Dinner',
		] );

		// Keyboard: focus the action and activate it with Enter.
		const yogaDuplicate = addonRow( adminPage, 0 ).getByRole( 'button', {
			name: 'Duplicate',
		} );
		await yogaDuplicate.focus();
		await adminPage.keyboard.press( 'Enter' );
		expect( await editorNames( adminPage ) ).toEqual( [
			'Yoga',
			'Yoga Copy',
			'Dinner',
		] );

		// The copy carries the source's values and is editable on its own.
		const copyRow = addonRow( adminPage, 1 );
		await expect( copyRow.getByPlaceholder( 'Short name' ) ).toHaveValue(
			'YG'
		);
		await expect( copyRow.getByPlaceholder( 'Unlimited' ) ).toHaveValue(
			'20'
		);
		await copyRow.getByPlaceholder( 'Add-on name' ).fill( 'Yoga evening' );
		await copyRow.getByPlaceholder( 'Unlimited' ).fill( '8' );
		await expect(
			addonRow( adminPage, 0 ).getByPlaceholder( 'Unlimited' )
		).toHaveValue( '20' );

		// An unsaved price edit on the source is part of its copy.
		const dinnerRow = addonRow( adminPage, 2 );
		await dinnerRow.locator( 'input[type="number"]' ).first().fill( '18' );
		await dinnerRow.getByRole( 'button', { name: 'Duplicate' } ).click();
		expect( await editorNames( adminPage ) ).toEqual( [
			'Yoga',
			'Yoga evening',
			'Dinner',
			'Dinner Copy',
		] );
		await expect(
			addonRow( adminPage, 3 ).locator( 'input[type="number"]' ).first()
		).toHaveValue( '18' );

		// Nothing is saved until Save tickets.
		expect( savedBodies ).toEqual( [] );
		expect( ( await storedOptions() ).map( ( o ) => o.name ) ).toEqual( [
			'Yoga',
			'Dinner',
		] );

		await saveTickets( adminPage );
		expect( savedBodies ).toHaveLength( 1 );
		expect(
			savedBodies[ 0 ].options.map( ( o ) => [ o.id, o.name ] )
		).toEqual( [
			[ yogaId, 'Yoga' ],
			[ undefined, 'Yoga evening' ],
			[ dinnerId, 'Dinner' ],
			[ undefined, 'Dinner Copy' ],
		] );
		savedBodies[ 0 ].options.forEach( ( option ) =>
			expect( option ).not.toHaveProperty( 'collaborator_ids' )
		);

		// After a reload the copies are distinct add-ons, in order.
		await openAddons( adminPage );
		expect( await editorNames( adminPage ) ).toEqual( [
			'Yoga',
			'Yoga evening',
			'Dinner',
			'Dinner Copy',
		] );
		const stored = await storedOptions();
		expect( stored.map( ( { id, ...values } ) => values ) ).toEqual( [
			{ name: 'Yoga', short_name: 'YG', price: 0, capacity: 20 },
			{ name: 'Yoga evening', short_name: 'YG', price: 0, capacity: 8 },
			{ name: 'Dinner', short_name: '', price: 18, capacity: null },
			{ name: 'Dinner Copy', short_name: '', price: 18, capacity: null },
		] );
		expect( stored[ 0 ].id ).toBe( yogaId );
		expect( stored[ 2 ].id ).toBe( dinnerId );
		expect( new Set( stored.map( ( o ) => o.id ) ).size ).toBe( 4 );
		const raw = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		} );
		raw.options.forEach( ( option ) =>
			expect( option ).not.toHaveProperty( 'collaborator_ids' )
		);

		// The earlier signup still belongs to the original, not the copy.
		const state = await apiFetch( adminPage, {
			path: `/fair-e2e/v1/ticket-activities/state?signup_ids[]=${ signupId }&option_id=${ yogaId }`,
		} );
		expect(
			state.tickets.map( ( ticket ) =>
				ticket.activities.map( ( a ) => Number( a.ticket_option_id ) )
			)
		).toEqual( [ [ yogaId ] ] );
		expect( Number( state.option_count ) ).toBe( 1 );
		const copyState = await apiFetch( adminPage, {
			path: `/fair-e2e/v1/ticket-activities/state?option_id=${ stored[ 1 ].id }`,
		} );
		expect( Number( copyState.option_count ) ).toBe( 0 );
	} );

	test( 'the row actions stay usable by touch at mobile and tablet widths', async ( {
		browser,
	} ) => {
		const context = await browser.newContext( {
			viewport: { width: 375, height: 812 },
			hasTouch: true,
			isMobile: true,
		} );
		const page = await context.newPage();
		await login( page );
		await openAddons( page );
		const before = await editorNames( page );

		// Every row action is inside the viewport: no sideways scrolling.
		const actionsFitViewport = async ( rowCount ) => {
			const width = page.viewportSize().width;
			const boxes = await page
				.locator( 'tr' )
				.filter( { has: page.getByPlaceholder( 'Add-on name' ) } )
				.getByRole( 'button', {
					name: /^(Duplicate|Remove|Move to top)$/,
				} )
				.evaluateAll( ( nodes ) =>
					nodes.map( ( node ) => {
						const box = node.getBoundingClientRect();
						return [ box.left, box.right, box.height ];
					} )
				);
			// Duplicate and Remove on every row, Move to top on all but one.
			expect( boxes ).toHaveLength( rowCount * 3 - 1 );
			for ( const [ left, right, height ] of boxes ) {
				expect( left ).toBeGreaterThanOrEqual( 0 );
				expect( right ).toBeLessThanOrEqual( width );
				expect( height ).toBeGreaterThanOrEqual( 24 );
			}
		};
		await actionsFitViewport( before.length );

		await addonRow( page, 0 )
			.getByRole( 'button', { name: 'Duplicate' } )
			.tap();
		const duplicated = [
			before[ 0 ],
			`${ before[ 0 ] } Copy`,
			...before.slice( 1 ),
		];
		expect( await editorNames( page ) ).toEqual( duplicated );
		await actionsFitViewport( duplicated.length );

		await page.setViewportSize( { width: 768, height: 1024 } );
		await actionsFitViewport( duplicated.length );
		await page.setViewportSize( { width: 1280, height: 900 } );
		await actionsFitViewport( duplicated.length );

		// The copy is removed again without touching its source.
		await page.setViewportSize( { width: 375, height: 812 } );
		await addonRow( page, 1 )
			.getByRole( 'button', { name: 'Remove' } )
			.tap();
		expect( await editorNames( page ) ).toEqual( before );
		await context.close();
	} );
} );
