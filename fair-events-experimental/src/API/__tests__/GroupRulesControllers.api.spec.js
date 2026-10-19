/**
 * Playwright API tests for GroupPricingRulesController and
 * GroupPermissionRulesController (#1716): the two services the Groups tab on
 * Manage Event reads.
 *
 * Covers reading existing rules, the mutations the tab performs, the
 * `edit_posts` permission check, and that the routes exist only while the
 * ticketing extensions are available (#1849): core Fair Events ticketing and
 * Experimental's own `ticketing` setting both on, and Fair Audience active.
 * Rules written while the routes were available must still be there once
 * they are available again.
 *
 * Groups come from Fair Audience Experimental, so the suite skips when that
 * plugin is inactive. Both settings are toggled through their registered
 * settings and restored to the values the suite found; plugins switched off
 * are switched back on.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const FEATURES_OPTION = 'fair_events_experimental_features';
const CORE_FEATURES_OPTION = 'fair_events_features';
// Dependents first: fair-audience-experimental requires fair-audience.
const AUDIENCE_PLUGINS = [
	'fair-audience-experimental/fair-audience-experimental',
	'fair-audience/fair-audience',
];
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
	let coreTicketingWasEnabled = true;
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

	const setCoreTicketing = async ( enabled ) => {
		const res = await api.post( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
			data: { [ CORE_FEATURES_OPTION ]: { ticketing: enabled } },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	const setPluginStatus = async ( plugin, status ) => {
		const res = await api.put( `/wp-json/wp/v2/plugins/${ plugin }`, {
			headers: adminHeaders,
			data: { status },
		} );
		expect( res.ok(), plugin ).toBeTruthy();
	};

	const expectRoutes = async ( registered, label ) => {
		for ( const path of [ pricingPath(), permissionPath() ] ) {
			const res = await api.get( path, { headers: adminHeaders } );
			if ( registered ) {
				expect( res.status(), `${ label }: ${ path }` ).toBe( 200 );
			} else {
				expect( res.status(), `${ label }: ${ path }` ).toBe( 404 );
				expect(
					( await res.json() ).code,
					`${ label }: ${ path }`
				).toBe( 'rest_no_route' );
			}
		}
	};

	const ruleIds = async ( path ) => {
		const res = await api.get( path, { headers: adminHeaders } );
		expect( res.status() ).toBe( 200 );
		return ( await res.json() ).map( ( rule ) => rule.id );
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

		// A stored `false` is the only way either setting is off: both
		// default on.
		const settingsRes = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		expect( settingsRes.ok() ).toBeTruthy();
		const settings = await settingsRes.json();
		ticketingWasEnabled = settings[ FEATURES_OPTION ]?.ticketing !== false;
		coreTicketingWasEnabled =
			settings[ CORE_FEATURES_OPTION ]?.ticketing !== false;
		await setTicketing( true );
		await setCoreTicketing( true );

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
			for ( const plugin of [ ...AUDIENCE_PLUGINS ].reverse() ) {
				await setPluginStatus( plugin, 'active' );
			}
			await setTicketing( true );
			await setCoreTicketing( true );

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
			await setCoreTicketing( coreTicketingWasEnabled );
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

	test( 'routes exist only while both ticketing settings are on, and rules survive the toggles', async () => {
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

		try {
			for ( const [ core, experimental ] of [
				[ false, false ],
				[ false, true ],
				[ true, false ],
				[ true, true ],
			] ) {
				await setCoreTicketing( core );
				await setTicketing( experimental );
				await expectRoutes(
					core && experimental,
					`core ${ core }, experimental ${ experimental }`
				);
			}
		} finally {
			await setCoreTicketing( true );
			await setTicketing( true );
		}

		expect( await ruleIds( pricingPath() ) ).toEqual( [ pricingRule.id ] );
		expect( await ruleIds( permissionPath() ) ).toEqual( [
			permissionRule.id,
		] );
	} );

	test( 'routes are unregistered without Fair Audience, and rules survive', async () => {
		const permissionRes = await api.post( permissionPath(), {
			headers: adminHeaders,
			data: { group_id: groupId, permission_type: 'view_signups' },
		} );
		expect( permissionRes.status() ).toBe( 201 );
		const before = await ruleIds( permissionPath() );

		try {
			for ( const plugin of AUDIENCE_PLUGINS ) {
				await setPluginStatus( plugin, 'inactive' );
			}
			await expectRoutes( false, 'without Fair Audience' );
		} finally {
			for ( const plugin of [ ...AUDIENCE_PLUGINS ].reverse() ) {
				await setPluginStatus( plugin, 'active' );
			}
		}

		expect( await ruleIds( permissionPath() ) ).toEqual( before );
	} );
} );
