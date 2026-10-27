/**
 * E2E test for the weekly-summary opt-out preference on the public
 * manage-subscription page (#1157).
 *
 * Exercises the real save flow: navigates to the tokenized manage-subscription
 * URL as an anonymous visitor, unchecks the "Weekly summary of upcoming
 * events" checkbox, and submits the form — then verifies the stored
 * preference via the admin REST API while the email_profile stays
 * unaffected. Fixtures (participant, weekly email settings) are created via
 * the admin REST API using Application Password credentials
 * (WP_ADMIN_USER / WP_ADMIN_PASSWORD) and torn down at the end of the suite.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const NOTIFICATIONS_PATH = '/wp-json/fair-events/v1/event-notifications';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

function uniqueEmail( prefix ) {
	return `${ prefix }+${ Date.now() }-${ Math.floor(
		Math.random() * 1e6
	) }@example.test`;
}

test.describe( 'Manage-subscription page — weekly summary opt-out', () => {
	let api;
	let participantId;
	let subscriptionUrl;
	let originalDigestConfig;
	let sourceId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// The weekly email is configured in Fair Events (Event notifications).
		// Save its settings and turn it on so the preference is shown on the
		// manage page; turning it on needs an event source.
		const configRes = await api.get( NOTIFICATIONS_PATH, {
			headers: authHeaders,
		} );
		if ( configRes.ok() ) {
			originalDigestConfig = ( await configRes.json() ).channels
				.bulk_email;
		}
		const sourceSlug = `weekly-summary-${ Date.now() }`;
		const sourceRes = await api.post( '/wp-json/fair-events/v1/sources', {
			headers: authHeaders,
			data: {
				name: 'Weekly summary opt-out source',
				slug: sourceSlug,
				enabled: true,
				data_sources: [
					{
						source_type: 'categories',
						config: { category_ids: [ 1 ] },
					},
				],
			},
		} );
		expect( sourceRes.ok() ).toBeTruthy();
		sourceId = ( await sourceRes.json() ).id;
		const enableRes = await api.post(
			`${ NOTIFICATIONS_PATH }/bulk-email`,
			{
				headers: authHeaders,
				data: { enabled: true, source_slug: sourceSlug },
			}
		);
		expect( enableRes.ok() ).toBeTruthy();

		// A confirmed marketing subscriber so the checkbox renders checked and
		// enabled by default.
		const createRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Weekly Summary Opt-out Test',
					email: uniqueEmail( 'weekly-summary' ),
					email_profile: 'marketing',
				},
			}
		);
		expect( createRes.ok() ).toBeTruthy();
		participantId = ( await createRes.json() ).id;

		const urlRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }/subscription-url`,
			{ headers: authHeaders }
		);
		expect( urlRes.ok() ).toBeTruthy();
		subscriptionUrl = ( await urlRes.json() ).url;
	} );

	test.afterAll( async () => {
		if ( participantId ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: authHeaders }
			);
		}
		if ( originalDigestConfig ) {
			await api.post( `${ NOTIFICATIONS_PATH }/bulk-email`, {
				headers: authHeaders,
				data: {
					enabled: originalDigestConfig.enabled,
					source_slug: originalDigestConfig.source_slug,
				},
			} );
		}
		if ( sourceId ) {
			await api.delete( `/wp-json/fair-events/v1/sources/${ sourceId }`, {
				headers: authHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'unchecking and saving persists the opt-out without touching email_profile', async ( {
		page,
	} ) => {
		await page.goto( subscriptionUrl );

		const summaryCheckbox = page.locator( '#fair-audience-weekly-summary' );
		await expect( summaryCheckbox ).toBeVisible();
		await expect( summaryCheckbox ).toBeChecked();
		await expect( summaryCheckbox ).toBeEnabled();

		await summaryCheckbox.uncheck();
		await page.click( '.fair-audience-subscription-submit' );

		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();

		const afterUncheck = page.locator( '#fair-audience-weekly-summary' );
		await expect( afterUncheck ).not.toBeChecked();

		const getRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }`,
			{ headers: authHeaders }
		);
		expect( getRes.ok() ).toBeTruthy();
		const participant = await getRes.json();
		expect( participant.email_profile ).toBe( 'marketing' );
		expect( participant.weekly_summary_opt_out ).toBe( true );

		// Re-checking and saving re-subscribes them to the summary.
		await page.goto( subscriptionUrl );
		const recheckCheckbox = page.locator( '#fair-audience-weekly-summary' );
		await recheckCheckbox.check();
		await page.click( '.fair-audience-subscription-submit' );
		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();

		const getResAfter = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }`,
			{ headers: authHeaders }
		);
		const participantAfter = await getResAfter.json();
		expect( participantAfter.weekly_summary_opt_out ).toBe( false );
	} );

	test( 'choosing event feeds is saved and kept on later saves', async ( {
		page,
	} ) => {
		const participantState = async () =>
			(
				await api.get(
					`/wp-json/fair-audience/v1/participants/${ participantId }`,
					{ headers: authHeaders }
				)
			).json();

		await page.goto( subscriptionUrl );

		const allEmails = page.getByRole( 'radio', {
			name: /All weekly emails/,
		} );
		const chosenFeeds = page.getByRole( 'radio', {
			name: 'Only the event feeds I choose',
		} );
		const feed = page.getByRole( 'checkbox', {
			name: 'Weekly summary opt-out source',
		} );

		// An existing subscriber keeps every weekly email until choosing.
		await expect( allEmails ).toBeChecked();
		await expect( feed ).toBeDisabled();

		await chosenFeeds.check();
		await expect( feed ).toBeEnabled();
		await feed.check();
		await page.click( '.fair-audience-subscription-submit' );
		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();

		let stored = await participantState();
		expect( stored.weekly_feed_mode ).toBe( 'selected' );
		expect( stored.weekly_feed_ids ).toEqual( [ Number( sourceId ) ] );

		// The page shows the stored choice again.
		await page.goto( subscriptionUrl );
		await expect( chosenFeeds ).toBeChecked();
		await expect( feed ).toBeChecked();

		// Turning the weekly summary off keeps the feed choice.
		await page.locator( '#fair-audience-weekly-summary' ).uncheck();
		await expect( chosenFeeds ).toBeDisabled();
		await page.click( '.fair-audience-subscription-submit' );
		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();

		stored = await participantState();
		expect( stored.weekly_summary_opt_out ).toBe( true );
		expect( stored.weekly_feed_mode ).toBe( 'selected' );
		expect( stored.weekly_feed_ids ).toEqual( [ Number( sourceId ) ] );

		// Choosing no feeds is kept as no feeds.
		await page.goto( subscriptionUrl );
		await page.locator( '#fair-audience-weekly-summary' ).check();
		await feed.uncheck();
		await page.click( '.fair-audience-subscription-submit' );
		await expect(
			page.locator( '.fair-audience-subscription-message.success' )
		).toBeVisible();

		stored = await participantState();
		expect( stored.weekly_summary_opt_out ).toBe( false );
		expect( stored.weekly_feed_mode ).toBe( 'selected' );
		expect( stored.weekly_feed_ids ).toEqual( [] );
	} );

	test( 'preference is hidden for a minimal-profile subscriber', async ( {
		page,
	} ) => {
		const minimalRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Minimal Profile Test',
					email: uniqueEmail( 'minimal-profile' ),
					email_profile: 'minimal',
				},
			}
		);
		expect( minimalRes.ok() ).toBeTruthy();
		const minimalId = ( await minimalRes.json() ).id;

		const urlRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${ minimalId }/subscription-url`,
			{ headers: authHeaders }
		);
		const minimalUrl = ( await urlRes.json() ).url;

		await page.goto( minimalUrl );
		await expect(
			page.locator( '#fair-audience-weekly-summary-wrap' )
		).toBeHidden();

		await api.delete(
			`/wp-json/fair-audience/v1/participants/${ minimalId }`,
			{ headers: authHeaders }
		);
	} );
} );
