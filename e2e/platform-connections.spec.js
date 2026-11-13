import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

/*
 * Fair Platform connection logs (#2231): the ordinary and Instagram screens
 * share one implementation and keep their own endpoints, wording, statuses,
 * statistics and columns. Every REST request is answered with synthetic data,
 * so no OAuth provider is contacted and no stored log changes.
 */

const json = ( route, body, status = 200 ) =>
	route.fulfill( {
		status,
		contentType: 'application/json',
		body: JSON.stringify( body ),
	} );

const PROVIDERS = [
	{
		name: 'ordinary',
		slug: 'fair-platform-connections',
		route: 'fair-platform/v1/connections',
		title: 'Connection Logs',
		history: 'Connection History',
		cleanupTitle: 'Delete old connection logs',
		uniqueLabel: 'Unique Sites',
		stats: { unique_sites: 7 },
		statusValues: [ '', 'connected', 'failed', 'disconnected' ],
		row: {
			mollie_organization_id: 'org_e2e',
			mollie_profile_id: 'pfl_e2e',
			profile_created: 1,
		},
		rowText: [ 'org_e2e', 'pfl_e2e', '✓ Profile created' ],
		providerHeaders: [ 'Organization', 'Profile' ],
	},
	{
		name: 'Instagram',
		slug: 'fair-platform-instagram-connections',
		route: 'fair-platform/v1/instagram-connections',
		title: 'Instagram Connection Logs',
		history: 'Instagram Connection History',
		cleanupTitle: 'Delete old Instagram connection logs',
		uniqueLabel: 'Unique Usernames',
		stats: { unique_usernames: 7 },
		statusValues: [ '', 'connected', 'failed' ],
		row: {
			instagram_username: 'e2e_handle',
			instagram_user_id: '1784100000',
		},
		rowText: [ '@e2e_handle', '1784100000' ],
		providerHeaders: [ 'IG Username', 'IG User ID' ],
	},
];

test.describe( 'Fair Platform connection logs (#2231)', () => {
	test.beforeEach( async ( { page } ) => {
		await loginAsAdmin( page );
		page.on( 'dialog', ( dialog ) => {
			throw new Error(
				`Native ${ dialog.type() } opened: ${ dialog.message() }`
			);
		} );
	} );

	for ( const provider of PROVIDERS ) {
		test( `${ provider.name } screen loads, filters, pages and confirms cleanup`, async ( {
			page,
		} ) => {
			const lists = [];
			const cleanups = [];

			// Match the provider's own routes only, whatever the permalinks.
			await page.route(
				( url ) => {
					const href = decodeURIComponent( url.href );
					return new RegExp(
						`${ provider.route }(/stats|/cleanup)?([?&]|$)`
					).test( href );
				},
				( route ) => {
					const url = new URL( route.request().url() );
					const href = decodeURIComponent( url.href );
					if ( href.includes( `${ provider.route }/stats` ) ) {
						return json( route, {
							total_connections: 12,
							successful: 9,
							failed: 3,
							...provider.stats,
						} );
					}
					if ( href.includes( `${ provider.route }/cleanup` ) ) {
						cleanups.push( url.searchParams.get( 'days' ) );
						return json( route, {
							message: `Deleted ${ provider.name } logs.`,
						} );
					}
					const params = url.searchParams;
					lists.push( {
						page: params.get( 'page' ),
						status: params.get( 'status' ),
					} );
					return json( route, {
						items: [
							{
								id: 900 + Number( params.get( 'page' ) ),
								site_name: `E2E ${ provider.name } site p${ params.get(
									'page'
								) }`,
								site_url: 'https://e2e.example.test',
								status: 'connected',
								connected_at: '2026-10-01T10:00:00Z',
								...provider.row,
							},
						],
						total_pages: 2,
					} );
				}
			);

			await page.goto( `/wp-admin/admin.php?page=${ provider.slug }` );

			await expect(
				page.getByRole( 'heading', {
					name: provider.title,
					exact: true,
				} )
			).toBeVisible();
			await expect(
				page.getByRole( 'heading', { name: provider.history } )
			).toBeVisible();
			await expect(
				page.getByText( provider.uniqueLabel ).locator( '..' )
			).toContainText( '7' );

			const table = page.locator( '.wp-list-table' );
			const headers = table.getByRole( 'columnheader' );
			await expect( headers ).toHaveText( [
				'ID',
				'Site',
				'Status',
				...provider.providerHeaders,
				'Connected At',
				'Last Refresh',
			] );
			const row = table.getByRole( 'row' ).nth( 1 );
			await expect( row ).toContainText(
				`E2E ${ provider.name } site p1`
			);
			for ( const text of provider.rowText ) {
				await expect( row ).toContainText( text );
			}

			const statusFilter = page.getByLabel( 'Status Filter' );
			await expect( statusFilter.locator( 'option' ) ).toHaveCount(
				provider.statusValues.length
			);
			expect(
				await statusFilter
					.locator( 'option' )
					.evaluateAll( ( options ) =>
						options.map( ( option ) => option.value )
					)
			).toEqual( provider.statusValues );

			// Filtering sends the status; paging sends the page.
			await statusFilter.selectOption( 'failed' );
			await expect
				.poll( () => lists.at( -1 ) )
				.toEqual( {
					page: '1',
					status: 'failed',
				} );
			await expect( page.getByText( 'Page 1 of 2' ) ).toBeVisible();
			await page.getByRole( 'button', { name: 'Next' } ).click();
			await expect( page.getByText( 'Page 2 of 2' ) ).toBeVisible();
			await expect( row ).toContainText(
				`E2E ${ provider.name } site p2`
			);
			expect( lists.at( -1 ) ).toEqual( {
				page: '2',
				status: 'failed',
			} );
			await expect(
				page.getByRole( 'button', { name: 'Next' } )
			).toBeDisabled();

			// Cancelling sends nothing and returns focus to the trigger.
			const trigger = page.getByRole( 'button', {
				name: 'Cleanup Old Logs',
			} );
			await trigger.click();
			const dialog = page.getByRole( 'dialog', {
				name: provider.cleanupTitle,
			} );
			await expect( dialog ).toContainText( 'older than 90 days' );
			await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
			await expect( dialog ).toBeHidden();
			await expect( trigger ).toBeFocused();
			expect( cleanups ).toHaveLength( 0 );

			// Confirming deletes through this provider and reloads its list.
			const listsBefore = lists.length;
			await trigger.click();
			await dialog
				.getByRole( 'button', { name: 'Delete old logs' } )
				.click();
			await expect( dialog ).toBeHidden();
			await expect(
				page.locator( '.components-notice__content', {
					hasText: `Deleted ${ provider.name } logs.`,
				} )
			).toBeVisible();
			expect( cleanups ).toEqual( [ '90' ] );
			await expect
				.poll( () => lists.length )
				.toBeGreaterThan( listsBefore );
		} );
	}
} );
