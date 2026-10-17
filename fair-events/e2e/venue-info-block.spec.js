import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASSWORD || 'password';

/**
 * E2E coverage for #1903: the Venue Info block shows a selected venue's
 * current details on any page — name linked by website → Google Maps →
 * Instagram priority, address, and labelled destination links — renders
 * nothing for an unset or deleted venue, and keeps each block's selection
 * independent. Editors choose venues with a searchable, keyboard-operable
 * selector and preview the same server render visitors get.
 */

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const res = await wp.apiFetch( opts );
			return { ok: true, data: res };
		} catch ( err ) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
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

const venueBlock = ( id ) =>
	`<!-- wp:fair-events/venue-info {"venueId":${ id }} /-->`;

/**
 * Describe a rendered block's name link and destination links.
 *
 * @param {import('@playwright/test').Locator} block Block wrapper.
 * @return {Promise<Object>} Name, name href, and links by label.
 */
async function describeBlock( block ) {
	return block.evaluate( ( el ) => {
		const visibleText = ( node ) => {
			const clone = node.cloneNode( true );
			clone
				.querySelectorAll( '.wp-block-fair-events-venue-info__new-tab' )
				.forEach( ( hidden ) => hidden.remove() );
			return clone.textContent.trim();
		};
		const nameEl = el.querySelector(
			'.wp-block-fair-events-venue-info__name'
		);
		const nameLink = nameEl.querySelector( 'a' );
		const address = el.querySelector(
			'.wp-block-fair-events-venue-info__address'
		);
		return {
			name: visibleText( nameEl ),
			nameHref: nameLink ? nameLink.getAttribute( 'href' ) : null,
			address: address ? address.innerText.trim() : null,
			links: [
				...el.querySelectorAll(
					'.wp-block-fair-events-venue-info__links a'
				),
			].map( ( a ) => [ visibleText( a ), a.getAttribute( 'href' ) ] ),
			allLinksOpenSafely: [ ...el.querySelectorAll( 'a' ) ].every(
				( a ) =>
					a.getAttribute( 'target' ) === '_blank' &&
					a.getAttribute( 'rel' ) === 'noopener noreferrer'
			),
		};
	} );
}

