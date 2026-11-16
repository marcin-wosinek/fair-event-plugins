import { test, expect } from '@playwright/test';

test( 'editor retains categories from both languages after save and reopen', async ( {
	page,
} ) => {
	test.setTimeout( 90_000 );
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.locator( 'input[name="log"]' ).fill( 'admin' );
		await page.locator( 'input[name="pwd"]' ).fill( 'password' );
		await expect( page.locator( 'input[name="log"]' ) ).toHaveValue(
			'admin'
		);
		await expect( page.locator( 'input[name="pwd"]' ) ).toHaveValue(
			'password'
		);
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
	const api = async ( path, method = 'GET', data ) =>
		page.evaluate( ( options ) => window.wp.apiFetch( options ), {
			path,
			method,
			data,
		} );
	const suffix = Date.now();
	const cats = [];
	let post;
	let date;
	let labels;
	let created;
	try {
		for ( let index = 0; index < 4; index++ ) {
			cats.push(
				await api( '/wp/v2/categories', 'POST', {
					name: `Editor category ${ index } ${ suffix }`,
				} )
			);
		}
		await api( '/fair-e2e/v1/term-languages', 'POST', {
			languages: Object.fromEntries(
				cats.map( ( cat, index ) => [
					cat.id,
					{
						slug: index < 2 ? 'en' : 'es',
						name: index < 2 ? 'English' : 'Español',
					},
				] )
			),
		} );
		const options = await api(
			'/fair-events/v1/sources/categories?all_languages=true'
		);
		labels = cats.map( ( cat ) => {
			const option = options.find( ( item ) => item.id === cat.id );
			return option.language
				? `${ option.name } — ${ option.language }`
				: option.name;
		} );
		post = await api( '/wp/v2/fair_event', 'POST', {
			title: `Editor post ${ suffix }`,
			status: 'publish',
		} );
		date = await api( '/fair-events/v1/event-dates', 'POST', {
			title: `Editor event ${ suffix }`,
			start_date: '2031-02-01',
			start_time: '10:00:00',
			end_date: '2031-02-01',
			end_time: '12:00:00',
		} );
		await api( `/fair-events/v1/event-dates/${ date.id }`, 'PUT', {
			event_id: post.id,
		} );
		await api( '/fair-e2e/v1/category-assignment', 'POST', {
			post_id: post.id,
			allowed_ids: cats.slice( 0, 2 ).map( ( cat ) => cat.id ),
		} );
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ date.id }`
		);
		const field = page.getByRole( 'combobox', { name: 'Categories' } );
		for ( const label of labels ) {
			await field.fill( label );
			await field.press( 'Enter' );
		}
		await page.getByRole( 'button', { name: 'Save Event' } ).click();
		await expect(
			page
				.locator( '#fair-events-manage-event-root' )
				.getByText( 'Event updated successfully.' )
			// Saving reassigns terms, which can be slow on a busy site.
		).toBeVisible( { timeout: 15_000 } );
		const saved = await api( `/fair-events/v1/event-dates/${ date.id }` );
		expect( saved.categories.map( ( cat ) => cat.id ).sort() ).toEqual(
			cats.map( ( cat ) => cat.id ).sort()
		);
		await page.reload();
		for ( const cat of cats ) {
			await expect( page.getByText( cat.name ).first() ).toBeVisible();
		}
		// The saved event's own categories carry no language, and race
		// against the all-languages options fetch; reopening must still show
		// each token with its language label, not the bare name (#1636).
		await expect
			.poll( () =>
				page
					.locator(
						'.components-form-token-field__token-text > [aria-hidden="true"]'
					)
					.allTextContents()
			)
			.toEqual( expect.arrayContaining( labels ) );
		const reopened = await api(
			`/fair-events/v1/event-dates/${ date.id }`
		);
		expect( reopened.categories.map( ( cat ) => cat.id ).sort() ).toEqual(
			cats.map( ( cat ) => cat.id ).sort()
		);

		// Remove one language's category and create a new one in the same
		// shared input, then save and reopen (#2292).
		const tokens = page.locator( '.components-form-token-field__token' );
		await tokens
			.filter( { hasText: labels[ 3 ] } )
			.getByRole( 'button', { name: 'Remove item' } )
			.click();
		const createdName = `Editor created ${ suffix }`;
		await field.fill( createdName );
		await field.press( 'Enter' );
		await expect
			.poll( async () => {
				const found = await api(
					`/wp/v2/categories?search=${ encodeURIComponent(
						createdName
					) }`
				);
				created = found.find( ( cat ) => cat.name === createdName );
				return !! created;
			} )
			.toBe( true );
		await page.getByRole( 'button', { name: 'Save Event' } ).click();
		await expect(
			page
				.locator( '#fair-events-manage-event-root' )
				.getByText( 'Event updated successfully.' )
			// Saving reassigns terms, which can be slow on a busy site.
		).toBeVisible( { timeout: 15_000 } );
		const edited = await api( `/fair-events/v1/event-dates/${ date.id }` );
		const expectedIds = [
			...cats.slice( 0, 3 ).map( ( cat ) => cat.id ),
			created.id,
		].sort();
		expect( edited.categories.map( ( cat ) => cat.id ).sort() ).toEqual(
			expectedIds
		);
		await page.reload();
		await expect
			.poll( () =>
				page
					.locator(
						'.components-form-token-field__token-text > [aria-hidden="true"]'
					)
					.allTextContents()
			)
			.toEqual( expect.arrayContaining( labels.slice( 0, 3 ) ) );
		await expect(
			page
				.locator(
					'.components-form-token-field__token-text > [aria-hidden="true"]'
				)
				.filter( { hasText: labels[ 3 ] } )
		).toHaveCount( 0 );
	} finally {
		await api( '/fair-e2e/v1/category-assignment', 'POST', {
			post_id: 0,
			allowed_ids: [],
		} ).catch( () => {} );
		if ( date )
			await api(
				`/fair-events/v1/event-dates/${ date.id }`,
				'DELETE'
			).catch( () => {} );
		if ( post )
			await api(
				`/wp/v2/fair_event/${ post.id }?force=true`,
				'DELETE'
			).catch( () => {} );
		for ( const cat of created ? [ ...cats, created ] : cats )
			await api(
				`/wp/v2/categories/${ cat.id }?force=true`,
				'DELETE'
			).catch( () => {} );
	}
} );

test( 'quick add saves the chosen one of two same-named categories', async ( {
	page,
} ) => {
	test.setTimeout( 90_000 );
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.locator( 'input[name="log"]' ).fill( 'admin' );
		await page.locator( 'input[name="pwd"]' ).fill( 'password' );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
	await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
	await page.waitForFunction( () => window.wp?.apiFetch );
	const api = async ( path, method = 'GET', data ) =>
		page.evaluate( ( options ) => window.wp.apiFetch( options ), {
			path,
			method,
			data,
		} );
	const suffix = Date.now();
	const name = `Quick same ${ suffix }`;
	const cats = [];
	let date;
	try {
		// WordPress rejects identical sibling names, so the Spanish term
		// shares the English term's name under a different parent.
		const parent = await api( '/wp/v2/categories', 'POST', {
			name: `Quick parent ${ suffix }`,
		} );
		cats.push( parent );
		const english = await api( '/wp/v2/categories', 'POST', { name } );
		cats.push( english );
		const spanish = await api( '/wp/v2/categories', 'POST', {
			name,
			parent: parent.id,
		} );
		cats.push( spanish );
		await api( '/fair-e2e/v1/term-languages', 'POST', {
			languages: {
				[ english.id ]: { slug: 'en', name: 'English' },
				[ spanish.id ]: { slug: 'es', name: 'Español' },
			},
		} );

		await page.goto(
			'/wp-admin/admin.php?page=fair-events-calendar&month=2031-03'
		);
		await page.getByRole( 'button', { name: 'Add event' } ).first().click();
		await page.getByLabel( 'Title' ).fill( `Quick event ${ suffix }` );
		const field = page.getByRole( 'combobox', { name: 'Categories' } );
		await field.fill( name );
		await expect(
			page.getByRole( 'option', { name: `${ name } — English` } )
		).toBeVisible();
		await expect(
			page.getByRole( 'option', { name: `${ name } — Español` } )
		).toBeVisible();
		for ( const label of [
			`${ name } — Español`,
			`${ name } — English`,
		] ) {
			await field.fill( label );
			await field.press( 'Enter' );
		}
		await page
			.locator( '.components-form-token-field__token' )
			.filter( { hasText: `${ name } — English` } )
			.getByRole( 'button', { name: 'Remove item' } )
			.click();

		const responsePromise = page.waitForResponse(
			( response ) =>
				response.request().method() === 'POST' &&
				/fair-events(\/|%2F)v1(\/|%2F)event-dates(\?|$|&)/.test(
					response.url()
				)
		);
		await page.getByRole( 'button', { name: 'Create Event' } ).click();
		date = await ( await responsePromise ).json();
		const saved = await api( `/fair-events/v1/event-dates/${ date.id }` );
		expect( saved.categories.map( ( cat ) => cat.id ) ).toEqual( [
			spanish.id,
		] );
	} finally {
		if ( date )
			await api(
				`/fair-events/v1/event-dates/${ date.id }`,
				'DELETE'
			).catch( () => {} );
		await api( '/fair-e2e/v1/term-languages', 'POST', {
			languages: {},
		} ).catch( () => {} );
		for ( const cat of cats.reverse() )
			await api(
				`/wp/v2/categories/${ cat.id }?force=true`,
				'DELETE'
			).catch( () => {} );
	}
} );
