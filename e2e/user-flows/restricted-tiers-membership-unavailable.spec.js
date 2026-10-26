/**
 * E2E: group-restricted tiers while group membership can't be verified (#1298).
 *
 * Restrictions are stored by Fair Events; checking a visitor against them
 * needs Fair Audience and Fair Audience Experimental. Without either one a
 * restricted tier fails closed: the public signup form leaves it out and an
 * administrator sees a warning across wp-admin that explains why. Fair Events
 * Experimental plays no part, so each unavailable case runs with it both
 * active and inactive. The last case checks the warning goes away and the
 * restriction is still saved once both plugins are back.
 *
 * Direct purchase requests are covered by the API specs
 * (GetTicketsGroupRestrictionUnavailable, EventSignupGroupPricing). The
 * restricted tier names a group that doesn't exist, so no visitor is ever a
 * member of it.
 */

import { request } from '@playwright/test';
import { test, expect } from '../support/fixtures.js';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	loginAsAdmin,
	runScript,
	wpCli,
} from '../support/wp-cli.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
const MISSING_GROUP_ID = 987654321;
const NOTICE_TEXT =
	'Some ticket types are limited to members of specific groups';

const UNAVAILABLE = [
	{ label: 'Fair Audience inactive', deactivate: [ 'fair-audience' ] },
	{ label: 'Fair Audience Experimental inactive', deactivate: [] },
];

/** `wp plugin is-active` answers through its exit code. */
function isActive( slug ) {
	try {
		wpCli( `plugin is-active ${ slug }` );
		return true;
	} catch {
		return false;
	}
}

/** Put both audience plugins back; Experimental requires Fair Audience. */
function activateCompanions() {
	wpCli( 'plugin activate fair-audience', { allowFailure: true } );
	wpCli( 'plugin activate fair-audience-experimental', {
		allowFailure: true,
	} );
}

test.describe( 'Restricted tiers without membership support', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let event;
	let eventsExperimentalActive;

	/** Save the event's tiers: one restricted to a group, one open to all. */
	async function saveTiers( restrictedGroupIds ) {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/tickets`,
			{
				data: {
					ticket_types: [
						{
							name: 'Members Only',
							capacity: null,
							recurrence_scope: 'single_instance',
							group_ids: restrictedGroupIds,
						},
						{
							name: 'Everyone',
							capacity: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 0,
						},
						{
							ticket_type_index: 1,
							sale_period_index: 0,
							price: 0,
						},
					],
					settings: {},
				},
			}
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		return ( await res.json() ).ticket_types;
	}

	async function expectRestrictedTierHidden( page ) {
		await page.goto( event.pageUrl );
		const form = page.locator( 'form' ).filter( { hasText: 'Everyone' } );
		await expect( form ).toBeVisible();
		await expect( page.getByText( 'Members Only' ) ).toHaveCount( 0 );
	}

	function restorePlugins() {
		activateCompanions();
		wpCli(
			`plugin ${ eventsExperimentalActive ? 'activate' : 'deactivate' } fair-events-experimental`,
			{ allowFailure: true }
		);
	}

	test.beforeAll( async () => {
		eventsExperimentalActive = isActive( 'fair-events-experimental' );
		activateCompanions();

		api = await request.newContext( {
			baseURL: BASE_URL,
			extraHTTPHeaders: {
				Authorization:
					'Basic ' +
					Buffer.from(
						`${ ADMIN_USER }:${ ADMIN_PASSWORD }`
					).toString( 'base64' ),
			},
		} );
		event = runScript( 'seed-event.php', 'E2E_SEED', 'free' );
		await saveTiers( [ MISSING_GROUP_ID ] );
	} );

	test.afterEach( () => {
		restorePlugins();
	} );

	test.afterAll( async () => {
		restorePlugins();
		if ( event ) {
			// Clearing the restriction first leaves no saved row behind.
			await saveTiers( [] );
			runScript(
				'cleanup-event.php',
				'E2E_CLEANUP',
				`${ event.eventId } ${ event.eventDateId } ${ event.venueId || 0 }`
			);
		}
		await api?.dispose();
	} );

	test( 'with membership support, a visitor sees only open tiers and admins see no warning', async ( {
		page,
	} ) => {
		await expectRestrictedTierHidden( page );
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );
		await expect( page.getByText( NOTICE_TEXT ) ).toHaveCount( 0 );
	} );

	for ( const companions of UNAVAILABLE ) {
		for ( const eventsExperimental of [ 'active', 'inactive' ] ) {
			test( `${ companions.label }, Fair Events Experimental ${ eventsExperimental }: restricted tier hidden and admins warned`, async ( {
				page,
			} ) => {
				wpCli(
					`plugin ${ eventsExperimental === 'active' ? 'activate' : 'deactivate' } fair-events-experimental`
				);
				wpCli( 'plugin deactivate fair-audience-experimental' );
				for ( const slug of companions.deactivate ) {
					wpCli( `plugin deactivate ${ slug }` );
				}

				await expectRestrictedTierHidden( page );

				await loginAsAdmin( page );
				await page.goto( '/wp-admin/' );
				const notice = page
					.locator( '.notice-warning' )
					.filter( { hasText: NOTICE_TEXT } );
				await expect( notice ).toBeVisible();
				await expect( notice ).toContainText(
					'activate both plugins to sell them to group members again'
				);
			} );
		}
	}

	test( 'restrictions survive the toggling and the warning goes once support is back', async ( {
		page,
	} ) => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ event.eventDateId }/tickets`
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		const restricted = ( ( await res.json() ).ticket_types || [] ).find(
			( type ) => type.name === 'Members Only'
		);
		expect( restricted?.group_ids ).toEqual( [ MISSING_GROUP_ID ] );

		await expectRestrictedTierHidden( page );
		await loginAsAdmin( page );
		await page.goto( '/wp-admin/' );
		await expect( page.getByText( NOTICE_TEXT ) ).toHaveCount( 0 );
	} );
} );
