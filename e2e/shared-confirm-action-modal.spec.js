/**
 * The confirmation dialog shared from fair-events-shared (#2228), as each of
 * its five plugins uses it: a pending action blocks every way of dismissing
 * the dialog and a second request, a failure stays in the dialog and can be
 * retried, Escape on an idle dialog hands focus back to its trigger, and a
 * long title wraps at desktop, tablet and 375px widths. Finance's unsplit
 * confirmation covers the case of a dialog nested in another.
 *
 * Lists are answered with synthetic rows and every mutation is intercepted,
 * so nothing stored changes, apart from Finance's split entry fixture.
 *
 * Needs a current `npm run build` in the five plugins.
 * Run: `npm run test:e2e:local -- e2e/shared-confirm-action-modal.spec.js`.
 */
import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const STAMP = Date.now().toString( 36 );
const LONG = `E2E confirmation target with a deliberately long name that must wrap instead of being clipped ${ STAMP }`;

const VIEWPORTS = [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'tablet', width: 768, height: 1024 },
	{ name: 'mobile', width: 375, height: 812 },
];

/**
 * The REST method of a request; apiFetch sends DELETE as a POST with an
 * override header.
 *
 * @param {import('@playwright/test').Request} req Intercepted request.
 * @return {string} HTTP method
 */
const methodOf = ( req ) =>
	req.headers()[ 'x-http-method-override' ] || req.method();

const json = ( route, body, status = 200 ) =>
	route.fulfill( {
		status,
		contentType: 'application/json',
		body: JSON.stringify( body ),
	} );

/**
 * Answer a plugin's REST requests: `list` answers reads, and every write is
 * counted, the first held until released and then failed, later ones
 * answered with `success`.
 *
 * @param {import('@playwright/test').Page} page            Playwright page.
 * @param {Object}                          options         Options.
 * @param {string}                          options.match   REST route fragment.
 * @param {Function}                        [options.list]  Read handler, given the decoded URL.
 * @param {Object}                          options.success Body of a successful write.
 * @return {Promise<Object>} `{ writes, release }`.
 */
async function interceptWrites( page, { match, list, success } ) {
	const state = { writes: [], release: null };
	await page.route(
		( url ) => decodeURIComponent( url.href ).includes( match ),
		( route ) => {
			const req = route.request();
			const url = decodeURIComponent( req.url() );
			if ( 'GET' === methodOf( req ) ) {
				return list ? list( route, url ) : route.continue();
			}
			state.writes.push( url );
			if ( 1 === state.writes.length ) {
				return new Promise( ( resolve ) => {
					state.release = () =>
						resolve(
							json(
								route,
								{
									code: 'e2e_failure',
									message: 'E2E: the server is busy.',
								},
								500
							)
						);
				} );
			}
			return json( route, success );
		}
	);
	return state;
}

/**
 * Check that the open dialog fits the viewport: its title wraps inside the
 * header, nothing scrolls sideways and the buttons stay inside the frame.
 *
 * @param {import('@playwright/test').Page}    page   Playwright page.
 * @param {import('@playwright/test').Locator} dialog The dialog.
 */
async function expectWrappedLayout( page, dialog ) {
	for ( const viewport of VIEWPORTS ) {
		await page.setViewportSize( viewport );
		const metrics = await dialog.evaluate( ( frame ) => {
			const heading = frame.querySelector(
				'.components-modal__header-heading'
			);
			const header = frame.querySelector( '.components-modal__header' );
			const box = ( el ) => el.getBoundingClientRect();
			const buttons = [ ...frame.querySelectorAll( 'button' ) ].filter(
				( b ) => ! b.closest( '.components-modal__header' )
			);
			return {
				// The admin page behind can be wider than a phone; the
				// dialog itself must not be.
				frameOverflow: Math.max(
					frame.scrollWidth - frame.clientWidth,
					box( frame ).right - window.innerWidth,
					-box( frame ).left
				),
				headingClipped: heading.scrollWidth - heading.clientWidth,
				headingBottom: box( heading ).bottom,
				headerBottom: box( header ).bottom,
				frameLeft: box( frame ).left,
				frameRight: box( frame ).right,
				buttonsLeft: Math.min(
					...buttons.map( ( b ) => box( b ).left )
				),
				buttonsRight: Math.max(
					...buttons.map( ( b ) => box( b ).right )
				),
				hasSharedClass: frame.classList.contains(
					'fair-confirm-action-modal'
				),
			};
		} );
		const where = `at ${ viewport.name } (${ viewport.width }px)`;
		expect( metrics.hasSharedClass, where ).toBe( true );
		expect( metrics.frameOverflow, where ).toBeLessThanOrEqual( 0 );
		expect( metrics.headingClipped, where ).toBeLessThanOrEqual( 1 );
		expect( metrics.headingBottom, where ).toBeLessThanOrEqual(
			metrics.headerBottom + 1
		);
		expect( metrics.buttonsLeft, where ).toBeGreaterThanOrEqual(
			metrics.frameLeft - 1
		);
		expect( metrics.buttonsRight, where ).toBeLessThanOrEqual(
			metrics.frameRight + 1
		);
	}
	await page.setViewportSize( VIEWPORTS[ 0 ] );
}

