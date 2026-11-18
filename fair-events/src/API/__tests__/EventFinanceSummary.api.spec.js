/**
 * GET /fair-events/v1/event-dates/{id}/finance-summary (#2398): an event
 * date's sales, costs and net result over every payment, never one page of
 * a list. A shared payment counts only this date's share and its
 * proportional fee; open, failed and test-mode attempts count nothing; Fair
 * Finance transfers and payout income aren't sales or costs; expenses are
 * split by how they were paid. Payout states follow saved settlements, and
 * a confirmed bank receipt moves the money without changing the result.
 *
 * Records are written by e2e/mu-plugins/scripts/event-finance-summary.php
 * and removed afterwards.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const root = new URL( '../../../../', import.meta.url );

async function fixture( action, data ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/event-finance-summary.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	const match = stdout.match( /E2E_EVENT_FINANCE:(\{.*\})/ );
	if ( ! match ) {
		throw new Error(
			`Expected E2E_EVENT_FINANCE output, got:\n${ stdout }`
		);
	}
	return JSON.parse( match[ 1 ] );
}

const authHeader = () => ( {
	Authorization: `Basic ${ Buffer.from(
		`${ ADMIN_USER }:${ ADMIN_PASSWORD }`
	).toString( 'base64' ) }`,
} );

test.describe.serial( 'Event finance summary', () => {
	test.describe.configure( { timeout: 180 * 1000 } );

	const key = `k${ Date.now() }`;
	let api;
	let anonymous;
	const dateIds = [];
	let eventDateId;
	let otherDateId;

	const summaryPath = ( id ) =>
		`/wp-json/fair-events/v1/event-dates/${ id }/finance-summary`;

	async function summary( id = eventDateId ) {
		const response = await api.get( summaryPath( id ) );
		expect( response.status() ).toBe( 200 );
		return response.json();
	}

	test.beforeAll( async () => {
		api = await request.newContext( {
			baseURL: BASE_URL,
			extraHTTPHeaders: authHeader(),
		} );
		anonymous = await request.newContext( { baseURL: BASE_URL } );

		for ( const title of [ 'Finance summary', 'Finance summary other' ] ) {
			const response = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					data: {
						title: `${ title } ${ key }`,
						link_type: 'none',
						start_date: '2036-07-04',
						end_date: '2036-07-04',
					},
				}
			);
			expect( response.ok() ).toBeTruthy();
			dateIds.push( ( await response.json() ).id );
		}
		[ eventDateId, otherDateId ] = dateIds;

		await fixture( 'seed', { key, eventDateId, otherDateId } );
	} );

	test.afterAll( async () => {
		await fixture( 'cleanup', { key } ).catch( () => {} );
		for ( const id of dateIds ) {
			await api
				.delete( `/wp-json/fair-events/v1/event-dates/${ id }` )
				.catch( () => {} );
		}
		await api?.dispose();
		await anonymous?.dispose();
	} );

	test( 'requires an administrator and an existing date', async () => {
		const unauthenticated = await anonymous.get(
			summaryPath( eventDateId )
		);
		expect( unauthenticated.status() ).toBe( 401 );

		const missing = await api.get( summaryPath( 999999999 ) );
		expect( missing.status() ).toBe( 404 );
		expect( ( await missing.json() ).code ).toBe( 'event_date_not_found' );
	} );

	test( 'counts every successful payment once, with this date’s share of shared fees', async () => {
		const data = await summary();

		expect( data.state ).toBe( 'complete' );
		expect( data.issues ).toEqual( [] );
		// 105 × €10 attributed by Connector + €50 of the shared €100.
		expect( data.sales.online.payment_count ).toBe( 106 );
		expect( data.sales.online.gross ).toBe( 1100 );
		// 105 × €0.25 + €0.51 of €1.01; €0.04 of the €0.07 application fee.
		expect( data.sales.online.mollie_fees ).toBe( 26.76 );
		expect( data.sales.online.application_fees ).toBe( 0.04 );
		expect( data.sales.online.net ).toBe( 1073.2 );
		// Cash income only: payout income and the transfer aren't sales.
		expect( data.sales.cash ).toBe( 35 );
		expect( data.sales.total ).toBe( 1135 );
	} );

	test( 'splits expenses by how they were paid and adds the fees', async () => {
		const data = await summary();

		expect( data.costs.expenses ).toEqual( {
			total: 80,
			event_cash: 0,
			personal: 15,
			// €40 imported + €20 allocation inheriting its parent's import.
			bank: 60,
			unclassified: 5,
			personal_by_payer: [ { payer_name: 'Sayli', amount: 15 } ],
		} );
		expect( data.costs.payment_fees ).toBe( 26.8 );
		expect( data.costs.total ).toBe( 106.8 );
		expect( data.net_result ).toBe( 1028.2 );
	} );

	test( 'the other date counts only its own shares of the shared payment', async () => {
		const data = await summary( otherDateId );

		expect( data.sales.online.gross ).toBe( 50 );
		expect( data.sales.online.payment_count ).toBe( 1 );
		// €1.01 − €0.51, €0.07 − €0.04: the shares add up to the fee.
		expect( data.sales.online.mollie_fees ).toBe( 0.5 );
		expect( data.sales.online.application_fees ).toBe( 0.03 );
		expect( data.costs.expenses.bank ).toBe( 4 );
	} );

	test( 'follows saved settlements per payment, and a bank receipt leaves the result unchanged', async () => {
		const before = await summary();
		expect( before.payout ).toEqual( {
			awaiting_payout: 9.75,
			paid_out: 49.45,
			received_in_bank: 0,
			unknown: 1014,
			unpriced_count: 0,
		} );

		await fixture( 'confirm', { key } );
		const after = await summary();

		expect( after.payout.received_in_bank ).toBe( 49.45 );
		expect( after.payout.paid_out ).toBe( 0 );
		expect( after.payout.awaiting_payout ).toBe( 9.75 );
		expect( after.sales ).toEqual( before.sales );
		expect( after.costs ).toEqual( before.costs );
		expect( after.net_result ).toBe( before.net_result );
	} );
} );
