/**
 * Playwright API tests for the TimelineController ticket-sales branch (#1412).
 *
 * Exercises GET /fair-audience/v1/timeline against a live WordPress instance:
 *
 * - In test mode, the ticket-sales day lists test and live purchases with the
 *   flag each was recorded with; only live purchases count toward revenue.
 * - In live mode, test purchases drop out and live purchases stay.
 * - Switching back to test mode brings the historical test purchases back.
 *
 * The effective mode is switched through fair-e2e/v1/payment-mode
 * (e2e/mu-plugins/fair-e2e-support.php), since the test site forces
 * fair_payment_mode and a settings write alone does not change it. Purchases
 * are seeded directly through fair-e2e/v1/transaction-filters/seed
 * (e2e/mu-plugins/fair-e2e-transaction-filters.php), so no payment provider
 * is contacted.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const TIMELINE = '/wp-json/fair-audience/v1/timeline';
const SEED = '/wp-json/fair-e2e/v1/transaction-filters/seed';
const TRANSACTIONS = '/wp-json/fair-payments-connector/v1/transactions';

const KEY = `tl${ Date.now().toString( 36 ) }`;

// A day far in the future keeps the fixture day at the top of the timeline,
// apart from any other data on the site. The month and day vary per run so a
// leftover from an interrupted run never shares the fixture day.
const DAY = `2099-${ String( 1 + Math.floor( Math.random() * 12 ) ).padStart(
	2,
	'0'
) }-${ String( 1 + Math.floor( Math.random() * 28 ) ).padStart( 2, '0' ) }`;

const LIVE_AMOUNT = 42.5;
const TEST_AMOUNT = 17.25;

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'TimelineController – ticket sales across payment modes', () => {
	let api;
	let originalMode;
	let liveId;
	let testId;

	async function getEffectiveMode() {
		const res = await api.get( '/wp-json/wp/v2/settings', {
			headers: authHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).fair_payment_mode;
	}

	async function setMode( mode ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/payment-mode', {
			headers: authHeaders,
			data: { mode },
		} );
		expect( res.ok() ).toBeTruthy();
		expect( ( await res.json() ).mode ).toBe( mode );
		expect( await getEffectiveMode() ).toBe( mode );
	}

	async function getFixtureDay() {
		const res = await api.get( TIMELINE, {
			headers: authHeaders,
			params: { per_page: 20, page: 1 },
		} );
		expect( res.status() ).toBe( 200 );
		const items = await res.json();
		return items.find( ( item ) => item.id === `ticket_sales_${ DAY }` );
	}

	function flagsById( day ) {
		return Object.fromEntries(
			day.details.tickets.map( ( ticket ) => [
				ticket.transaction_id,
				ticket.testmode,
			] )
		);
	}

	async function expectStoredFlags() {
		const res = await api.get( TRANSACTIONS, {
			headers: authHeaders,
			params: { search: KEY, per_page: 100 },
		} );
		expect( res.status() ).toBe( 200 );
		const stored = Object.fromEntries(
			( await res.json() ).transactions.map( ( t ) => [
				t.id,
				t.testmode,
			] )
		);
		expect( stored ).toEqual( { [ liveId ]: false, [ testId ]: true } );
	}

	async function expectBothPurchases() {
		const day = await getFixtureDay();
		expect( day ).toBeTruthy();
		expect( flagsById( day ) ).toEqual( {
			[ liveId ]: false,
			[ testId ]: true,
		} );
		expect( day.details.count ).toBe( 2 );
		expect( day.details.total_amount ).toBe( LIVE_AMOUNT );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		originalMode = await getEffectiveMode();
	} );

	test.afterAll( async () => {
		// Each cleanup step runs even when the other one fails.
		const results = await Promise.allSettled( [
			api.post( '/wp-json/fair-e2e/v1/payment-mode', {
				headers: authHeaders,
				data: { mode: originalMode === 'live' ? 'live' : 'test' },
			} ),
			api.delete( SEED, {
				headers: authHeaders,
				params: { key: KEY },
			} ),
		] );
		await api.dispose();
		for ( const result of results ) {
			expect( result.status ).toBe( 'fulfilled' );
			expect( result.value.ok() ).toBeTruthy();
		}
	} );

	test( 'is limited to administrators', async () => {
		expect( ( await api.get( TIMELINE ) ).status() ).toBe( 401 );
	} );

	test( 'shows test purchases only in test mode and keeps their flags', async () => {
		const seed = await api.post( SEED, {
			headers: authHeaders,
			data: {
				key: KEY,
				transactions: [
					{
						amount: LIVE_AMOUNT,
						status: 'paid',
						testmode: false,
						description: `${ KEY } live ticket`,
						created_at: `${ DAY } 10:00:00`,
					},
					{
						amount: TEST_AMOUNT,
						status: 'paid',
						testmode: true,
						description: `${ KEY } test ticket`,
						created_at: `${ DAY } 11:00:00`,
					},
				],
			},
		} );
		expect( seed.ok(), await seed.text() ).toBeTruthy();
		[ liveId, testId ] = ( await seed.json() ).transaction_ids;
		expect( liveId ).toBeGreaterThan( 0 );
		expect( testId ).toBeGreaterThan( 0 );

		await setMode( 'test' );
		await expectBothPurchases();

		await setMode( 'live' );
		const liveDay = await getFixtureDay();
		expect( liveDay ).toBeTruthy();
		expect( flagsById( liveDay ) ).toEqual( { [ liveId ]: false } );
		expect( liveDay.details.count ).toBe( 1 );
		expect( liveDay.details.total_amount ).toBe( LIVE_AMOUNT );
		await expectStoredFlags();

		await setMode( 'test' );
		await expectBothPurchases();
		await expectStoredFlags();
	} );
} );
