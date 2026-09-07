import { test, expect } from '@playwright/test';

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

test( 'venue table and unsaved dialog values expose Google Maps links', async ( {
	page,
} ) => {
	await login( page );
	const venue = await page.evaluate( async () =>
		window.wp.apiFetch( {
			path: '/fair-events/v1/venues',
			method: 'POST',
			data: {
				name: `Map preview venue ${ Date.now() }`,
				latitude: '0',
				longitude: '0',
			},
		} )
	);

	try {
		await page.goto( '/wp-admin/admin.php?page=fair-events-venues' );
		const tableLink = page.getByRole( 'link', {
			name: new RegExp( `${ venue.name }.*opens in a new tab`, 'i' ),
		} );
		await expect( tableLink ).toHaveAttribute( 'target', '_blank' );
		await expect( tableLink ).toHaveAttribute(
			'rel',
			'noopener noreferrer'
		);
		await expect( tableLink ).toHaveAttribute( 'href', /query=0%2C0$/ );

		await page.getByRole( 'button', { name: 'Add New Venue' } ).click();
		await page.getByLabel( 'Address' ).fill( 'Unsaved map address' );
		const previewLink = page.getByRole( 'link', {
			name: 'Test Google Maps link',
		} );
		await expect( previewLink ).toHaveAttribute(
			'href',
			/Unsaved%20map%20address$/
		);
		await page.getByLabel( 'Latitude' ).fill( '39.48' );
		await page.getByLabel( 'Longitude' ).fill( '-0.36' );
		await expect( previewLink ).toHaveAttribute(
			'href',
			/query=39.48%2C-0.36$/
		);
	} finally {
		await page.evaluate(
			async ( venueId ) =>
				window.wp.apiFetch( {
					path: `/fair-events/v1/venues/${ venueId }`,
					method: 'DELETE',
				} ),
			venue.id
		);
	}
} );
