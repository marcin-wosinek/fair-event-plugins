/**
 * Playwright API tests for GroupPricingRulesController and
 * GroupPermissionRulesController (#1716): the two services the Groups tab on
 * Manage Event reads.
 *
 * Covers reading existing rules, the mutations the tab performs, the
 * `edit_posts` permission check, and that the routes exist only while the
 * experimental `ticketing` bundle is on — the state in which the tab is
 * offered. Rules written while the bundle was on must still be there once it
 * is turned back on.
 *
 * Groups come from Fair Audience Experimental, so the suite skips when that
 * plugin is inactive. The bundle is toggled through the plugin's registered
 * setting and restored to the value the suite found.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const FEATURES_OPTION = 'fair_events_experimental_features';
const SUBSCRIBER_PASSWORD = 'Test-password-1716!';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

test.describe( 'Group pricing and permission rule controllers', () => {
	// The ticketing toggle is site-wide state, so the cases must not overlap.
	test.describe.configure( { mode: 'serial' } );

	let api;
	let groupsActive = false;
	let ticketingWasEnabled = true;
	let eventId;
	let eventDateId;
	let groupId;
	let subscriberId;
	let subscriberHeaders;

	const pricingPath = () =>
		`/wp-json/fair-events/v1/event-dates/${ eventDateId }/group-pricing-rules`;
	const permissionPath = () =>
		`/wp-json/fair-events/v1/event-dates/${ eventDateId }/group-permission-rules`;

	const setTicketing = async ( enabled ) => {
		const res = await api.post( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
			data: { [ FEATURES_OPTION ]: { ticketing: enabled } },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const pluginsRes = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		expect( pluginsRes.ok() ).toBeTruthy();
		groupsActive = ( await pluginsRes.json() ).some(
			( plugin ) =>
				plugin.plugin?.includes( 'fair-audience-experimental' ) &&
				plugin.status === 'active'
		);
		if ( ! groupsActive ) {
			return;
		}

		// A stored `false` is the only way the bundle is off: it defaults on.
		const settingsRes = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		expect( settingsRes.ok() ).toBeTruthy();
		ticketingWasEnabled =
			( await settingsRes.json() )[ FEATURES_OPTION ]?.ticketing !==
			false;
		await setTicketing( true );

		const eventRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Group rules ${ Date.now() }`, status: 'publish' },
		} );
		expect( eventRes.ok() ).toBeTruthy();
		eventId = ( await eventRes.json() ).id;

		const eventsRes = await api.get( '/wp-json/fair-audience/v1/events', {
			headers: adminHeaders,
			params: { per_page: 100 },
		} );
		expect( eventsRes.ok() ).toBeTruthy();
		const match = ( await eventsRes.json() ).find(
			( event ) => event.event_id === eventId
		);
		expect( match, 'event-date row for test event' ).toBeTruthy();
		eventDateId = match.event_date_id;

		const groupRes = await api.post( '/wp-json/fair-audience/v1/groups', {
			headers: adminHeaders,
			data: { name: `Group rules ${ Date.now() }` },
		} );
		expect( groupRes.ok(), await groupRes.text() ).toBeTruthy();
		groupId = ( await groupRes.json() ).id;

		const userLogin = `group-rules-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: SUBSCRIBER_PASSWORD,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriberId = ( await userRes.json() ).id;
		subscriberHeaders = basicAuth( userLogin, SUBSCRIBER_PASSWORD );
	} );

	test.afterAll( async () => {
		if ( groupsActive ) {
			// Routes must be registered for the rule cleanup below.
			await setTicketing( true );

			for ( const path of [ pricingPath(), permissionPath() ] ) {
				const res = await api.get( path, { headers: adminHeaders } );
				const rules = res.ok() ? await res.json() : [];
				for ( const rule of rules ) {
					await api.delete( `${ path }/${ rule.id }`, {
						headers: adminHeaders,
					} );
				}
			}
			if ( groupId ) {
				await api.delete(
					`/wp-json/fair-audience/v1/groups/${ groupId }`,
					{ headers: adminHeaders }
				);
			}
			if ( eventId ) {
				await api.delete( `/wp-json/wp/v2/fair_event/${ eventId }`, {
					headers: adminHeaders,
					params: { force: 'true' },
				} );
			}
			if ( subscriberId ) {
				await api.delete( `/wp-json/wp/v2/users/${ subscriberId }`, {
					headers: adminHeaders,
					params: { force: 'true', reassign: 1 },
				} );
			}

			await setTicketing( ticketingWasEnabled );
		}
		await api.dispose();
	} );

	test.beforeEach( () => {
		test.skip(
			! groupsActive,
			'Fair Audience Experimental (groups) is not active.'
		);
	} );

	test( 'an event with no rules returns empty lists, not an error', async () => {
		for ( const path of [ pricingPath(), permissionPath() ] ) {
			const res = await api.get( path, { headers: adminHeaders } );
			expect( res.status(), path ).toBe( 200 );
			expect( await res.json(), path ).toEqual( [] );
		}
	} );

	test( 'creates, lists, updates and deletes a pricing rule', async () => {
		const createRes = await api.post( pricingPath(), {
			headers: adminHeaders,
			data: {
				group_id: groupId,
				discount_type: 'percentage',
				discount_value: 20,
			},
		} );
		expect( createRes.status(), await createRes.text() ).toBe( 201 );
		const created = await createRes.json();
		expect( created.group_id ).toBe( groupId );
		expect( created.group_name ).toContain( 'Group rules' );

		const listRes = await api.get( pricingPath(), {
			headers: adminHeaders,
		} );
		expect( listRes.status() ).toBe( 200 );
		const listed = await listRes.json();
		expect( listed ).toHaveLength( 1 );
		expect( listed[ 0 ].id ).toBe( created.id );
		expect( Number( listed[ 0 ].discount_value ) ).toBe( 20 );

		const updateRes = await api.put( `${ pricingPath() }/${ created.id }`, {
			headers: adminHeaders,
			data: { discount_type: 'amount', discount_value: 5 },
		} );
		expect( updateRes.status(), await updateRes.text() ).toBe( 200 );
		const updated = await updateRes.json();
		expect( updated.discount_type ).toBe( 'amount' );
		expect( Number( updated.discount_value ) ).toBe( 5 );

		const deleteRes = await api.delete(
			`${ pricingPath() }/${ created.id }`,
			{
				headers: adminHeaders,
			}
		);
		expect( deleteRes.status() ).toBe( 204 );

		const afterRes = await api.get( pricingPath(), {
			headers: adminHeaders,
		} );
		expect( await afterRes.json() ).toEqual( [] );
	} );

	test( 'creates, lists and deletes a permission rule', async () => {
		const createRes = await api.post( permissionPath(), {
			headers: adminHeaders,
			data: { group_id: groupId, permission_type: 'view_signups' },
		} );
		expect( createRes.status(), await createRes.text() ).toBe( 201 );
		const created = await createRes.json();
		expect( created.permission_type ).toBe( 'view_signups' );

		const listRes = await api.get( permissionPath(), {
			headers: adminHeaders,
		} );
		expect( listRes.status() ).toBe( 200 );
		expect( ( await listRes.json() ).map( ( rule ) => rule.id ) ).toEqual( [
			created.id,
		] );

		const deleteRes = await api.delete(
			`${ permissionPath() }/${ created.id }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.status() ).toBe( 204 );
	} );

	test( 'an unknown event date is a 404, not an empty list', async () => {
		for ( const base of [
			'group-pricing-rules',
			'group-permission-rules',
		] ) {
			const res = await api.get(
				`/wp-json/fair-events/v1/event-dates/999999999/${ base }`,
				{ headers: adminHeaders }
			);
			expect( res.status(), base ).toBe( 404 );
			expect( ( await res.json() ).code, base ).toBe(
				'rest_event_date_not_found'
			);
		}
	} );

	test( 'rejects anonymous requests', async () => {
		for ( const path of [ pricingPath(), permissionPath() ] ) {
			const readRes = await api.get( path );
			expect( readRes.status(), `GET ${ path }` ).toBe( 401 );

			const writeRes = await api.post( path, {
				data: {
					group_id: groupId,
					discount_type: 'percentage',
					discount_value: 100,
					permission_type: 'manage_signups',
				},
			} );
			expect( writeRes.status(), `POST ${ path }` ).toBe( 401 );
		}
	} );

	test( 'rejects a user without edit_posts and writes nothing', async () => {
		for ( const path of [ pricingPath(), permissionPath() ] ) {
			const readRes = await api.get( path, {
				headers: subscriberHeaders,
			} );
			expect( readRes.status(), `GET ${ path }` ).toBe( 403 );

			const writeRes = await api.post( path, {
				headers: subscriberHeaders,
				data: {
					group_id: groupId,
					discount_type: 'percentage',
					discount_value: 100,
					permission_type: 'manage_signups',
				},
			} );
			expect( writeRes.status(), `POST ${ path }` ).toBe( 403 );

			const afterRes = await api.get( path, { headers: adminHeaders } );
			expect( await afterRes.json(), path ).toEqual( [] );
		}
	} );

	test( 'routes exist only while experimental ticketing is on, and rules survive the toggle', async () => {
		const pricingRes = await api.post( pricingPath(), {
			headers: adminHeaders,
			data: {
				group_id: groupId,
				discount_type: 'percentage',
				discount_value: 15,
			},
		} );
		expect( pricingRes.status(), await pricingRes.text() ).toBe( 201 );
		const pricingRule = await pricingRes.json();

		const permissionRes = await api.post( permissionPath(), {
			headers: adminHeaders,
			data: { group_id: groupId, permission_type: 'invited' },
		} );
		expect( permissionRes.status() ).toBe( 201 );
		const permissionRule = await permissionRes.json();

		await setTicketing( false );
		try {
			for ( const path of [ pricingPath(), permissionPath() ] ) {
				const res = await api.get( path, { headers: adminHeaders } );
				expect( res.status(), path ).toBe( 404 );
				expect( ( await res.json() ).code, path ).toBe(
					'rest_no_route'
				);
			}
		} finally {
			await setTicketing( true );
		}

		const pricingAfter = await api.get( pricingPath(), {
			headers: adminHeaders,
		} );
		expect( pricingAfter.status() ).toBe( 200 );
		expect(
			( await pricingAfter.json() ).map( ( rule ) => rule.id )
		).toEqual( [ pricingRule.id ] );

		const permissionAfter = await api.get( permissionPath(), {
			headers: adminHeaders,
		} );
		expect( permissionAfter.status() ).toBe( 200 );
		expect(
			( await permissionAfter.json() ).map( ( rule ) => rule.id )
		).toEqual( [ permissionRule.id ] );
	} );
} );
