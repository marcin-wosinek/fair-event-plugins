/**
 * Playwright API tests for the event-level finance budget link (#1608):
 * GET/PUT /fair-events/v1/event-dates/{id}/budget.
 *
 * fair-finance is mounted and active in this instance (.wp-env.json), so the
 * "finance plugin inactive" fallback (both routes 503, EventBudget::get_budget_id()
 * returning null) is exercised structurally via class_exists() guards rather
 * than by deactivating the plugin — no spec in this repo toggles plugin
 * activation mid-run, since the wp-env instance is shared across suites.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'EventDatesController — budget link', () => {
	let api;
	const postIds = [];
	const eventDateIds = [];
	const budgetIds = [];
	let subscriberId;
	let subscriberHeaders;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const userLogin = `event-budget-${ Date.now() }`;
		const userResponse = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: userLogin,
				email: `${ userLogin }@example.com`,
				password: 'Test-password-1460!',
				roles: [ 'subscriber' ],
			},
		} );
		expect( userResponse.ok() ).toBeTruthy();
		subscriberId = ( await userResponse.json() ).id;
		subscriberHeaders = {
			Authorization:
				'Basic ' +
				Buffer.from( `${ userLogin }:Test-password-1460!` ).toString(
					'base64'
				),
		};
	} );

	test.afterAll( async () => {
		for ( const budgetId of budgetIds ) {
			await api.delete(
				`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const eventDateId of eventDateIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const postId of postIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	/**
	 * Create a fair_event post plus its linked, unscheduled event date (via
	 * ensure-for-post), the shape EventBudget resolves through.
	 */
	const createLinkedEventDate = async () => {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Budget link ${ Date.now() }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const ensureRes = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect( ensureRes.ok() ).toBeTruthy();
		const eventDateId = ( await ensureRes.json() ).id;
		eventDateIds.push( eventDateId );

		return eventDateId;
	};

	const createBudget = async () => {
		const res = await api.post( '/wp-json/fair-finance/v1/budgets', {
			headers: adminHeaders,
			data: { name: `Budget link test ${ Date.now() }` },
		} );
		expect( res.ok() ).toBeTruthy();
		const budgetId = ( await res.json() ).id;
		budgetIds.push( budgetId );
		return budgetId;
	};

	test( 'a fresh event date reports no budget', async () => {
		const eventDateId = await createLinkedEventDate();

		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		expect( ( await res.json() ).budget_id ).toBeNull();
	} );

	test( 'setting and clearing the budget round-trips through GET', async () => {
		const eventDateId = await createLinkedEventDate();
		const budgetId = await createBudget();

		const setRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders, data: { budget_id: budgetId } }
		);
		expect( setRes.ok(), await setRes.text() ).toBeTruthy();
		expect( ( await setRes.json() ).budget_id ).toBe( budgetId );

		const getRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders }
		);
		expect( ( await getRes.json() ).budget_id ).toBe( budgetId );

		const clearRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders, data: { budget_id: null } }
		);
		expect( clearRes.ok(), await clearRes.text() ).toBeTruthy();
		expect( ( await clearRes.json() ).budget_id ).toBeNull();
	} );

	test( 'rejects an unknown budget ID with 404', async () => {
		const eventDateId = await createLinkedEventDate();

		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders, data: { budget_id: 999999999 } }
		);
		expect( res.status() ).toBe( 404 );
	} );

	test( '404s for an unknown event date', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/999999999/budget',
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 404 );
	} );

	test( 'falls back to no budget once the linked budget is deleted', async () => {
		const eventDateId = await createLinkedEventDate();
		const budgetId = await createBudget();

		const setRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders, data: { budget_id: budgetId } }
		);
		expect( setRes.ok() ).toBeTruthy();

		const deleteRes = await api.delete(
			`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
			{ headers: adminHeaders }
		);
		expect( deleteRes.ok() ).toBeTruthy();
		budgetIds.splice( budgetIds.indexOf( budgetId ), 1 );

		const getRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: adminHeaders }
		);
		expect( ( await getRes.json() ).budget_id ).toBeNull();
	} );

	test( 'requires authentication', async () => {
		const eventDateId = await createLinkedEventDate();

		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`
		);
		expect( res.status() ).toBe( 401 );
	} );

	test( 'requires edit_posts to update the budget', async () => {
		const eventDateId = await createLinkedEventDate();

		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/budget`,
			{ headers: subscriberHeaders, data: { budget_id: null } }
		);
		expect( res.status() ).toBe( 403 );
	} );
} );
