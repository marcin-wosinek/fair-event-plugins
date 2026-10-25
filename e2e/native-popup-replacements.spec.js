import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

/*
 * Native popup replacements outside the core plugins (#1936): consequential
 * actions confirm in an accessible dialog that blocks dismissal while its
 * request runs and keeps a failure for a retry. Every write is intercepted
 * with a fake answer, so no stored state changes.
 */

/**
 * Route REST requests whose (decoded) URL contains `fragment`, whatever the
 * permalink structure.
 *
 * @param {import('@playwright/test').Page} page     Playwright page.
 * @param {string}                          fragment REST route fragment.
 * @param {Function}                        handler  Route handler.
 */
function routeRest( page, fragment, handler ) {
	return page.route(
		( url ) => decodeURIComponent( url.href ).includes( fragment ),
		handler
	);
}

/**
 * The REST method of a request; apiFetch sends DELETE as a POST with an
 * override header.
 *
 * @param {import('@playwright/test').Request} request Intercepted request.
 * @return {string} HTTP method
 */
const methodOf = ( request ) =>
	request.headers()[ 'x-http-method-override' ] || request.method();

const json = ( route, body, status = 200 ) =>
	route.fulfill( {
		status,
		contentType: 'application/json',
		body: JSON.stringify( body ),
	} );

test.describe( 'Native popup replacements (#1936)', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
		// Fail loudly if any native popup still opens.
		page.on( 'dialog', ( dialog ) => {
			throw new Error(
				`Native ${ dialog.type() } opened: ${ dialog.message() }`
			);
		} );
	} );

	test( 'connection log cleanup confirms, blocks dismissal while pending, and retries a failure', async ( {
		page,
	} ) => {
		const cleanups = [];
		let release;
		await routeRest(
			page,
			'fair-platform/v1/connections/cleanup',
			( route ) => {
				cleanups.push( route.request().url() );
				if ( cleanups.length === 1 ) {
					// Held until the test has checked the pending state, then failed.
					return new Promise( ( resolve ) => {
						release = () =>
							resolve(
								json(
									route,
									{
										code: 'cleanup_failed',
										message: 'Database busy.',
									},
									500
								)
							);
					} );
				}
				return json( route, {
					deleted: 3,
					message: 'Deleted 3 old log entries.',
				} );
			}
		);

		await page.goto( '/wp-admin/admin.php?page=fair-platform-connections' );
		const trigger = page.getByRole( 'button', {
			name: 'Cleanup Old Logs',
		} );

		// Escape closes an idle dialog and hands focus back to its trigger.
		await trigger.click();
		const dialog = page.getByRole( 'dialog', {
			name: 'Delete old connection logs',
		} );
		await expect( dialog ).toContainText( 'older than 90 days' );
		await expect( dialog ).toContainText(
			'existing connections keep working'
		);
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();
		expect( cleanups ).toHaveLength( 0 );

		// Keyboard only: open, confirm.
		await trigger.focus();
		await page.keyboard.press( 'Enter' );
		await expect( dialog ).toBeVisible();
		const confirm = dialog.getByRole( 'button', {
			name: 'Delete old logs',
		} );
		await confirm.focus();
		await page.keyboard.press( 'Enter' );

		await expect(
			dialog.getByRole( 'button', { name: 'Deleting…' } )
		).toBeVisible();
		await expect(
			dialog.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeVisible();
		expect( cleanups ).toHaveLength( 1 );

		release();
		await expect(
			dialog.locator( '.components-notice__content' )
		).toHaveText( 'Database busy.' );

		await dialog.getByRole( 'button', { name: 'Delete old logs' } ).click();
		await expect( dialog ).toBeHidden();
		await expect(
			page.locator( '.components-notice__content', {
				hasText: 'Deleted 3 old log entries.',
			} )
		).toBeVisible();
		expect( cleanups ).toHaveLength( 2 );
		expect( cleanups[ 1 ] ).toContain( 'days=90' );
	} );

	test( 'poll deletion names the poll and sends nothing when cancelled', async ( {
		page,
	} ) => {
		const poll = {
			id: 987001,
			title: 'E2E Venue poll',
			question: 'Which evening suits you?',
			status: 'draft',
			created_at: '2026-10-01 10:00:00',
		};
		const deletes = [];
		await routeRest( page, 'fair-audience/v1/polls', ( route ) => {
			if ( methodOf( route.request() ) === 'DELETE' ) {
				deletes.push( route.request().url() );
				return json( route, { deleted: true } );
			}
			return json( route, deletes.length ? [] : [ poll ] );
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-audience-polls' );
		const trigger = page.getByRole( 'button', { name: 'Delete' } );
		await trigger.click();

		const dialog = page.getByRole( 'dialog', {
			name: 'Delete poll — E2E Venue poll',
		} );
		await expect( dialog ).toContainText( 'Which evening suits you?' );
		await expect( dialog ).toContainText(
			'Invitation links already sent stop working'
		);

		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();
		expect( deletes ).toHaveLength( 0 );

		await trigger.click();
		await dialog.getByRole( 'button', { name: 'Delete poll' } ).click();
		await expect( dialog ).toBeHidden();
		await expect(
			page.locator( '.components-notice__content', {
				hasText: 'Poll “E2E Venue poll” deleted.',
			} )
		).toBeVisible();
		expect( deletes ).toHaveLength( 1 );
		expect( decodeURIComponent( deletes[ 0 ] ) ).toContain(
			'polls/987001'
		);
	} );
} );
