import { test, expect } from '@playwright/test';

/**
 * E2E: the confirmations for deleting a venue, importing ticket settings,
 * ending a series, merging sale periods and removing the organizer logo
 * (#1772). Each names its target, cancelling changes nothing, confirming has
 * the persisted effect the dialog describes, and the two that only change the
 * form still need their own save.
 *
 * Deleting a registration, deleting an event and changing its publication
 * (#1933) name their target in the title, keep a failed request inside the
 * open dialog for a retry, and only close once the request succeeded. A long
 * title wraps inside the dialog at 375px.
 */

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message, code: error?.code };
		}
	}, options );
	if ( ! result.ok ) {
		const error = new Error( result.error );
		error.code = result.code;
		throw error;
	}
	return result.data;
}

async function openApiPage( page ) {
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
}

// The visible notice only: its text is mirrored in a screen-reader region.
const notice = ( page, text ) =>
	page.locator( '.components-notice' ).filter( { hasText: text } );

// Fail the first matching request with a server message, let later ones
// through. apiFetch tunnels DELETE/PUT through POST + X-HTTP-Method-Override.
async function failOnce( page, pattern, method, message ) {
	let failed = false;
	await page.route( pattern, ( route ) => {
		const request = route.request();
		const actual =
			request.headers()[ 'x-http-method-override' ] || request.method();
		if ( failed || actual !== method ) {
			return route.fallback();
		}
		failed = true;
		return route.fulfill( {
			status: 500,
			json: { code: 'simulated_failure', message },
		} );
	} );
}