/**
 * Walk one confirmation through its states: Escape on the idle dialog
 * returns focus, the layout wraps, a pending request blocks dismissal and a
 * second request, the failure stays in the dialog, and a retry succeeds.
 *
 * @param {import('@playwright/test').Page} page                Playwright page.
 * @param {Object}                          options             Options.
 * @param {Function}                        options.open        Opens the dialog; returns the element focus returns to.
 * @param {string}                          options.title       Dialog name.
 * @param {string}                          options.confirm     Confirming button label.
 * @param {string}                          options.busy        Its label while pending.
 * @param {Object}                          options.writes      State from interceptWrites.
 * @param {string}                          options.cancelLabel Cancel label.
 */
async function exerciseConfirmation(
	page,
	{ open, title, confirm, busy, writes, cancelLabel = 'Cancel' }
) {
	const dialog = page.getByRole( 'dialog', { name: title } );

	// Idle: Escape closes and hands focus back.
	const trigger = await open();
	await expect( dialog ).toBeVisible();
	await expect(
		dialog.getByRole( 'button', { name: 'Close' } )
	).toBeVisible();
	await expectWrappedLayout( page, dialog );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toBeHidden();
	await expect( trigger ).toBeFocused();
	expect( writes.writes ).toHaveLength( 0 );

	// Pending: every dismissal and a second click are ignored.
	await open();
	const confirmButton = dialog.getByRole( 'button', { name: confirm } );
	await confirmButton.click();
	const pending = dialog.getByRole( 'button', { name: busy } );
	await expect( pending ).toBeVisible();
	await expect( pending ).toBeFocused();
	await pending.click( { force: true } );
	await expect(
		dialog.getByRole( 'button', { name: cancelLabel } )
	).toBeDisabled();
	await expect( dialog.getByRole( 'button', { name: 'Close' } ) ).toHaveCount(
		0
	);
	await page.keyboard.press( 'Escape' );
	await page.mouse.click( 2, 2 );
	await expect( dialog ).toBeVisible();
	expect( writes.writes ).toHaveLength( 1 );

	// Failure: the message stays in the dialog, which can retry.
	writes.release();
	await expect( dialog.locator( '.components-notice__content' ) ).toHaveText(
		'E2E: the server is busy.'
	);
	await expect( confirmButton ).toBeEnabled();

	await confirmButton.click();
	await expect( dialog ).toBeHidden();
	expect( writes.writes ).toHaveLength( 2 );
}

