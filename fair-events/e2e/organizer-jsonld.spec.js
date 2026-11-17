import { test, expect } from '@playwright/test';
import { timingFields } from '../../e2e/support/event-timing.js';
import { setExperimentalFeature } from '../../e2e/support/experimental-features.js';

// The tests site runs fair-events-experimental, whose `organizers` bundle
// replaces the Organizer tab covered here; test the core tab on its own.
let previousOrganizersFeature;
test.beforeAll( () => {
	previousOrganizersFeature = setExperimentalFeature( 'organizers', false );
} );
test.afterAll( () => {
	setExperimentalFeature( 'organizers', previousOrganizersFeature );
} );

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the sitewide Organization JSON-LD block and the event
 * `organizer` reference built from the `fair_events_organizer` setting.
 */

async function apiFetch( page, options ) {
	// `wp.apiFetch` only loads on admin screens; after checking a public
	// page's JSON-LD, return to one before calling the REST API.
	const hasApiFetch = await page.evaluate(
		() => typeof window.wp?.apiFetch === 'function'
	);
	if ( ! hasApiFetch ) {
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );
	}
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
					data: err && err.data,
					raw: JSON.stringify( err ),
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

async function getJsonLdByType( page, url, type ) {
	await page.goto( url );
	const scripts = await page
		.locator( 'script[type="application/ld+json"]' )
		.allTextContents();
	for ( const raw of scripts ) {
		const data = JSON.parse( raw );
		if ( type === data[ '@type' ] ) {
			return data;
		}
	}
	return null;
}

