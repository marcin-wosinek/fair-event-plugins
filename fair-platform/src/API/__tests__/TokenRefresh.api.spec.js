/**
 * Client token refreshes in the Mollie connection logs (#2380).
 *
 * Profile completion binds the connected row to a keyed fingerprint of the
 * refresh token handed to the site; a successful /oauth/refresh then moves
 * that row's Last Refresh, and follows a rotated token, without touching
 * any other row.
 *
 * Mollie's token endpoint is answered per request by
 * e2e/mu-plugins/fair-e2e-platform-token-refresh.php; credentials come from
 * e2e/mu-plugins/fair-e2e-platform-health.php. Rows come from
 * e2e/mu-plugins/scripts/platform-connections.php, which empties both
 * connection tables before seeding.
 */
import { test, expect, request } from '@playwright/test';

import { BASE_URL, admin, fixture } from './platform-connections-fixture.js';

const fingerprint = async ( token ) =>
	( await fixture( 'fingerprint', { token } ) ).fingerprint;

const byId = ( rows, id ) =>
	rows.find( ( row ) => Number( row.id ) === Number( id ) );

const without = ( rows, id ) =>
	rows.filter( ( row ) => Number( row.id ) !== Number( id ) );

// Earlier attempts for the same site, another site's bound row and an
// Instagram row: none of them may move when site-a refreshes.
const NEIGHBOURS = {
	ordinary: [
		{
			site_id: 'site-a',
			site_name: 'Alpha (earlier)',
			mollie_organization_id: 'org_old',
			status: 'connected',
			daysAgo: 30,
		},
		{
			site_id: 'site-a',
			site_name: 'Alpha (failed)',
			status: 'failed',
			error_code: 'access_denied',
			daysAgo: 20,
		},
		{
			site_id: 'site-b',
			site_name: 'Bravo',
			mollie_organization_id: 'org_b',
			status: 'connected',
			refreshToken: 'refresh_e2e_bravo',
			refreshedDaysAgo: 2,
			daysAgo: 15,
		},
	],
	instagram: [
		{
			site_id: 'site-a',
			site_name: 'Alpha',
			instagram_user_id: 'ig_1',
			instagram_username: 'alpha_ig',
			status: 'connected',
			daysAgo: 1,
		},
	],
};