test.describe( 'Shared confirmation dialog (#2228)', () => {
	test.beforeEach( async ( { page } ) => {
		await page.setViewportSize( VIEWPORTS[ 0 ] );
		await loginAsAdmin( page );
		page.on( 'dialog', ( dialog ) => {
			throw new Error(
				`Native ${ dialog.type() } opened: ${ dialog.message() }`
			);
		} );
	} );

	test( 'Audience Experimental: poll deletion', async ( { page } ) => {
		const poll = {
			id: 987101,
			title: LONG,
			question: 'Which evening suits you?',
			status: 'draft',
			created_at: '2026-10-01 10:00:00',
		};
		const writes = await interceptWrites( page, {
			match: 'fair-audience/v1/polls',
			list: ( route ) =>
				json( route, writes.writes.length > 1 ? [] : [ poll ] ),
			success: { deleted: true },
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-audience-polls' );
		await exerciseConfirmation( page, {
			open: async () => {
				const trigger = page.getByRole( 'button', { name: 'Delete' } );
				await trigger.click();
				return trigger;
			},
			title: `Delete poll — ${ LONG }`,
			confirm: 'Delete poll',
			busy: 'Deleting…',
			writes,
		} );
		expect( writes.writes[ 1 ] ).toContain( 'polls/987101' );
	} );

	test( 'Events Experimental: event feed deletion', async ( { page } ) => {
		const feed = {
			id: 987102,
			name: LONG,
			slug: `e2e-shared-confirm-${ STAMP }`,
			enabled: true,
			data_sources: [],
			weekly_summary_url: null,
		};
		const writes = await interceptWrites( page, {
			match: 'fair-events/v1/sources',
			list: ( route ) =>
				json( route, writes.writes.length > 1 ? [] : [ feed ] ),
			success: { deleted: true },
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-events-sources' );
		await exerciseConfirmation( page, {
			open: async () => {
				const trigger = page.getByRole( 'button', {
					name: `More actions for “${ LONG }”`,
				} );
				await trigger.click();
				await page.getByRole( 'menuitem', { name: 'Delete' } ).click();
				return trigger;
			},
			title: `Delete event feed — ${ LONG }`,
			confirm: 'Delete event feed',
			busy: 'Deleting…',
			writes,
		} );
		expect( writes.writes[ 1 ] ).toContain( 'sources/987102' );
	} );

	test( 'Payments Connector Experimental: connected site removal', async ( {
		page,
	} ) => {
		const site = {
			id: 987103,
			label: LONG,
			base_url: 'https://e2e-shared-confirm.invalid',
			scopes: [ 'transactions:read' ],
			budget_id: null,
			status: 'active',
			enabled: true,
			last_sync_at: null,
		};
		const writes = await interceptWrites( page, {
			match: 'fair-payments-connector/v1/admin/connected-sites',
			list: ( route ) =>
				json( route, writes.writes.length > 1 ? [] : [ site ] ),
			success: { deleted: true },
		} );

		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		await exerciseConfirmation( page, {
			open: async () => {
				const trigger = page.getByRole( 'button', { name: 'Remove' } );
				await trigger.click();
				return trigger;
			},
			title: `Remove connected site — ${ LONG }`,
			confirm: 'Remove site',
			busy: 'Removing…',
			writes,
		} );
		expect( writes.writes[ 1 ] ).toContain( 'connected-sites/987103' );
	} );

	test( 'Finance: budget deletion', async ( { page } ) => {
		const budget = {
			id: 987104,
			name: LONG,
			description: '',
		};
		const writes = await interceptWrites( page, {
			match: 'fair-finance/v1/budgets',
			list: ( route, url ) => {
				if ( url.includes( 'budgets/stats' ) ) {
					return json( route, {} );
				}
				return json(
					route,
					writes.writes.length > 1 ? [] : [ budget ]
				);
			},
			success: { deleted: true },
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-finance-budgets' );
		await exerciseConfirmation( page, {
			open: async () => {
				const trigger = page.getByRole( 'button', {
					name: 'Delete',
					exact: true,
				} );
				await trigger.click();
				return trigger;
			},
			title: `Delete budget — ${ LONG }`,
			confirm: 'Delete budget',
			busy: 'Deleting…',
			writes,
		} );
		expect( writes.writes[ 1 ] ).toContain( 'budgets/987104' );
	} );

	test( 'Platform: connection log cleanup', async ( { page } ) => {
		const writes = await interceptWrites( page, {
			match: 'fair-platform/v1/connections/cleanup',
			success: { deleted: 3, message: 'Deleted 3 old log entries.' },
		} );

		await page.goto( '/wp-admin/admin.php?page=fair-platform-connections' );
		await exerciseConfirmation( page, {
			open: async () => {
				const trigger = page.getByRole( 'button', {
					name: 'Cleanup Old Logs',
				} );
				await trigger.click();
				return trigger;
			},
			title: 'Delete old connection logs',
			confirm: 'Delete old logs',
			busy: 'Deleting…',
			writes,
		} );
	} );

	test.describe( 'Finance: unsplit inside the split editor', () => {
		const API = '/wp-json/fair-finance/v1';
		const adminHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
					'base64'
				),
		};
		let api;
		let entryId;
		const budgetIds = [];

		const post = async ( path, data ) => {
			const res = await api.post( `${ API }${ path }`, {
				headers: adminHeaders,
				data,
			} );
			expect( res.ok(), await res.text() ).toBeTruthy();
			return res.json();
		};

		test.beforeAll( async ( { baseURL } ) => {
			api = await request.newContext( { baseURL } );
			for ( const name of [ 'A', 'B' ] ) {
				budgetIds.push(
					(
						await post( '/budgets', {
							name: `E2E shared confirm budget ${ name } ${ STAMP }`,
						} )
					).id
				);
			}
			entryId = (
				await post( '/financial-entries', {
					amount: 300,
					description: LONG,
					entry_type: 'cost',
					entry_date: '2032-03-01',
				} )
			).id;
			await post( `/financial-entries/${ entryId }/split`, {
				allocations: [
					{ budget_id: budgetIds[ 0 ], amount: 200 },
					{ budget_id: budgetIds[ 1 ], amount: 100 },
				],
			} );
		} );

		test.afterAll( async () => {
			const del = ( path ) =>
				api.delete( `${ API }${ path }`, { headers: adminHeaders } );
			if ( entryId ) {
				await del( `/financial-entries/${ entryId }/split` );
				await del( `/financial-entries/${ entryId }` );
			}
			for ( const id of budgetIds ) {
				await del( `/budgets/${ id }` );
			}
			await api.dispose();
		} );

		test( 'pending Escape reaches neither dialog; cancelling keeps the editor', async ( {
			page,
		} ) => {
			const writes = await interceptWrites( page, {
				match: `fair-finance/v1/financial-entries/${ entryId }/split`,
				success: { unsplit: true },
			} );

			await page.goto(
				`/wp-admin/admin.php?page=fair-finance-entries&entry_id=${ entryId }`
			);
			// While the confirmation is open the editor is aria-hidden, so
			// role queries can't see it: find it by its heading instead.
			const editor = page.locator( '.components-modal__frame', {
				has: page.locator( '.components-modal__header-heading', {
					hasText: /^Edit Split$/,
				} ),
			} );
			const confirmDialog = page.getByRole( 'dialog', {
				name: `Unsplit entry — ${ LONG }`,
			} );
			const openConfirm = async () => {
				const unsplit = editor.getByRole( 'button', {
					name: 'Unsplit',
					exact: true,
				} );
				await unsplit.click();
				await expect( confirmDialog ).toBeVisible();
				return unsplit;
			};

			await page
				.getByRole( 'button', { name: `Edit split “${ LONG }”` } )
				.click();
			await expect( editor ).toBeVisible();

			// Idle: Escape closes only the confirmation, focus returns to Unsplit.
			const unsplit = await openConfirm();
			await expectWrappedLayout( page, confirmDialog );
			await page.keyboard.press( 'Escape' );
			await expect( confirmDialog ).toBeHidden();
			await expect( editor ).toBeVisible();
			await expect( unsplit ).toBeFocused();

			// Pending: Escape reaches neither dialog.
			await openConfirm();
			await confirmDialog
				.getByRole( 'button', { name: 'Unsplit entry' } )
				.click();
			await expect(
				confirmDialog.getByRole( 'button', { name: 'Unsplitting…' } )
			).toBeFocused();
			await page.keyboard.press( 'Escape' );
			await expect( confirmDialog ).toBeVisible();
			await expect( editor ).toBeVisible();

			// Failure, then Cancel: the editor stays open.
			writes.release();
			await expect(
				confirmDialog.locator( '.components-notice__content' )
			).toHaveText( 'E2E: the server is busy.' );
			await confirmDialog
				.getByRole( 'button', { name: 'Cancel' } )
				.click();
			await expect( confirmDialog ).toBeHidden();
			await expect( editor ).toBeVisible();

			// Reopened clean, a retry closes both.
			await openConfirm();
			await expect(
				confirmDialog.locator( '.components-notice__content' )
			).toHaveCount( 0 );
			await confirmDialog
				.getByRole( 'button', { name: 'Unsplit entry' } )
				.click();
			await expect( confirmDialog ).toBeHidden();
			await expect( editor ).toBeHidden();
			expect( writes.writes ).toHaveLength( 2 );
		} );
	} );
} );