test.describe( 'Fair Events sitewide Organization JSON-LD', () => {
	test( 'emits a configured Organization block and matching event organizer, and falls back once cleared', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		await page.setViewportSize( { width: 1200, height: 900 } );
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );

		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_organizer: {
					name: 'Acme Sports Club',
					type: 'SportsClub',
					street_address: 'Main St 1',
					address_locality: 'Madrid',
					address_country: 'ES',
					same_as: [ 'https://example.com/acme' ],
					website: 'https://acme.example',
					contact_email: 'info@acme.example',
					contact_phone: '+34 600 000 000',
				},
			},
		} );

		const now = new Date();
		const start = new Date( now.getTime() + 24 * 60 * 60 * 1000 );
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );

		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Organizer JSON-LD Test Event',
				...timingFields(
					iso( start ),
					iso( new Date( start.getTime() + 2 * 60 * 60 * 1000 ) )
				),
				all_day: false,
			},
		} );

		const post = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		} );
		const postId = post.event_id || post.post_id;
		const permalink = post.link || `/?p=${ postId }`;

		// Sitewide Organization block, present on any front-end page.
		const org = await getJsonLdByType( page, '/', 'SportsClub' );
		expect( org ).toBeTruthy();
		expect( org.name ).toBe( 'Acme Sports Club' );
		expect( org.address.addressLocality ).toBe( 'Madrid' );
		expect( org.sameAs ).toEqual( [ 'https://example.com/acme' ] );
		expect( org.url ).toBe( 'https://acme.example' );
		expect( org.contactPoint ).toMatchObject( {
			'@type': 'ContactPoint',
			contactType: 'customer service',
			email: 'info@acme.example',
			telephone: '+34 600 000 000',
		} );
		const organizationId = org[ '@id' ];
		expect( organizationId ).toBeTruthy();

		// The event's organizer references the same identity node, with the
		// overridden website (not home_url()) and no repeated contactPoint.
		const event = await getJsonLdByType( page, permalink, 'Event' );
		expect( event.organizer[ '@id' ] ).toBe( organizationId );
		expect( event.organizer.name ).toBe( 'Acme Sports Club' );
		expect( event.organizer.url ).toBe( 'https://acme.example' );
		expect( event.organizer.contactPoint ).toBeUndefined();

		// Clear the setting: the event organizer falls back to today's
		// site-name/home-URL behaviour, unchanged.
		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_events_organizer: {} },
		} );

		const clearedEvent = await getJsonLdByType( page, permalink, 'Event' );
		expect( clearedEvent.organizer[ '@id' ] ).toBeUndefined();
		expect( clearedEvent.organizer[ '@type' ] ).toBe( 'Organization' );

		const clearedOrg = await getJsonLdByType( page, '/', 'Organization' );
		expect( clearedOrg ).toBeFalsy();

		// Cleanup.
		await apiFetch( page, {
			path: `/wp/v2/fair_event/${ postId }?force=true`,
			method: 'DELETE',
		} ).catch( () => {} );
		await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }`,
			method: 'DELETE',
		} ).catch( () => {} );
	} );

	test( 'saves private notification recipients from the Organizer tab and keeps them out of public output', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const privateEmail = 'private-recipient-2303@acme.example';

		await page.setViewportSize( { width: 1200, height: 900 } );
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );

		await apiFetch( page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_organizer: {
					name: 'Acme Private Recipients',
					contact_email: 'info@acme.example',
				},
			},
		} );

		const now = new Date();
		const start = new Date( now.getTime() + 24 * 60 * 60 * 1000 );
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Organizer Recipients Test Event',
				...timingFields(
					iso( start ),
					iso( new Date( start.getTime() + 2 * 60 * 60 * 1000 ) )
				),
				all_day: false,
			},
		} );
		const post = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		} );
		const postId = post.event_id || post.post_id;
		const permalink = post.link || `/?p=${ postId }`;

		try {
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-settings&tab=organizer'
			);
			await page
				.getByRole( 'button', { name: 'Add email address' } )
				.click();
			await page
				.getByLabel( 'Notification email address' )
				.fill( privateEmail );
			await page
				.getByRole( 'button', { name: 'Save organizer' } )
				.click();
			await expect(
				page
					.locator( '.components-notice__content' )
					.getByText( 'Organizer settings saved successfully.' )
			).toBeVisible();

			// Reload: the saved address comes back from the server, and the
			// public identity is untouched.
			await page.reload();
			await expect(
				page.getByLabel( 'Notification email address' )
			).toHaveValue( privateEmail );
			await expect( page.getByLabel( 'Name' ) ).toHaveValue(
				'Acme Private Recipients'
			);
			await expect( page.getByLabel( 'Contact email' ) ).toHaveValue(
				'info@acme.example'
			);

			// Public pages: the contact email is published, the private
			// recipient never is (JSON-LD or anywhere else in the markup).
			for ( const url of [ '/', permalink ] ) {
				const response = await page.request.get( url );
				const html = await response.text();
				expect( html ).not.toContain( privateEmail );
			}
			const org = await getJsonLdByType( page, '/', 'Organization' );
			expect( org.contactPoint.email ).toBe( 'info@acme.example' );
			expect( JSON.stringify( org ) ).not.toContain( privateEmail );
		} finally {
			await page.goto(
				'/wp-admin/admin.php?page=fair-events-all-events'
			);
			await page.waitForFunction( () => window.wp && window.wp.apiFetch );
			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: { fair_events_organizer: {} },
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/fair_event/${ postId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );

	test( 'emits person and company identities with the chosen Schema.org type and no private recipients', async ( {
		page,
	} ) => {
		test.setTimeout( 120_000 );

		const privateEmail = 'private-person-2304@acme.example';

		await page.setViewportSize( { width: 1200, height: 900 } );
		await login( page );
		await page.goto( '/wp-admin/admin.php?page=fair-events-all-events' );
		await page.waitForFunction( () => window.wp && window.wp.apiFetch );

		const now = new Date();
		const start = new Date( now.getTime() + 24 * 60 * 60 * 1000 );
		const iso = ( d ) => d.toISOString().slice( 0, 19 ).replace( 'T', ' ' );
		const eventDate = await apiFetch( page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Organizer Person Test Event',
				...timingFields(
					iso( start ),
					iso( new Date( start.getTime() + 2 * 60 * 60 * 1000 ) )
				),
				all_day: false,
			},
		} );
		const post = await apiFetch( page, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		} );
		const postId = post.event_id || post.post_id;
		const permalink = post.link || `/?p=${ postId }`;

		try {
			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					fair_events_organizer: {
						name: 'Ana García',
						type: 'Person',
						address_locality: 'Madrid',
						contact_email: 'ana@acme.example',
						notification_emails: [ privateEmail ],
					},
				},
			} );

			const person = await getJsonLdByType( page, '/', 'Person' );
			expect( person ).toMatchObject( {
				name: 'Ana García',
				address: { addressLocality: 'Madrid' },
				contactPoint: { email: 'ana@acme.example' },
			} );
			expect( person.logo ).toBeUndefined();
			expect( JSON.stringify( person ) ).not.toContain( privateEmail );

			const event = await getJsonLdByType( page, permalink, 'Event' );
			expect( event.organizer ).toMatchObject( {
				'@type': 'Person',
				'@id': person[ '@id' ],
				name: 'Ana García',
			} );
			for ( const url of [ '/', permalink ] ) {
				const html = await ( await page.request.get( url ) ).text();
				expect( html ).not.toContain( privateEmail );
			}

			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					fair_events_organizer: {
						name: 'Acme Ltd',
						type: 'Corporation',
					},
				},
			} );
			const company = await getJsonLdByType( page, '/', 'Corporation' );
			expect( company.name ).toBe( 'Acme Ltd' );
			const companyEvent = await getJsonLdByType(
				page,
				permalink,
				'Event'
			);
			expect( companyEvent.organizer[ '@type' ] ).toBe( 'Corporation' );
		} finally {
			await apiFetch( page, {
				path: '/wp/v2/settings',
				method: 'POST',
				data: { fair_events_organizer: {} },
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/wp/v2/fair_event/${ postId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
			await apiFetch( page, {
				path: `/fair-events/v1/event-dates/${ eventDate.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
	} );
} );