test.describe.serial( 'Fair Platform token refresh logging', () => {
	let api;

	const refresh = ( token, scenario ) =>
		api.post( '/oauth/refresh', {
			headers: {
				'X-Fair-E2E-Platform-Credentials': 'set',
				'X-Fair-E2E-Platform-Mollie-Refresh': scenario,
			},
			form: { refresh_token: token },
			maxRedirects: 0,
		} );

	const expectRefreshed = async ( response, rotated ) => {
		expect( response.status(), await response.text() ).toBe( 200 );
		const body = await response.json();
		expect( body.success ).toBe( true );
		expect( body.data.data.access_token ).toMatch(
			/^access_e2e_platform_/
		);
		expect( body.data.data.expires_in ).toBe( 3600 );
		expect( body.data.data.refresh_token ).toBe( rotated );
	};

	// Seed the neighbours plus one bound site-a row; returns its ID.
	const seedBound = async ( row ) => {
		const ids = await fixture( 'seed', {
			ordinary: [
				...NEIGHBOURS.ordinary,
				{
					site_id: 'site-a',
					site_name: 'Alpha',
					mollie_organization_id: 'org_a',
					mollie_profile_id: 'pfl_a',
					status: 'connected',
					daysAgo: 10,
					...row,
				},
			],
			instagram: NEIGHBOURS.instagram,
		} );
		return ids.ordinary[ ids.ordinary.length - 1 ];
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await fixture( 'clear' );
		await api.dispose();
	} );

	test( 'profile completion binds the new row and its refresh is recorded there only', async () => {
		await fixture( 'seed', NEIGHBOURS );
		const session = await fixture( 'profile-session', {
			siteId: 'site-a',
			siteName: 'Alpha',
			siteUrl: 'https://alpha.example.test',
			refreshToken: 'refresh_e2e_alpha',
		} );

		const completed = await api.post( '/oauth/select-profile', {
			form: {
				session_token: session.session_token,
				profile_id: 'pfl_e2e',
				nonce: session.nonce,
			},
			maxRedirects: 0,
		} );
		expect( completed.status(), await completed.text() ).toBe( 302 );
		const location = new URL( completed.headers().location );
		expect( location.searchParams.get( 'mollie_refresh_token' ) ).toBe(
			'refresh_e2e_alpha'
		);

		const before = await fixture( 'rows' );
		const row = before.ordinary[ before.ordinary.length - 1 ];
		expect( row ).toMatchObject( {
			site_id: 'site-a',
			status: 'connected',
			mollie_profile_id: 'pfl_e2e',
			last_token_refresh: null,
			refresh_token_fingerprint: await fingerprint( 'refresh_e2e_alpha' ),
		} );
		// No raw credential is stored.
		expect( JSON.stringify( before ) ).not.toContain( 'refresh_e2e_' );

		await expectRefreshed(
			await refresh( 'refresh_e2e_alpha', 'keep' ),
			undefined
		);

		const after = await fixture( 'rows' );
		const refreshed = byId( after.ordinary, row.id );
		expect( refreshed.last_token_refresh ).not.toBeNull();
		expect( refreshed ).toEqual( {
			...row,
			last_token_refresh: refreshed.last_token_refresh,
		} );
		expect( without( after.ordinary, row.id ) ).toEqual(
			without( before.ordinary, row.id )
		);
		expect( after.instagram ).toEqual( before.instagram );

		// The Connection Logs API shows the time, never the binding.
		const listing = await (
			await api.get(
				'/wp-json/fair-platform/v1/connections?orderby=id&order=DESC',
				{ headers: admin }
			)
		).json();
		expect( listing.items[ 0 ].id ).toBe( String( row.id ) );
		expect( listing.items[ 0 ].last_token_refresh ).toBe(
			refreshed.last_token_refresh
		);
		for ( const item of listing.items ) {
			expect( item ).not.toHaveProperty( 'refresh_token_fingerprint' );
		}
		expect( JSON.stringify( listing ) ).not.toContain(
			refreshed.refresh_token_fingerprint
		);
	} );

	test( 'a later refresh advances the time and follows a rotated token', async () => {
		const id = await seedBound( {
			refreshToken: 'refresh_e2e_old',
			refreshedDaysAgo: 3,
		} );
		const before = await fixture( 'rows' );
		const row = byId( before.ordinary, id );

		await expectRefreshed(
			await refresh( 'refresh_e2e_old', 'rotate:refresh_e2e_new' ),
			'refresh_e2e_new'
		);

		const after = await fixture( 'rows' );
		const rotated = byId( after.ordinary, id );
		expect( rotated.last_token_refresh > row.last_token_refresh ).toBe(
			true
		);
		expect( rotated.connected_at ).toBe( row.connected_at );
		expect( rotated.refresh_token_fingerprint ).toBe(
			await fingerprint( 'refresh_e2e_new' )
		);
		expect( without( after.ordinary, id ) ).toEqual(
			without( before.ordinary, id )
		);

		// The superseded token no longer names this row; Mollie's answer
		// still reaches the site.
		await expectRefreshed(
			await refresh( 'refresh_e2e_old', 'keep' ),
			undefined
		);
		expect( await fixture( 'rows' ) ).toEqual( after );

		// The rotated token keeps refreshing this row.
		await expectRefreshed(
			await refresh( 'refresh_e2e_new', 'keep' ),
			undefined
		);
		const again = byId( ( await fixture( 'rows' ) ).ordinary, id );
		expect( again.last_token_refresh >= rotated.last_token_refresh ).toBe(
			true
		);
		expect( again.refresh_token_fingerprint ).toBe(
			rotated.refresh_token_fingerprint
		);
		expect( again.connected_at ).toBe( row.connected_at );
	} );

	test( 'failed or invalid refreshes leave the last success unchanged', async () => {
		await seedBound( {
			refreshToken: 'refresh_e2e_alpha',
			refreshedDaysAgo: 3,
		} );
		const before = await fixture( 'rows' );

		const cases = [
			[ 'rejected', 'refresh_e2e_alpha', 400 ],
			[ 'transport', 'refresh_e2e_alpha', 500 ],
			[ 'invalid', 'refresh_e2e_alpha', 500 ],
			// A missing token is refused before Mollie is asked.
			[ 'keep', '', 400 ],
		];
		for ( const [ scenario, token, status ] of cases ) {
			const response = await refresh( token, scenario );
			expect( response.status(), scenario ).toBe( status );
			expect( ( await response.json() ).success ).toBe( false );
		}

		expect( await fixture( 'rows' ) ).toEqual( before );
	} );

	test( 'stale, ambiguous and inactive bindings are not attributed', async () => {
		// A newer time recorded by a concurrent refresh is never moved back.
		await seedBound( {
			refreshToken: 'refresh_e2e_alpha',
			refreshedDaysAgo: -1,
		} );
		let before = await fixture( 'rows' );
		await expectRefreshed(
			await refresh( 'refresh_e2e_alpha', 'keep' ),
			undefined
		);
		expect( await fixture( 'rows' ) ).toEqual( before );

		// Two connected rows claiming one token: neither is chosen.
		await fixture( 'seed', {
			ordinary: [
				{
					site_id: 'site-a',
					status: 'connected',
					refreshToken: 'refresh_e2e_shared',
				},
				{
					site_id: 'site-b',
					status: 'connected',
					refreshToken: 'refresh_e2e_shared',
				},
			],
		} );
		before = await fixture( 'rows' );
		await expectRefreshed(
			await refresh( 'refresh_e2e_shared', 'keep' ),
			undefined
		);
		expect( await fixture( 'rows' ) ).toEqual( before );

		// A disconnected row is not refreshed.
		await seedBound( {
			refreshToken: 'refresh_e2e_alpha',
			status: 'disconnected',
		} );
		before = await fixture( 'rows' );
		await expectRefreshed(
			await refresh( 'refresh_e2e_alpha', 'keep' ),
			undefined
		);
		expect( await fixture( 'rows' ) ).toEqual( before );
	} );

	test( 'unbound legacy connections keep refreshing without invented dates', async () => {
		await seedBound( {} );
		const before = await fixture( 'rows' );
		for ( const row of before.ordinary ) {
			if ( row.site_id !== 'site-b' ) {
				expect( row.refresh_token_fingerprint ).toBeNull();
				expect( row.last_token_refresh ).toBeNull();
			}
		}

		await expectRefreshed(
			await refresh( 'refresh_e2e_legacy', 'rotate:refresh_e2e_next' ),
			'refresh_e2e_next'
		);
		expect( await fixture( 'rows' ) ).toEqual( before );
	} );
} );