test.describe( 'Venue Info block', () => {
	let adminContext;
	let adminPage;
	const venueIds = [];
	const pageIds = [];

	async function createVenue( data ) {
		const venue = await apiFetch( adminPage, {
			path: '/fair-events/v1/venues',
			method: 'POST',
			data,
		} );
		venueIds.push( venue.id );
		return venue;
	}

	async function deleteVenue( id ) {
		await apiFetch( adminPage, {
			path: `/fair-events/v1/venues/${ id }`,
			method: 'DELETE',
		} );
	}

	async function createPage( title, content ) {
		const page = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: { title, status: 'publish', content },
		} );
		pageIds.push( page.id );
		return page;
	}

	async function rawContent( pageId ) {
		const page = await apiFetch( adminPage, {
			path: `/wp/v2/pages/${ pageId }?context=edit`,
		} );
		return page.content.raw;
	}

	async function openEditor( pageId ) {
		await adminPage.goto(
			`/wp-admin/post.php?post=${ pageId }&action=edit`
		);
		const editorFrame = adminPage.frameLocator( '[name="editor-canvas"]' );
		await editorFrame.locator( '.block-editor-iframe__body' ).waitFor();
		await adminPage.evaluate( () =>
			// eslint-disable-next-line no-undef
			wp.data
				.dispatch( 'core/preferences' )
				.set( 'core/edit-post', 'welcomeGuide', false )
		);
		const welcomeGuide = adminPage.locator( '.components-guide' );
		if ( await welcomeGuide.isVisible().catch( () => false ) ) {
			await adminPage
				.getByRole( 'button', { name: 'Close' } )
				.first()
				.click();
		}
		return editorFrame;
	}

	async function selectBlockAt( index ) {
		await adminPage.evaluate( ( i ) => {
			// eslint-disable-next-line no-undef
			const { select, dispatch } = wp.data;
			const blocks = select( 'core/block-editor' )
				.getBlocks()
				.filter( ( b ) => b.name === 'fair-events/venue-info' );
			dispatch( 'core/block-editor' ).selectBlock( blocks[ i ].clientId );
			dispatch( 'core/edit-post' ).openGeneralSidebar(
				'edit-post/block'
			);
		}, index );
	}

	async function chooseWithKeyboard( combobox, name ) {
		await combobox.focus();
		await adminPage.keyboard.type( name.slice( 0, 12 ) );
		await adminPage.keyboard.press( 'ArrowDown' );
		await adminPage.keyboard.press( 'Enter' );
	}

	async function insertVenueInfoBlock( editorFrame ) {
		// Slash command from a new paragraph: keyboard-only insertion.
		await adminPage.evaluate( () => {
			// eslint-disable-next-line no-undef
			const { dispatch } = wp.data;
			// eslint-disable-next-line no-undef
			const block = wp.blocks.createBlock( 'core/paragraph' );
			dispatch( 'core/block-editor' ).insertBlock( block );
			dispatch( 'core/block-editor' ).selectBlock( block.clientId );
		} );
		await editorFrame
			.locator( '[data-type="core/paragraph"][contenteditable="true"]' )
			.last()
			.focus();
		await adminPage.keyboard.type( '/Venue Info' );
		await expect(
			adminPage.getByRole( 'option', { name: /Venue Info/ } ).first()
		).toBeVisible();
		await adminPage.keyboard.press( 'Enter' );
	}

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto( '/wp-admin/admin.php?page=fair-events-venues' );
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);
	} );

	test.afterAll( async () => {
		for ( const id of pageIds ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ id }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		for ( const id of venueIds ) {
			await deleteVenue( id ).catch( () => {} );
		}
		await adminContext.close();
	} );

	test( 'public page follows the name-link priority and omits missing or unsafe fields', async ( {
		browser,
	} ) => {
		const stamp = Date.now();
		const full = await createVenue( {
			name: `Full venue ${ stamp }`,
			address: '12 Example Street\n46001 Valencia',
			latitude: '39.4699',
			longitude: '-0.3763',
			website_url: 'https://full.example.org/',
			facebook_page_link: 'https://www.facebook.com/full-example',
			instagram_handle: '@full_example',
		} );
		const mapsOnly = await createVenue( {
			name: `Maps venue ${ stamp }`,
			address: '5 Sample Square, Valencia',
			instagram_handle: 'maps.example',
		} );
		const instagramOnly = await createVenue( {
			name: `Instagram venue ${ stamp }`,
			instagram_handle: 'insta_example',
		} );
		const plain = await createVenue( {
			name: `Plain venue ${ stamp }`,
			facebook_page_link: 'https://www.facebook.com/plain-example',
		} );
		const unsafe = await createVenue( {
			name: `<img src=x onerror="window.venueXss=1"> Unsafe ${ stamp }`,
			address: '<script>window.venueXss=1</script>',
			facebook_page_link: 'ftp://files.example.org/venue',
			instagram_handle: 'not a handle!',
		} );
		const deleted = await createVenue( { name: `Deleted ${ stamp }` } );
		await deleteVenue( deleted.id );

		const page = await createPage(
			`Venue info public ${ stamp }`,
			[
				venueBlock( full.id ),
				venueBlock( mapsOnly.id ),
				venueBlock( instagramOnly.id ),
				venueBlock( plain.id ),
				venueBlock( unsafe.id ),
				venueBlock( deleted.id ),
				'<!-- wp:fair-events/venue-info /-->',
			].join( '\n\n' )
		);

		const visitorContext = await browser.newContext();
		const visitor = await visitorContext.newPage();
		try {
			await visitor.goto( page.link );
			const blocks = visitor.locator(
				'.wp-block-fair-events-venue-info'
			);
			// Deleted and unset venues render nothing at all.
			await expect( blocks ).toHaveCount( 5 );

			const fullBlock = await describeBlock( blocks.nth( 0 ) );
			expect( fullBlock.name ).toBe( full.name );
			expect( fullBlock.nameHref ).toBe( 'https://full.example.org/' );
			expect( fullBlock.address ).toBe(
				'12 Example Street\n46001 Valencia'
			);
			expect( fullBlock.links ).toEqual( [
				[ 'Website', 'https://full.example.org/' ],
				[
					'Google Maps',
					'https://www.google.com/maps/search/?api=1&query=39.4699%2C-0.3763',
				],
				[ 'Facebook', 'https://www.facebook.com/full-example' ],
				[ 'Instagram', 'https://www.instagram.com/full_example/' ],
			] );
			expect( fullBlock.allLinksOpenSafely ).toBe( true );

			const mapsBlock = await describeBlock( blocks.nth( 1 ) );
			const addressMapsUrl =
				'https://www.google.com/maps/search/?api=1&query=5%20Sample%20Square%2C%20Valencia';
			expect( mapsBlock.nameHref ).toBe( addressMapsUrl );
			expect( mapsBlock.links ).toEqual( [
				[ 'Google Maps', addressMapsUrl ],
				[ 'Instagram', 'https://www.instagram.com/maps.example/' ],
			] );

			const instagramBlock = await describeBlock( blocks.nth( 2 ) );
			expect( instagramBlock.nameHref ).toBe(
				'https://www.instagram.com/insta_example/'
			);
			expect( instagramBlock.address ).toBeNull();
			expect( instagramBlock.links ).toEqual( [
				[ 'Instagram', 'https://www.instagram.com/insta_example/' ],
			] );

			// Facebook is never the name link.
			const plainBlock = await describeBlock( blocks.nth( 3 ) );
			expect( plainBlock.name ).toBe( plain.name );
			expect( plainBlock.nameHref ).toBeNull();
			expect( plainBlock.links ).toEqual( [
				[ 'Facebook', 'https://www.facebook.com/plain-example' ],
			] );

			const unsafeBlock = await describeBlock( blocks.nth( 4 ) );
			expect( unsafeBlock.name ).toBe( unsafe.name );
			expect( unsafeBlock.nameHref ).toBeNull();
			expect( unsafeBlock.links ).toEqual( [] );
			await expect(
				blocks.nth( 4 ).locator( 'img, script, ul' )
			).toHaveCount( 0 );
			expect(
				await visitor.evaluate( () => window.venueXss )
			).toBeUndefined();

			// Links are reachable in order with the keyboard.
			await blocks.nth( 0 ).getByRole( 'link' ).first().focus();
			await visitor.keyboard.press( 'Tab' );
			await expect(
				blocks.nth( 0 ).getByRole( 'link', { name: /^Website/ } )
			).toBeFocused();
		} finally {
			await visitorContext.close();
		}
	} );

	test( 'venue changes and deletion reach the page without editing it', async ( {
		browser,
	} ) => {
		const stamp = Date.now();
		const venue = await createVenue( {
			name: `Changing venue ${ stamp }`,
			address: 'Old Street 1',
		} );
		const other = await createVenue( { name: `Steady venue ${ stamp }` } );
		const page = await createPage(
			`Venue info updates ${ stamp }`,
			`${ venueBlock( venue.id ) }\n\n${ venueBlock( other.id ) }`
		);

		const visitorContext = await browser.newContext();
		const visitor = await visitorContext.newPage();
		try {
			await visitor.goto( page.link );
			const blocks = visitor.locator(
				'.wp-block-fair-events-venue-info'
			);
			await expect( blocks.nth( 0 ) ).toContainText( 'Old Street 1' );

			await apiFetch( adminPage, {
				path: `/fair-events/v1/venues/${ venue.id }`,
				method: 'PUT',
				data: {
					name: `Renamed venue ${ stamp }`,
					address: 'New Street 2',
					website_url: 'https://renamed.example.org/',
				},
			} );

			await visitor.reload();
			const updated = await describeBlock( blocks.nth( 0 ) );
			expect( updated.name ).toBe( `Renamed venue ${ stamp }` );
			expect( updated.address ).toBe( 'New Street 2' );
			expect( updated.nameHref ).toBe( 'https://renamed.example.org/' );

			await deleteVenue( venue.id );
			const response = await visitor.reload();
			expect( response.status() ).toBe( 200 );
			await expect( blocks ).toHaveCount( 1 );
			await expect( blocks.first() ).toContainText( other.name );
			await expect( visitor.locator( 'body' ) ).not.toContainText(
				/Warning|Fatal error|Notice:/
			);
		} finally {
			await visitorContext.close();
		}
	} );

	test( 'editors insert, choose, change, and clear venues with the keyboard; the preview matches the page', async ( {
		browser,
	} ) => {
		const stamp = Date.now();
		const first = await createVenue( {
			name: `Alpha hall ${ stamp }`,
			address: 'Alpha Street 1',
			website_url: 'https://alpha.example.org/',
		} );
		const second = await createVenue( {
			name: `Beta studio ${ stamp }`,
			instagram_handle: 'beta_studio',
		} );
		const third = await createVenue( {
			name: `Gamma room ${ stamp }`,
			address: 'Gamma Square 3',
		} );
		const page = await createPage(
			`Venue info editor ${ stamp }`,
			// Non-empty, so the editor skips the starter-pattern modal.
			'<!-- wp:paragraph --><p>Where we meet:</p><!-- /wp:paragraph -->'
		);

		const editorFrame = await openEditor( page.id );
		const editorBlocks = editorFrame.locator(
			'[data-type="fair-events/venue-info"]'
		);

		// Two blocks, each with its own venue.
		await insertVenueInfoBlock( editorFrame );
		await expect(
			editorBlocks
				.nth( 0 )
				.getByText( 'Choose the venue whose details this block shows.' )
		).toBeVisible();
		await chooseWithKeyboard(
			editorBlocks.nth( 0 ).getByRole( 'combobox', { name: 'Venue' } ),
			first.name
		);
		await expect(
			editorBlocks
				.nth( 0 )
				.locator( '.wp-block-fair-events-venue-info__name' )
		).toContainText( first.name );

		await insertVenueInfoBlock( editorFrame );
		await chooseWithKeyboard(
			editorBlocks.nth( 1 ).getByRole( 'combobox', { name: 'Venue' } ),
			second.name
		);
		await expect(
			editorBlocks
				.nth( 1 )
				.locator( '.wp-block-fair-events-venue-info__name' )
		).toContainText( second.name );

		await adminPage
			.getByRole( 'button', { name: 'Save', exact: true } )
			.click();
		await expect
			.poll( () => rawContent( page.id ), { timeout: 15000 } )
			.toContain( `"venueId":${ second.id }` );
		expect( await rawContent( page.id ) ).toContain(
			`"venueId":${ first.id }`
		);

		// Reopen: both selections persist and preview like the public page.
		await openEditor( page.id );
		await expect(
			editorBlocks
				.nth( 1 )
				.locator( '.wp-block-fair-events-venue-info__name' )
		).toContainText( second.name );
		const visitorContext = await browser.newContext();
		const visitor = await visitorContext.newPage();
		try {
			await visitor.goto( page.link );
			const publicBlocks = visitor.locator(
				'.wp-block-fair-events-venue-info'
			);
			await expect( publicBlocks ).toHaveCount( 2 );
			for ( const index of [ 0, 1 ] ) {
				const preview = editorBlocks
					.nth( index )
					.locator( '.wp-block-fair-events-venue-info' )
					.last();
				await preview
					.locator( '.wp-block-fair-events-venue-info__name' )
					.waitFor();
				expect( await describeBlock( preview ) ).toEqual(
					await describeBlock( publicBlocks.nth( index ) )
				);
			}

			// Change the first block from the sidebar; the second keeps its venue.
			await selectBlockAt( 0 );
			const sidebarVenue = adminPage
				.locator( '.block-editor-block-inspector' )
				.getByRole( 'combobox', { name: 'Venue' } );
			await expect( sidebarVenue ).toHaveValue( first.name );
			await sidebarVenue.fill( '' );
			await chooseWithKeyboard( sidebarVenue, third.name );
			await expect(
				editorBlocks
					.nth( 0 )
					.locator( '.wp-block-fair-events-venue-info__name' )
			).toContainText( third.name );

			await adminPage
				.getByRole( 'button', { name: 'Save', exact: true } )
				.click();
			await expect
				.poll( () => rawContent( page.id ), { timeout: 15000 } )
				.toContain( `"venueId":${ third.id }` );
			await visitor.reload();
			await expect( publicBlocks.nth( 0 ) ).toContainText( third.name );
			await expect( publicBlocks.nth( 1 ) ).toContainText( second.name );

			// Clearing shows guidance again and the page drops that block.
			await selectBlockAt( 0 );
			await adminPage
				.locator( '.block-editor-block-inspector' )
				.getByRole( 'button', { name: 'Reset' } )
				.click();
			await expect(
				editorBlocks
					.nth( 0 )
					.getByText(
						'Choose the venue whose details this block shows.'
					)
			).toBeVisible();
			await adminPage
				.getByRole( 'button', { name: 'Save', exact: true } )
				.click();
			await expect
				.poll( () => rawContent( page.id ), { timeout: 15000 } )
				.not.toContain( `"venueId":${ third.id }` );
			await visitor.reload();
			await expect( publicBlocks ).toHaveCount( 1 );
			await expect( publicBlocks.first() ).toContainText( second.name );
		} finally {
			await visitorContext.close();
		}
	} );

	test( 'editors see guidance for a deleted venue', async () => {
		const stamp = Date.now();
		const deleted = await createVenue( { name: `Gone ${ stamp }` } );
		await deleteVenue( deleted.id );
		const page = await createPage(
			`Venue info deleted ${ stamp }`,
			venueBlock( deleted.id )
		);

		const editorFrame = await openEditor( page.id );
		const block = editorFrame.locator(
			'[data-type="fair-events/venue-info"]'
		);
		await expect(
			block.getByText(
				'The selected venue has been deleted. Visitors see nothing for this block until you choose another venue.'
			)
		).toBeVisible();
		await expect(
			block.getByRole( 'combobox', { name: 'Venue' } )
		).toBeVisible();
	} );
} );
