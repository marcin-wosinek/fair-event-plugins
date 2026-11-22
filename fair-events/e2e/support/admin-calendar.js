/**
 * Shared helpers for the admin calendar E2E specs: login, `wp.apiFetch`
 * calls, URL parameters, and category/event-date fixtures with cleanup.
 */
import { timingFields } from '../../../e2e/support/event-timing.js';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

export const CALENDAR_PATH = '/wp-admin/admin.php?page=fair-events-calendar';

export async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

/**
 * Log in and open the calendar so `wp.apiFetch` is available.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
export async function openCalendar( page ) {
	await login( page );
	await page.goto( CALENDAR_PATH );
	await page.waitForFunction( () => window.wp?.apiFetch );
}

export async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error( result.error );
	}
	return result.data;
}

export function searchParam( page, name ) {
	return new URL( page.url() ).searchParams.get( name );
}

/**
 * Fixture tracker: create categories and event dates, then delete them all.
 *
 * @param {import('@playwright/test').Page} page Page with `wp.apiFetch`.
 * @return {Object} createCategory, createEventDate and cleanup.
 */
export function calendarFixtures( page ) {
	const categories = [];
	const eventDates = [];

	return {
		async createCategory( name ) {
			const category = await apiFetch( page, {
				path: '/wp/v2/categories',
				method: 'POST',
				data: { name },
			} );
			categories.push( category );
			return category;
		},
		async createEventDate( title, start, end, categoryIds = [] ) {
			const eventDate = await apiFetch( page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title,
					...timingFields( start, end ),
					link_type: 'none',
					categories: categoryIds,
				},
			} );
			eventDates.push( eventDate );
			return eventDate;
		},
		async cleanup() {
			for ( const eventDate of eventDates ) {
				await apiFetch( page, {
					path: `/fair-events/v1/event-dates/${ eventDate.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
			for ( const category of categories ) {
				await apiFetch( page, {
					path: `/wp/v2/categories/${ category.id }?force=true`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
		},
	};
}