const manageUrl = ( id, tab = 'event-details' ) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ id }&tab=${ tab }`;

test.describe( 'Confirmation dialogs (#1772)', () => {
	test.setTimeout( 90_000 );

	const stamp = Date.now();
	const cleanup = { venues: [], eventDates: [], media: [] };
	let organizerBefore;

	test.beforeEach( async ( { page } ) => {
		await login( page );
		await openApiPage( page );
	} );

	test.afterEach( async ( { page } ) => {
		await openApiPage( page );
		for ( const id of cleanup.eventDates.splice( 0 ) ) {
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		for ( const id of cleanup.venues.splice( 0 ) ) {
			await apiFetch( page, {
				path: `/fair-events/v1/venues/${ id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( organizerBefore !== undefined ) {
			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: { fair_events_organizer: organizerBefore },
			} );
			organizerBefore = undefined;
		}
		for ( const id of cleanup.media.splice( 0 ) ) {
			await apiFetch( page, {
				path: `/wp/v2/media/${ id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );

	async function createEventDate( page, data ) {
		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				start_datetime: '2035-05-03T18:00:00',
				end_datetime: '2035-05-03T20:00:00',
				...data,
			},
		} );
		cleanup.eventDates.push( eventDate.id );
		return eventDate;
	}

	test( 'deleting a venue names it, can be cancelled, and leaves its event without a venue', async ( {
		page,
	} ) => {
		const name = `Confirm Hall ${ stamp }`;
		const venue = await apiFetch( page, {
			path: '/fair-events/v1/venues',
			method: 'POST',
			data: { name, address: '1 Example Street, Sampletown' },
		} );
		cleanup.venues.push( venue.id );
		const eventDate = await createEventDate( page, {
			title: `Venue user ${ stamp }`,
			venue_id: venue.id,
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-events-venues' );
		const row = page.getByRole( 'row', { name: new RegExp( name ) } );
		const deleteButton = row.getByRole( 'button', { name: 'Delete' } );
		const dialog = page.getByRole( 'dialog', { name: 'Delete venue?' } );

		// Escape dismisses and hands focus back to the button that opened it.
		await deleteButton.click();
		await expect( dialog ).toContainText(
			`Delete the venue ${ name } (1 Example Street, Sampletown)?`
		);
		await expect( dialog ).toContainText(
			'Event dates that use this venue will be left without a venue.'
		);
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( deleteButton ).toBeFocused();

		await deleteButton.click();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( row ).toBeVisible();
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				} )
			).venue_id
		).toBe( venue.id );

		await deleteButton.click();
		await dialog.getByRole( 'button', { name: 'Delete venue' } ).click();
		await expect( dialog ).toBeHidden();
		await expect(
			notice( page, `Venue ${ name } deleted.` )
		).toBeVisible();
		await expect( row ).toHaveCount( 0 );

		const after = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }`,
		} );
		expect( after.venue_id ).toBeNull();
		expect( after.title ).toBe( `Venue user ${ stamp }` );
	} );

	test( 'importing ticket settings names the event and file, survives a cancel, and replaces what is saved', async ( {
		page,
	} ) => {
		const title = `Import target ${ stamp }`;
		const eventDate = await createEventDate( page, { title } );
		const file = {
			name: 'demo-tickets.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				JSON.stringify( {
					type: 'fair-events-tickets',
					capacity: 40,
					ticket_types: [ { name: 'Imported pass' } ],
					sale_periods: [ { name: '' } ],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 12,
						},
					],
					options: [],
				} )
			),
		};

		await page.goto( manageUrl( eventDate.id, 'prices' ) );
		const input = page.locator( 'input[type="file"]' );
		const dialog = page.getByRole( 'dialog', {
			name: 'Import ticket settings?',
		} );

		await input.setInputFiles( file );
		await expect( dialog ).toContainText(
			`Import demo-tickets.json into ${ title } on`
		);
		await expect( dialog ).toContainText(
			'The import is saved immediately.'
		);
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
				} )
			).ticket_types
		).toHaveLength( 0 );

		// Cancelling cleared the input, so choosing the same file asks again.
		await expect( input ).toHaveValue( '' );
		await input.setInputFiles( file );
		await expect( dialog ).toBeVisible();
		await dialog
			.getByRole( 'button', { name: 'Import and replace' } )
			.click();
		await expect( dialog ).toBeHidden();
		await expect(
			notice( page, 'Ticket settings imported from demo-tickets.json.' )
		).toBeVisible();

		const saved = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
		} );
		expect( saved.ticket_types.map( ( t ) => t.name ) ).toEqual( [
			'Imported pass',
		] );
		expect( saved.capacity ).toBe( 40 );
	} );

	test( 'ending a series names it, keeps its first date and deletes the others', async ( {
		page,
	} ) => {
		const title = `Ending series ${ stamp }`;
		const series = await createEventDate( page, {
			title,
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( series.generated_occurrences ).toHaveLength( 2 );

		await page.goto( manageUrl( series.id ) );
		const endButton = page.getByRole( 'button', {
			name: 'End series',
			exact: true,
		} );
		const dialog = page.getByRole( 'dialog', {
			name: `End series — ${ title }`,
		} );

		await endButton.click();
		await expect( dialog ).toContainText( `End the series ${ title }?` );
		await expect( dialog ).toContainText( 'is kept as a single event.' );
		await expect( dialog ).toContainText(
			'All 2 other dates are deleted:'
		);
		await expect( dialog.getByRole( 'listitem' ) ).toHaveCount( 2 );
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ series.id }`,
				} )
			).rrule
		).toBe( 'FREQ=WEEKLY;COUNT=3' );

		await endButton.click();
		await dialog.getByRole( 'button', { name: 'End series' } ).click();
		await expect( dialog ).toBeHidden();
		await expect(
			notice( page, `Series ${ title } ended.` )
		).toBeVisible();
		await expect( endButton ).toHaveCount( 0 );

		const after = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ series.id }`,
		} );
		expect( after.rrule ).toBeNull();
		expect( after.recurrence_mode ).toBe( 'none' );
		expect( after.start_datetime ).toBe( series.start_datetime );
		await expect(
			apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ series.generated_occurrences[ 0 ].id }`,
			} )
		).rejects.toThrow();
	} );

	test( 'merging sale periods names the event, is not saved by itself, and keeps the leave-page warning', async ( {
		page,
	} ) => {
		const title = `Merge target ${ stamp }`;
		const eventDate = await createEventDate( page, { title } );

		await page.goto( manageUrl( eventDate.id, 'prices' ) );
		await page.getByRole( 'button', { name: 'More options' } ).click();
		const toggle = page.getByLabel( 'Multiple pricing periods' );
		await toggle.check();
		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect
			.poll( async () => {
				const saved = await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
				} );
				return saved.sale_periods.length;
			} )
			.toBe( 2 );

		const dialog = page.getByRole( 'dialog', {
			name: 'Merge sale periods?',
		} );
		await toggle.click();
		await expect( dialog ).toContainText(
			`Merge the 2 sale periods of ${ title } into one sale window?`
		);
		await expect( dialog ).toContainText(
			'Ticket prices from the first period, Advance ticket, are kept.'
		);
		await expect( dialog ).toContainText(
			'Nothing is saved until you select Save tickets.'
		);
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( toggle ).toBeChecked();

		await toggle.click();
		await dialog.getByRole( 'button', { name: 'Merge periods' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( toggle ).not.toBeChecked();

		// Merged on screen only: the two periods are still what is saved, and
		// leaving now asks first.
		const stillSaved = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
		} );
		expect( stillSaved.sale_periods ).toHaveLength( 2 );

		let warned = false;
		page.once( 'dialog', async ( leaveDialog ) => {
			warned = leaveDialog.type() === 'beforeunload';
			await leaveDialog.dismiss();
		} );
		await page
			.goto( '/wp-admin/admin.php?page=fair-events-all-events' )
			.catch( () => {} );
		expect( warned ).toBe( true );
		await expect( page ).toHaveURL( /tab=prices/ );

		await page.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect
			.poll( async () => {
				const saved = await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
				} );
				return saved.sale_periods.length;
			} )
			.toBe( 1 );
	} );

	test( 'removing the organizer logo names the organizer, needs Save organizer, and keeps the image', async ( {
		page,
	} ) => {
		const mediaId = await page.evaluate( async () => {
			const png = Uint8Array.from(
				atob(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
				),
				( c ) => c.charCodeAt( 0 )
			);
			const body = new FormData();
			body.append(
				'file',
				new Blob( [ png ], { type: 'image/png' } ),
				'demo-logo.png'
			);
			// eslint-disable-next-line no-undef
			return (
				await wp.apiFetch( {
					path: '/wp/v2/media',
					method: 'POST',
					body,
				} )
			).id;
		} );
		cleanup.media.push( mediaId );

		const settings = await apiFetch( page, { path: '/wp/v2/settings' } );
		organizerBefore = settings.fair_events_organizer;
		const organizerName = `Demo Collective ${ stamp }`;
		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_organizer: {
					...organizerBefore,
					name: organizerName,
					logo_id: mediaId,
				},
			},
		} );
		const savedLogoId = async () =>
			( await apiFetch( page, { path: '/wp/v2/settings' } ) )
				.fair_events_organizer.logo_id;

		await page.goto(
			'/wp-admin/admin.php?page=fair-events-settings&tab=organizer'
		);
		const removeButton = page
			.getByRole( 'button', { name: 'Remove', exact: true } )
			.first();
		const dialog = page.getByRole( 'dialog', {
			name: 'Remove organizer logo?',
		} );

		await removeButton.click();
		await expect( dialog ).toContainText(
			`Remove the logo chosen for the organizer ${ organizerName }?`
		);
		await expect( dialog ).toContainText(
			'The image you remove here stays in the Media Library.'
		);
		await expect( dialog ).toContainText(
			'Nothing is saved until you select Save organizer.'
		);
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( removeButton ).toBeVisible();

		await removeButton.click();
		await dialog.getByRole( 'button', { name: 'Remove logo' } ).click();
		await expect( dialog ).toBeHidden();
		expect( await savedLogoId() ).toBe( mediaId );

		await page.getByRole( 'button', { name: 'Save organizer' } ).click();
		await expect(
			notice( page, 'Organizer settings saved successfully.' )
		).toBeVisible();
		expect( ( await savedLogoId() ) || 0 ).toBe( 0 );

		const media = await apiFetch( page, {
			path: `/wp/v2/media/${ mediaId }`,
		} );
		expect( media.id ).toBe( mediaId );
	} );
	test( 'deleting a registration names the registrant, keeps a failure in the dialog and retries', async ( {
		page,
	} ) => {
		const eventDate = await createEventDate( page, {
			title: `Registration target ${ stamp }`,
		} );
		const tickets = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Admission',
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
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
				],
				settings: {},
				options: [],
			},
		} );
		const name = `Ana Ruiz ${ stamp }`;
		const email = `confirm-registration-${ stamp }@example.test`;
		await apiFetch( page, {
			path: '/fair-events/v1/get-tickets',
			method: 'POST',
			data: {
				event_date_id: eventDate.id,
				name,
				email,
				ticket_type_id: tickets.ticket_types[ 0 ].id,
				quantity: 1,
			},
		} );

		await failOnce(
			page,
			/get-tickets(\/|%2F)\d+/,
			'DELETE',
			'Simulated registration failure.'
		);
		await page.goto( manageUrl( eventDate.id, 'list' ) );
		const row = page.getByRole( 'row', { name: new RegExp( name ) } );
		await row.getByRole( 'button', { name: 'Delete' } ).click();
		// Named with the ticket reference the List shows, never the email.
		const dialog = page.getByRole( 'dialog', {
			name: new RegExp(
				`^Delete registration — ${ name } \\([0-9A-F]{8}\\)$`
			),
		} );
		await expect( dialog ).toContainText(
			`Delete the registration for ${ name }, with its 1 ticket?`
		);
		await expect( dialog ).not.toContainText( email );
		const confirm = dialog.getByRole( 'button', {
			name: 'Delete registration',
		} );

		await confirm.click();
		await expect(
			dialog.locator( '.components-notice__content' )
		).toHaveText( 'Simulated registration failure.' );
		await expect( dialog ).toBeVisible();

		await confirm.click();
		await expect( dialog ).toBeHidden();
		await expect(
			notice(
				page,
				new RegExp(
					`Registration for ${ name } \\([0-9A-F]{8}\\) deleted\\.`
				)
			)
		).toBeVisible();
		await expect( row ).toHaveCount( 0 );
		await expect(
			page.getByRole( 'heading', { name: 'List' } )
		).toBeFocused();
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/get-tickets?event_date=${ eventDate.id }`,
				} )
			).filter( ( signup ) => signup.email === email )
		).toHaveLength( 0 );
	} );

	test( 'deleting an event keeps a failure in the dialog, then goes to the calendar', async ( {
		page,
	} ) => {
		const title = `Delete target ${ stamp }`;
		const eventDate = await createEventDate( page, { title } );

		await failOnce(
			page,
			new RegExp( `event-dates(\\/|%2F)${ eventDate.id }(\\?|$)` ),
			'DELETE',
			'Simulated event failure.'
		);
		await page.goto( manageUrl( eventDate.id, 'admin' ) );
		const deleteButton = page.getByRole( 'button', {
			name: 'Delete Event',
		} );
		const dialog = page.getByRole( 'dialog', {
			name: new RegExp( `^Delete event — ${ title }, ` ),
		} );

		await deleteButton.click();
		await expect( dialog ).toContainText( 'This cannot be undone.' );
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( deleteButton ).toBeFocused();

		await deleteButton.click();
		const confirm = dialog.getByRole( 'button', { name: 'Delete event' } );
		await confirm.click();
		await expect(
			dialog.locator( '.components-notice__content' )
		).toHaveText( 'Simulated event failure.' );
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				} )
			).title
		).toBe( title );

		await confirm.click();
		await page.waitForURL( /page=fair-events-calendar/ );
		await expect(
			apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
			} )
		).rejects.toThrow();
	} );

	test( 'changing the publication keeps a failure in the dialog and returns focus after success', async ( {
		page,
	} ) => {
		const title = `Publication target ${ stamp }`;
		const eventDate = await createEventDate( page, { title } );
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/publication-status`,
			method: 'POST',
			data: { publication_status: 'publish' },
		} );

		await failOnce(
			page,
			/publication-status/,
			'POST',
			'Simulated publication failure.'
		);
		await page.goto( manageUrl( eventDate.id ) );
		const toggle = page.getByRole( 'button', { name: 'Move to draft' } );
		await toggle.click();
		const dialog = page.getByRole( 'dialog', {
			name: new RegExp( `^Move to draft — ${ title }, ` ),
		} );
		const confirm = dialog.getByRole( 'button', { name: 'Move to draft' } );
		await expect( confirm ).not.toHaveClass( /is-destructive/ );

		await confirm.click();
		await expect(
			dialog.locator( '.components-notice__content' )
		).toHaveText( 'Simulated publication failure.' );

		await confirm.click();
		await expect( dialog ).toBeHidden();
		await expect( notice( page, 'Event moved to draft.' ) ).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: 'Publish event' } )
		).toBeFocused();
		expect(
			(
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				} )
			).publication_status
		).toBe( 'draft' );
	} );

	test( 'a long title wraps inside the dialog at 375px', async ( {
		page,
	} ) => {
		const title = `A remarkably long workshop title that names every part of the programme ${ stamp }`;
		const eventDate = await createEventDate( page, { title } );

		await page.setViewportSize( { width: 375, height: 812 } );
		await page.goto( manageUrl( eventDate.id, 'admin' ) );
		await page.getByRole( 'button', { name: 'Delete Event' } ).click();
		const dialog = page.getByRole( 'dialog' );
		const heading = dialog.getByRole( 'heading', { level: 1 } );
		await expect( heading ).toContainText( title );

		const dialogBox = await dialog.boundingBox();
		const headingBox = await heading.boundingBox();
		expect( dialogBox.x ).toBeGreaterThanOrEqual( 0 );
		expect( dialogBox.x + dialogBox.width ).toBeLessThanOrEqual( 375 );
		// Wrapped onto several lines, all inside the dialog.
		expect( headingBox.height ).toBeGreaterThan( 40 );
		expect( headingBox.x + headingBox.width ).toBeLessThanOrEqual(
			dialogBox.x + dialogBox.width
		);
		// The body starts below the title instead of under it.
		const bodyBox = await dialog
			.getByText( /This cannot be undone\./ )
			.boundingBox();
		expect( bodyBox.y ).toBeGreaterThanOrEqual(
			headingBox.y + headingBox.height
		);
		for ( const name of [ 'Cancel', 'Delete event' ] ) {
			const box = await dialog
				.getByRole( 'button', { name } )
				.boundingBox();
			expect( box.x + box.width ).toBeLessThanOrEqual( 375 );
		}
	} );
} );
