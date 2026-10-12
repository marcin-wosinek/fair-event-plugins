/**
 * Saved Mollie settlements (#1694): persistence from the API and from a CSV
 * export, convergence of both sources, pagination, failure recovery,
 * permissions and validation.
 *
 * Mollie is served by e2e/mu-plugins/lib/mollie-http-double.php, which lists
 * three settlements over two pages (see settlement_response() there). The
 * helper routes in e2e/mu-plugins/fair-e2e-settlements.php reset the saved
 * data and steer the double, so no request leaves the host.
 */
import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASS =
	process.env.WP_ADMIN_PASSWORD || process.env.WP_ADMIN_PASS || 'password';

const SETTLEMENTS = '/wp-json/fair-payments-connector/v1/settlements';
const ACCOUNTS = `${ SETTLEMENTS }/accounts`;
const IMPORTS = `${ SETTLEMENTS }/imports`;
const CSV_VALIDATE = `${ SETTLEMENTS }/csv/validate`;
const CSV_IMPORT = `${ SETTLEMENTS }/csv/import`;
const HELPERS = '/wp-json/fair-e2e/v1/settlements';

const basic = ( user, pass ) => ( {
	Authorization:
		'Basic ' + Buffer.from( `${ user }:${ pass }` ).toString( 'base64' ),
} );
const admin = basic( ADMIN_USER, ADMIN_PASS );

const CSV_HEADER =
	'Date,Payment method,Currency,Amount,Status,ID,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded';

/**
 * Build a Mollie settlement CSV export.
 *
 * @param {string} reference Settlement reference.
 * @param {Array}  rows      Rows as { id, amount, settled, currency, status, description }.
 * @return {string} File contents.
 */
const buildCsv = ( reference, rows ) =>
	[
		CSV_HEADER,
		...rows.map( ( row ) =>
			[
				'2026-05-01 10:00:00',
				'ideal',
				row.currency ?? 'EUR',
				row.amount ?? '',
				row.status ?? ( row.id ? 'paid' : '' ),
				row.id ?? '',
				row.description ?? '',
				row.id ? 'Jane Example' : '',
				row.id ? 'NL00BANK0123456789' : '',
				'',
				'EUR',
				row.settled ?? row.amount ?? '',
				reference,
				'',
			].join( ',' )
		),
	].join( '\n' ) + '\n';

// The same payout the double reports as stl_e2e0001.
const MATCHING_ROWS = [
	{ id: 'tr_e2estl01a', amount: '25.00', description: 'Ticket A' },
	{ id: 'tr_e2estl01b', amount: '15.00', description: 'Ticket B' },
	{ amount: '-1.45', description: 'Transaction fees ideal' },
];
const MATCHING_CSV = buildCsv( 'E2E.2605.01', MATCHING_ROWS );

test.describe( 'Saved settlements', () => {
	let api;
	const users = [];
	const seeded = [];

	const createUser = async ( role ) => {
		const suffix = `${ Date.now() }${ Math.floor( Math.random() * 1000 ) }`;
		const password = `pw-${ suffix }-Aa1!`;
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: admin,
			data: {
				username: `e2e_${ role }_${ suffix }`,
				email: `e2e_${ role }_${ suffix }@example.test`,
				password,
				roles: [ role ],
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const user = await res.json();
		users.push( user.id );
		return basic( user.username, password );
	};

	const setState = async ( data ) => {
		const res = await api.post( `${ HELPERS }/state`, {
			headers: admin,
			data,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	const mollieRequests = async () => {
		const res = await api.get( `${ HELPERS }/state`, { headers: admin } );
		return ( await res.json() ).requests;
	};

	const setConnected = async ( connected ) => {
		const res = await api.post( '/wp-json/fair-e2e/v1/mollie-connection', {
			headers: admin,
			data: { connected },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	const upload = ( url, contents, fields = {}, headers = admin ) =>
		api.post( url, {
			headers,
			multipart: {
				file: {
					name: 'settlement.csv',
					mimeType: 'text/csv',
					buffer: Buffer.isBuffer( contents )
						? contents
						: Buffer.from( contents, 'utf8' ),
				},
				...fields,
			},
		} );

	const importCsv = async ( contents, fields ) => {
		const res = await upload( CSV_IMPORT, contents, fields );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const startImport = ( data, headers = admin ) =>
		api.post( IMPORTS, { headers, data } );

	const step = async ( runId ) => {
		const res = await api.post( `${ IMPORTS }/${ runId }/step`, {
			headers: admin,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return ( await res.json() ).run;
	};

	// Step a run until it stops running, as the admin page does.
	const drive = async ( run ) => {
		let current = run;
		for ( let i = 0; i < 60 && current.status === 'running'; i++ ) {
			current = await step( current.id );
		}
		return current;
	};

	const runImport = async ( data = { kind: 'history' } ) => {
		const res = await startImport( data );
		expect( res.status(), await res.text() ).toBe( 201 );
		return drive( ( await res.json() ).run );
	};

	const list = async ( query = '' ) => {
		const res = await api.get( `${ SETTLEMENTS }${ query }`, {
			headers: admin,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const detail = async ( id ) => {
		const res = await api.get( `${ SETTLEMENTS }/${ id }`, {
			headers: admin,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	const byProviderId = async ( providerId ) => {
		const { items } = await list( '?per_page=100' );
		const found = items.find( ( item ) => item.provider_id === providerId );
		expect( found, `${ providerId } is saved` ).toBeTruthy();
		return detail( found.id );
	};

	const accounts = async () => {
		const res = await api.get( ACCOUNTS, { headers: admin } );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.beforeEach( async () => {
		const res = await api.post( `${ HELPERS }/reset`, { headers: admin } );
		expect( res.ok(), await res.text() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		await api.post( `${ HELPERS }/reset`, {
			headers: admin,
			data: { restore: true },
		} );
		for ( const id of seeded ) {
			await api.delete(
				`/wp-json/fair-e2e/v1/test-transactions?id=${ id }`,
				{ headers: admin }
			);
		}
		for ( const id of users ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: admin }
			);
		}
		await api.dispose();
	} );

	test( 'requires an administrator for every route', async () => {
		const subscriber = await createUser( 'subscriber' );
		const calls = [
			( headers ) => api.get( SETTLEMENTS, { headers } ),
			( headers ) => api.get( `${ SETTLEMENTS }/1`, { headers } ),
			( headers ) => api.get( ACCOUNTS, { headers } ),
			( headers ) =>
				api.post( `${ ACCOUNTS }/1/confirm`, {
					headers,
					data: { organization_id: 'org_e2e0001' },
				} ),
			( headers ) => upload( CSV_VALIDATE, MATCHING_CSV, {}, headers ),
			( headers ) =>
				upload(
					CSV_IMPORT,
					MATCHING_CSV,
					{ account_label: 'Blocked' },
					headers
				),
			( headers ) => api.get( IMPORTS, { headers } ),
			( headers ) => startImport( { kind: 'history' }, headers ),
			( headers ) => api.post( `${ IMPORTS }/1/step`, { headers } ),
		];

		for ( const call of calls ) {
			expect( ( await call( {} ) ).status() ).toBe( 401 );
			expect( ( await call( subscriber ) ).status() ).toBe( 403 );
		}

		expect( ( await list() ).total ).toBe( 0 );
		expect( await mollieRequests() ).toBe( 0 );
	} );

	test( 'validates request input', async () => {
		expect( ( await startImport( { kind: 'everything' } ) ).status() ).toBe(
			400
		);
		expect( ( await startImport( { kind: 'refresh' } ) ).status() ).toBe(
			400
		);
		expect(
			(
				await startImport( { kind: 'refresh', settlement_id: 999999 } )
			).status()
		).toBe( 404 );
		expect(
			(
				await api.get( `${ SETTLEMENTS }/999999`, { headers: admin } )
			).status()
		).toBe( 404 );
		expect(
			(
				await api.get( `${ SETTLEMENTS }?per_page=500`, {
					headers: admin,
				} )
			).status()
		).toBe( 400 );
		expect(
			(
				await api.post( `${ IMPORTS }/999999/step`, { headers: admin } )
			).status()
		).toBe( 404 );
		expect(
			(
				await upload( CSV_IMPORT, MATCHING_CSV, {
					account_id: '999999',
				} )
			).status()
		).toBe( 404 );

		const missingFile = await api.post( CSV_IMPORT, {
			headers: admin,
			data: { account_label: 'No file' },
		} );
		expect( missingFile.status() ).toBe( 400 );
		expect( ( await missingFile.json() ).code ).toBe(
			'settlement_csv_missing'
		);
	} );

	test( 'refuses invalid CSV files with actionable errors and saves nothing', async () => {
		const files = {
			csv_amount_invalid: buildCsv( 'E2E.BAD.01', [
				{ id: 'tr_e2ebad0001', amount: '"1,234"' },
			] ),
			csv_headers_unsupported: 'name,email\nJane,jane@example.test\n',
			csv_encoding: Buffer.concat( [
				Buffer.from(
					`${ CSV_HEADER }\n,ideal,EUR,1.00,paid,tr_e2ebad0002,Caf`
				),
				Buffer.from( [ 0xe9 ] ),
				Buffer.from( ',,,,EUR,1.00,E2E.BAD.01,\n' ),
			] ),
			csv_multiple_settlements:
				buildCsv( 'E2E.BAD.01', [
					{ id: 'tr_e2ebad0003', amount: '1.00' },
				] ) +
				buildCsv( 'E2E.BAD.02', [
					{ id: 'tr_e2ebad0004', amount: '1.00' },
				] )
					.split( '\n' )
					.slice( 1 )
					.join( '\n' ),
			csv_currency_invalid: buildCsv( 'E2E.BAD.01', [
				{ id: 'tr_e2ebad0005', amount: '1.00', currency: 'EURO' },
			] ),
		};

		for ( const [ code, contents ] of Object.entries( files ) ) {
			for ( const url of [ CSV_VALIDATE, CSV_IMPORT ] ) {
				const res = await upload( url, contents, {
					account_label: 'Invalid files',
				} );
				const body = await res.json();
				expect( res.status(), code ).toBe( 400 );
				expect( body.code ).toBe( 'settlement_csv_invalid' );
				expect( body.data.errors[ 0 ].code ).toBe( code );
				expect( body.data.errors[ 0 ].message ).not.toBe( '' );
			}
		}

		// The row at fault is named.
		const bad = await upload( CSV_VALIDATE, files.csv_amount_invalid );
		expect( ( await bad.json() ).data.errors[ 0 ].row ).toBe( 2 );

		expect( ( await list() ).total ).toBe( 0 );
		expect( ( await accounts() ).accounts ).toHaveLength( 0 );
	} );

	test( 'imports a CSV without a Mollie connection and reopens it without contacting Mollie', async () => {
		await setConnected( false );

		const preview = await upload( CSV_VALIDATE, MATCHING_CSV, {
			account_label: 'Paper trail',
		} );
		expect( preview.status() ).toBe( 200 );
		const previewed = await preview.json();
		expect( previewed.outcome ).toBe( 'new' );
		expect( previewed.imported ).toBe( false );
		expect( previewed.reference ).toBe( 'E2E.2605.01' );
		expect( previewed.movement_count ).toBe( 3 );
		expect( previewed.totals.detail.settlement_amount ).toBe( '40.00' );
		// A preview saves nothing.
		expect( ( await list() ).total ).toBe( 0 );

		// The account the settlement belongs to must be stated.
		const noAccount = await upload( CSV_IMPORT, MATCHING_CSV );
		expect( noAccount.status() ).toBe( 400 );
		expect( ( await noAccount.json() ).code ).toBe(
			'settlement_account_required'
		);

		const res = await upload( CSV_IMPORT, MATCHING_CSV, {
			account_label: 'Paper trail',
		} );
		expect( res.status(), await res.text() ).toBe( 201 );
		const imported = await res.json();
		expect( imported.imported ).toBe( true );

		const saved = await detail( imported.settlement_id );
		expect( saved.reference ).toBe( 'E2E.2605.01' );
		expect( saved.sources ).toEqual( [ 'csv' ] );
		expect( saved.account.label ).toBe( 'Paper trail' );
		expect( saved.account.verified ).toBe( false );
		// The export does not state the payout or its provider status.
		expect( saved.amount ).toBeNull();
		expect( saved.provider_id ).toBeNull();
		expect( saved.status ).toBeNull();
		expect( saved.completeness ).toBe( 'unverified' );
		expect( saved.can_refresh ).toBe( false );
		expect( saved.movements.map( ( m ) => m.external_id ) ).toEqual( [
			'tr_e2estl01a',
			'tr_e2estl01b',
		] );
		expect( saved.aggregates ).toHaveLength( 1 );
		expect( saved.aggregates[ 0 ].type ).toBe( 'fee' );
		expect( saved.aggregates[ 0 ].settlement_amount ).toBe( '-1.45' );
		// Payments that are not local transactions yet are kept as references.
		expect( saved.unresolved_payment_count ).toBe( 2 );
		expect( saved.movements[ 0 ].local_transaction_id ).toBeNull();
		// Consumer details from the export are not retained.
		expect( JSON.stringify( saved ) ).not.toContain( 'Jane Example' );
		expect( JSON.stringify( saved ) ).not.toContain( 'NL00BANK' );

		expect( ( await list() ).items[ 0 ].id ).toBe( saved.id );
		expect( await mollieRequests() ).toBe( 0 );

		// Loading from Mollie is refused, with what to do about it.
		const blocked = await startImport( { kind: 'history' } );
		expect( blocked.status() ).toBe( 409 );
		expect( ( await blocked.json() ).code ).toBe( 'mollie_not_connected' );
		expect( ( await accounts() ).connection.can_import ).toBe( false );
	} );

	test( 'does not duplicate a repeated CSV upload', async () => {
		const first = await importCsv( MATCHING_CSV, {
			account_label: 'Repeats',
		} );
		const before = await detail( first.settlement_id );

		const preview = await upload( CSV_VALIDATE, MATCHING_CSV, {
			account_label: 'Repeats',
		} );
		expect( ( await preview.json() ).outcome ).toBe( 'duplicate' );

		const again = await importCsv( MATCHING_CSV, {
			account_label: 'Repeats',
		} );
		expect( again.outcome ).toBe( 'duplicate' );
		expect( again.imported ).toBe( false );
		expect( again.settlement_id ).toBe( first.settlement_id );

		// The same rows in another order are still the same content.
		const reordered = await importCsv(
			buildCsv( 'E2E.2605.01', [ ...MATCHING_ROWS ].reverse() ),
			{ account_label: 'Repeats' }
		);
		expect( reordered.outcome ).toBe( 'duplicate' );

		const after = await detail( first.settlement_id );
		expect( ( await list() ).total ).toBe( 1 );
		expect( ( await accounts() ).accounts ).toHaveLength( 1 );
		expect( after.revisions.csv.id ).toBe( before.revisions.csv.id );
		expect( after.movements ).toHaveLength( 2 );
		expect( after.revisions.csv.totals ).toEqual(
			before.revisions.csv.totals
		);
		expect( after.discrepancies ).toEqual( [] );
	} );

	test( 'keeps legitimately repeated rows of one file', async () => {
		const imported = await importCsv(
			buildCsv( 'E2E.REPEAT.01', [
				{ amount: '-0.29', description: 'Transaction fees ideal' },
				{ amount: '-0.29', description: 'Transaction fees ideal' },
				{ id: 'tr_e2erepeat01', amount: '10.00' },
			] ),
			{ account_label: 'Repeats' }
		);
		const saved = await detail( imported.settlement_id );

		expect( saved.aggregates ).toHaveLength( 2 );
		expect( saved.revisions.csv.totals.aggregate.settlement_amount ).toBe(
			'-0.58'
		);
	} );

	test( 'keeps the accepted file and exposes the differences of a conflicting one', async () => {
		const first = await importCsv( MATCHING_CSV, {
			account_label: 'Conflicts',
		} );
		const conflicting = buildCsv( 'E2E.2605.01', [
			{ id: 'tr_e2estl01a', amount: '25.00' },
			{ id: 'tr_e2estl01b', amount: '15.00', settled: '14.00' },
			{ id: 'tr_e2estl01c', amount: '3.00' },
		] );

		const preview = await upload( CSV_VALIDATE, conflicting, {
			account_label: 'Conflicts',
		} );
		expect( ( await preview.json() ).outcome ).toBe( 'conflict' );

		const second = await importCsv( conflicting, {
			account_label: 'Conflicts',
		} );
		expect( second.outcome ).toBe( 'conflict' );
		expect( second.imported ).toBe( false );
		// Uploading the conflicting file again adds nothing more.
		await importCsv( conflicting, { account_label: 'Conflicts' } );

		const saved = await detail( first.settlement_id );
		expect( ( await list() ).total ).toBe( 1 );
		// The accepted data is unchanged.
		expect(
			saved.movements.find( ( m ) => m.external_id === 'tr_e2estl01b' )
				.settlement_amount
		).toBe( '15.00' );
		expect( saved.movements ).toHaveLength( 2 );
		expect( saved.revisions.csv.totals.detail.settlement_amount ).toBe(
			'40.00'
		);
		// The proposed differences are there to review.
		expect( saved.proposed_changes ).toHaveLength( 1 );
		const [ proposed ] = saved.proposed_changes;
		expect( proposed.counts ).toEqual( {
			added: 1,
			removed: 1,
			changed: 1,
		} );
		expect( proposed.added[ 0 ].external_id ).toBe( 'tr_e2estl01c' );
		expect( proposed.changed[ 0 ].external_id ).toBe( 'tr_e2estl01b' );
		expect( proposed.changed[ 0 ].fields.settlement_amount ).toEqual( {
			accepted: '15.00',
			proposed: '14.00',
		} );
		expect( saved.discrepancies.map( ( d ) => d.code ) ).toContain(
			'csv_content_conflict'
		);
		expect( ( await list() ).items[ 0 ].discrepancy_count ).toBe( 1 );
	} );

	test( 'loads every page from Mollie and keeps all movement categories', async () => {
		const run = await runImport();
		expect( run.status ).toBe( 'completed' );
		expect( run.progress.settlements_done ).toBe( 3 );
		expect( run.error_code ).toBeNull();
		// One Mollie request per step: 2 list pages, 3 settlements, 13 content pages.
		expect( await mollieRequests() ).toBe( 18 );
		expect( run.progress.requests_done ).toBe( 18 );

		const saved = await list();
		expect( saved.total ).toBe( 3 );
		// Most recent first; the open settlement has no payout date yet.
		expect( saved.items.map( ( item ) => item.provider_id ) ).toEqual( [
			'stl_e2e0003',
			'stl_e2e0002',
			'stl_e2e0001',
		] );
		for ( const item of saved.items ) {
			expect( item.account.verified ).toBe( true );
			expect( item.account.organization_id ).toBe( 'org_e2e0001' );
			expect( item.sources ).toEqual( [ 'api' ] );
			expect( item.last_refreshed_at ).not.toBeNull();
			expect( item.last_failure ).toBeNull();
		}

		// Both payment pages of the first settlement arrived, once each.
		const first = await byProviderId( 'stl_e2e0001' );
		expect( first.reference ).toBe( 'E2E.2605.01' );
		expect( first.amount ).toBe( '38.55' );
		expect( first.currency ).toBe( 'EUR' );
		expect( first.status ).toBe( 'paidout' );
		expect( first.settled_at ).not.toBeNull();
		expect( first.invoice_id ).toBe( 'inv_e2e0001' );
		expect( first.movements.map( ( m ) => m.external_id ).sort() ).toEqual(
			[ 'tr_e2estl01a', 'tr_e2estl01b' ]
		);
		expect( first.revisions.api.coverage.retrieved.payments ).toBe( 2 );
		// The report summary equals the payout, so it is called verified.
		expect( first.revisions.api.coverage.summary_check ).toBe( 'verified' );
		expect( first.completeness ).toBe( 'verified' );
		// Summaries and summed costs are kept apart from the movements.
		expect( first.aggregates.map( ( a ) => a.type ).sort() ).toEqual( [
			'fee',
			'summary',
		] );
		expect( first.revisions.api.totals.detail.settlement_amount ).toBe(
			'40.00'
		);
		expect( first.revisions.api.totals.aggregate.settlement_amount ).toBe(
			'-1.45'
		);

		// Finished pagination alone does not make a settlement verified.
		const second = await byProviderId( 'stl_e2e0002' );
		expect( second.completeness ).toBe( 'unverified' );
		expect( second.revisions.api.coverage.summary_check ).toBe(
			'unavailable'
		);
		expect( second.revisions.api.coverage.retrieved ).toEqual( {
			payments: 2,
			captures: 1,
			refunds: 1,
			chargebacks: 1,
		} );
		const types = Object.fromEntries(
			second.movements.map( ( m ) => [ m.external_id, m ] )
		);
		expect( types.cpt_e2estl02a.type ).toBe( 'capture' );
		expect( types.cpt_e2estl02a.payment_reference ).toBe( 'tr_e2estl02a' );
		expect( types.re_e2estl02a.type ).toBe( 'refund' );
		expect( types.re_e2estl02a.settlement_amount ).toBe( '-10.00' );
		expect( types.chb_e2estl02a.type ).toBe( 'chargeback' );
		// Original and settlement currency stay distinct.
		expect( types.tr_e2estl02b.amount ).toBe( '40.00' );
		expect( types.tr_e2estl02b.currency ).toBe( 'USD' );
		expect( types.tr_e2estl02b.settlement_amount ).toBe( '36.80' );
		expect( types.tr_e2estl02b.settlement_currency ).toBe( 'EUR' );
		// The payment settled through its capture is not counted twice, and
		// the payout is kept apart from the movement total.
		expect( second.revisions.api.totals.payments_settled_by_captures ).toBe(
			1
		);
		expect( second.revisions.api.totals.detail.settlement_amount ).toBe(
			'50.00'
		);
		expect( second.amount ).toBe( '50.00' );

		const open = await byProviderId( 'stl_e2e0003' );
		expect( open.status ).toBe( 'open' );
		expect( open.reference ).toBeNull();
		expect( open.settled_at ).toBeNull();
		expect( open.movements ).toEqual( [] );
	} );

	test( 'does not duplicate settlements or movements when loaded again', async () => {
		await runImport();
		const before = await byProviderId( 'stl_e2e0002' );

		const again = await runImport();
		expect( again.status ).toBe( 'completed' );

		const after = await byProviderId( 'stl_e2e0002' );
		expect( ( await list() ).total ).toBe( 3 );
		expect( ( await accounts() ).accounts ).toHaveLength( 1 );
		expect( after.id ).toBe( before.id );
		expect( after.movements ).toHaveLength( before.movements.length );
		// Unchanged facts keep the revision that was already published.
		expect( after.revisions.api.id ).toBe( before.revisions.api.id );
		expect( after.revisions.api.content_hash ).toBe(
			before.revisions.api.content_hash
		);
		expect( after.material_change_at ).toBeNull();
		expect( after.discrepancies ).toEqual( [] );
	} );

	test( 'recovers an interrupted import without losing or repeating data', async () => {
		// The second payment page of stl_e2e0001 fails.
		await setState( {
			fail_match: 'stl_e2e0001/payments?from=tr_e2estl01b',
		} );

		const failed = await runImport();
		expect( failed.status ).toBe( 'failed' );
		expect( failed.resumable ).toBe( true );
		expect( failed.error_code ).toBe( 'mollie_request_failed' );
		expect( failed.error_message ).not.toContain( 'E2E' );
		expect( failed.progress.settlements_done ).toBe( 2 );

		// The half-loaded settlement is visibly incomplete, with its failure
		// recorded apart from its data; the finished ones are untouched.
		const partial = await byProviderId( 'stl_e2e0001' );
		expect( partial.completeness ).toBe( 'incomplete' );
		expect( partial.sources ).toEqual( [] );
		expect( partial.movements ).toEqual( [] );
		expect( partial.last_failure.code ).toBe( 'mollie_request_failed' );
		expect( partial.last_refreshed_at ).toBeNull();
		expect( ( await byProviderId( 'stl_e2e0002' ) ).completeness ).toBe(
			'unverified'
		);

		// Reopening the page finds the run to continue.
		const open = await api.get( IMPORTS, { headers: admin } );
		expect( ( await open.json() ).run.id ).toBe( failed.id );

		// Continuing while Mollie still fails changes nothing.
		const stillFailed = await step( failed.id );
		expect( stillFailed.status ).toBe( 'failed' );
		expect( stillFailed.progress.requests_done ).toBe(
			failed.progress.requests_done
		);

		await setState( { fail_match: '' } );
		const resumed = await drive( await step( failed.id ) );
		expect( resumed.status ).toBe( 'completed' );
		expect( resumed.id ).toBe( failed.id );
		expect( resumed.progress.settlements_done ).toBe( 3 );

		const complete = await byProviderId( 'stl_e2e0001' );
		expect( complete.completeness ).toBe( 'verified' );
		expect( complete.last_failure ).toBeNull();
		expect(
			complete.movements.map( ( m ) => m.external_id ).sort()
		).toEqual( [ 'tr_e2estl01a', 'tr_e2estl01b' ] );
		expect( ( await list() ).total ).toBe( 3 );
		expect(
			( await ( await api.get( IMPORTS, { headers: admin } ) ).json() )
				.run
		).toBeNull();

		// A finished run cannot be stepped again.
		const finished = await api.post( `${ IMPORTS }/${ failed.id }/step`, {
			headers: admin,
		} );
		expect( finished.status() ).toBe( 409 );
		expect( ( await finished.json() ).code ).toBe(
			'settlement_import_finished'
		);
	} );

	test( 'continues a run whose request died', async () => {
		const started = await startImport( { kind: 'history' } );
		const { run } = await started.json();
		await step( run.id );
		await step( run.id );

		// No heartbeat for an hour: the request driving it is gone.
		await setState( { age_running: true } );
		const open = await api.get( IMPORTS, { headers: admin } );
		const interrupted = ( await open.json() ).run;
		expect( interrupted.id ).toBe( run.id );
		expect( interrupted.status ).toBe( 'interrupted' );
		expect( interrupted.resumable ).toBe( true );
		expect( interrupted.error_code ).toBe( 'interrupted' );

		const resumed = await drive( await step( run.id ) );
		expect( resumed.status ).toBe( 'completed' );
		expect( await mollieRequests() ).toBe( 18 );
		expect( ( await list() ).total ).toBe( 3 );
	} );

	test( 'refuses overlapping imports and replaces an unfinished one on request', async () => {
		const first = await startImport( { kind: 'history' } );
		expect( first.status() ).toBe( 201 );
		const { run } = await first.json();

		const overlapping = await startImport( { kind: 'history' } );
		expect( overlapping.status() ).toBe( 409 );
		const body = await overlapping.json();
		expect( body.code ).toBe( 'settlement_import_in_progress' );
		expect( body.data.run.id ).toBe( run.id );

		// Stop it part-way through a settlement, then start over.
		await setState( { fail_match: 'stl_e2e0003/captures' } );
		const failed = await drive( await step( run.id ) );
		expect( failed.status ).toBe( 'failed' );
		await setState( { fail_match: '' } );

		const replacement = await runImport();
		expect( replacement.status ).toBe( 'completed' );
		expect( replacement.id ).not.toBe( run.id );

		// The replaced run is closed for good.
		const stale = await api.post( `${ IMPORTS }/${ run.id }/step`, {
			headers: admin,
		} );
		expect( stale.status() ).toBe( 409 );
		expect( ( await list() ).total ).toBe( 3 );
		expect( ( await byProviderId( 'stl_e2e0003' ) ).completeness ).toBe(
			'unverified'
		);
	} );

	test( 'keeps the last complete data when a refresh fails, then exposes what changed', async () => {
		await runImport();
		const before = await byProviderId( 'stl_e2e0001' );

		// Mollie now reports different amounts, and the refresh dies half-way.
		await setState( {
			variant: 'changed',
			fail_match: 'stl_e2e0001/payments?from=tr_e2estl01b',
		} );
		const failed = await runImport( {
			kind: 'refresh',
			settlement_id: before.id,
		} );
		expect( failed.status ).toBe( 'failed' );
		expect( failed.settlement_id ).toBe( before.id );

		const during = await detail( before.id );
		expect( during.amount ).toBe( '38.55' );
		expect( during.completeness ).toBe( 'verified' );
		expect( during.revisions.api.id ).toBe( before.revisions.api.id );
		expect( during.movements ).toEqual( before.movements );
		expect( during.last_refreshed_at ).toBe( before.last_refreshed_at );
		// The failure is recorded on its own.
		expect( during.last_failure.code ).toBe( 'mollie_request_failed' );
		expect( during.last_failure.message ).not.toBe( '' );

		await setState( { fail_match: '' } );
		const resumed = await drive( await step( failed.id ) );
		expect( resumed.status ).toBe( 'completed' );

		const after = await detail( before.id );
		expect( after.id ).toBe( before.id );
		expect( after.amount ).toBe( '37.55' );
		expect( after.last_failure ).toBeNull();
		expect(
			after.movements.find( ( m ) => m.external_id === 'tr_e2estl01b' )
				.settlement_amount
		).toBe( '14.00' );
		// A new revision with a different hash; the change is flagged.
		expect( after.revisions.api.id ).toBeGreaterThan(
			before.revisions.api.id
		);
		expect( after.revisions.api.content_hash ).not.toBe(
			before.revisions.api.content_hash
		);
		expect( after.material_change_at ).not.toBeNull();
		expect( after.discrepancies.map( ( d ) => d.code ) ).toContain(
			'source_changed'
		);
		// Only the refreshed settlement was requested again.
		expect(
			( await byProviderId( 'stl_e2e0002' ) ).material_change_at
		).toBeNull();
	} );

	// Synthetic report: 0.7545 + 1.5300 + 1.3700 + 0.2500 - 0.0045 = 3.9000.
	test( 'keeps fractional-cent report amounts, rates and invoices exactly', async () => {
		await setState( { variant: 'precise' } );
		await runImport();
		const requests = await mollieRequests();

		const saved = await byProviderId( 'stl_e2e0001' );
		// Reopening reads the saved report without contacting Mollie.
		expect( await mollieRequests() ).toBe( requests );

		expect( saved.amount ).toBe( '36.10' );
		expect( saved.invoice_id ).toBe( 'inv_e2e0001' );
		expect( saved.report.source ).toBe( 'api' );
		expect( saved.report.status ).toBe( 'available' );
		expect( saved.report.summary ).toMatchObject( {
			currency: 'EUR',
			lines: 6,
			missing: 0,
			invalid: 0,
			other_currency: 0,
			complete: true,
			revenue: { lines: 1, amount: '40.00' },
			refunds: { lines: 0, amount: null },
			costs: { lines: 5, amount: '-3.9000' },
			net: '36.1000',
			payout: '36.10',
			difference: '0.0000',
			check: 'verified',
		} );

		expect( saved.report.periods ).toHaveLength( 1 );
		const [ period ] = saved.report.periods;
		expect( period ).toMatchObject( {
			year: '2026',
			month: '05',
			invoice_id: 'inv_e2e0001',
			invoice_reference: '2026.10001',
		} );
		expect( period.revenue ).toHaveLength( 1 );
		expect( period.revenue[ 0 ].amount_gross ).toEqual( {
			value: '40.00',
			currency: 'EUR',
			state: 'provided',
		} );
		// Not sent is not zero.
		expect( period.revenue[ 0 ].amount_vat.state ).toBe( 'missing' );
		expect( period.revenue[ 0 ].amount_vat.value ).toBeNull();

		const costs = Object.fromEntries(
			period.costs.map( ( line ) => [ line.description, line ] )
		);
		expect( Object.keys( costs ) ).toHaveLength( 5 );
		expect( costs.iDEAL ).toMatchObject( {
			method: 'ideal',
			count: 2,
			is_refund: false,
			needs_review: false,
			rate_fixed: { value: '0.3118', currency: 'EUR', state: 'provided' },
			rate_percentage: { value: null, state: 'missing' },
			amount_net: { value: '0.6236', currency: 'EUR', state: 'provided' },
			amount_vat: { value: '0.1309', currency: 'EUR', state: 'provided' },
			amount_gross: {
				value: '0.7545',
				currency: 'EUR',
				state: 'provided',
			},
			// Costs reduce the payout; Mollie's own sign stays on the amounts.
			contribution: {
				value: '-0.7545',
				currency: 'EUR',
				state: 'provided',
			},
		} );
		expect( costs[ 'Credit card' ].rate_percentage ).toEqual( {
			value: '1.8',
			state: 'provided',
		} );
		expect( costs[ 'Credit card' ].amount_gross.value ).toBe( '1.5300' );
		expect( costs[ 'Refunds iDEAL' ].is_refund ).toBe( true );
		// Zero VAT is a value; it is not "not provided".
		expect( costs[ 'Refunds iDEAL' ].amount_vat ).toEqual( {
			value: '0.0000',
			currency: 'EUR',
			state: 'provided',
		} );
		// A negative cost adjustment increases the payout.
		expect( costs[ 'Rounding difference' ] ).toMatchObject( {
			method: null,
			count: null,
			amount_gross: { value: '-0.0045', state: 'provided' },
			contribution: { value: '0.0045', state: 'provided' },
		} );

		// The report matches the payout and nothing needs review.
		expect( saved.revisions.api.coverage.summary_check ).toBe( 'verified' );
		expect( saved.completeness ).toBe( 'verified' );
		expect( saved.discrepancies ).toEqual( [] );
		// Report lines are flagged as such and totalled apart from movements.
		expect( saved.aggregates ).toHaveLength( 6 );
		expect( saved.aggregates.every( ( row ) => row.in_report ) ).toBe(
			true
		);
		expect( saved.revisions.api.totals.aggregate.settlement_amount ).toBe(
			'-3.9000'
		);
		expect( saved.revisions.api.totals.detail.settlement_amount ).toBe(
			'40.00'
		);

		// Loading the same report again keeps the published revision.
		await runImport();
		const again = await detail( saved.id );
		expect( again.revisions.api.id ).toBe( saved.revisions.api.id );
		expect( again.revisions.api.content_hash ).toBe(
			saved.revisions.api.content_hash
		);
		expect( again.material_change_at ).toBeNull();
		expect( again.report ).toEqual( saved.report );
	} );

	test( 'reports a difference below one cent instead of calling the report verified', async () => {
		await setState( { variant: 'precise_residual' } );
		await runImport();

		const saved = await byProviderId( 'stl_e2e0001' );
		expect( saved.report.summary ).toMatchObject( {
			costs: { lines: 4, amount: '-3.9045' },
			net: '36.0955',
			payout: '36.10',
			difference: '-0.0045',
			check: 'mismatch',
		} );
		expect( saved.revisions.api.coverage.summary_check ).toBe( 'mismatch' );
		expect( saved.completeness ).toBe( 'unverified' );
		const mismatch = saved.discrepancies.find(
			( d ) => d.code === 'summary_total_mismatch'
		);
		expect( mismatch.difference ).toBe( '-0.0045' );
		expect( mismatch.currency ).toBe( 'EUR' );
		expect( mismatch.message ).toContain( '-0.0045 EUR' );
	} );

	test( 'says when Mollie sent no report for a settlement', async () => {
		await runImport();

		const saved = await byProviderId( 'stl_e2e0002' );
		expect( saved.report.status ).toBe( 'not_provided' );
		expect( saved.report.summary ).toBeNull();
		expect( saved.report.periods ).toEqual( [] );
	} );

	test( 'keeps an earlier revision readable and loads its report details on refresh', async () => {
		await setState( { variant: 'precise' } );
		await runImport();
		// As saved before report details were kept.
		await setState( { forget_reports: true } );

		const legacy = await byProviderId( 'stl_e2e0001' );
		expect( legacy.report ).toEqual( {
			source: 'api',
			status: 'legacy',
			summary: null,
			periods: [],
		} );
		// Still readable: payout facts, movements and the earlier rows.
		expect( legacy.amount ).toBe( '36.10' );
		expect( legacy.movements ).toHaveLength( 2 );
		expect( legacy.aggregates ).toHaveLength( 6 );
		expect( legacy.aggregates.some( ( row ) => row.in_report ) ).toBe(
			false
		);

		// A failed refresh leaves the earlier revision in place.
		await setState( {
			fail_match: 'stl_e2e0001/payments?from=tr_e2estl01b',
		} );
		const failed = await runImport( {
			kind: 'refresh',
			settlement_id: legacy.id,
		} );
		expect( failed.status ).toBe( 'failed' );
		const during = await detail( legacy.id );
		expect( during.revisions.api.id ).toBe( legacy.revisions.api.id );
		expect( during.report.status ).toBe( 'legacy' );
		expect( during.last_failure.code ).toBe( 'mollie_request_failed' );

		await setState( { fail_match: '' } );
		const resumed = await drive( await step( failed.id ) );
		expect( resumed.status ).toBe( 'completed' );

		// A new revision carries the details; the earlier one is not edited.
		const refreshed = await detail( legacy.id );
		expect( refreshed.id ).toBe( legacy.id );
		expect( refreshed.revisions.api.id ).toBeGreaterThan(
			legacy.revisions.api.id
		);
		expect( refreshed.report.status ).toBe( 'available' );
		expect( refreshed.report.summary.net ).toBe( '36.1000' );
		expect( refreshed.report.summary.check ).toBe( 'verified' );
		expect( refreshed.last_failure ).toBeNull();
		// Gaining report details is not Mollie changing the settlement.
		expect( refreshed.material_change_at ).toBeNull();
		expect( refreshed.discrepancies.map( ( d ) => d.code ) ).not.toContain(
			'source_changed'
		);
		expect( refreshed.movements ).toEqual( legacy.movements );
	} );

	test( 'flags a report that Mollie changed on a later refresh', async () => {
		await setState( { variant: 'precise' } );
		await runImport();
		const before = await byProviderId( 'stl_e2e0001' );

		// Mollie drops the rounding line.
		await setState( { variant: 'precise_residual' } );
		const run = await runImport( {
			kind: 'refresh',
			settlement_id: before.id,
		} );
		expect( run.status ).toBe( 'completed' );

		const after = await detail( before.id );
		expect( after.revisions.api.id ).toBeGreaterThan(
			before.revisions.api.id
		);
		expect( after.revisions.api.content_hash ).not.toBe(
			before.revisions.api.content_hash
		);
		expect( after.material_change_at ).not.toBeNull();
		expect( after.discrepancies.map( ( d ) => d.code ) ).toEqual(
			expect.arrayContaining( [
				'source_changed',
				'summary_total_mismatch',
			] )
		);
		expect( after.report.summary.difference ).toBe( '-0.0045' );
		// The movements did not change.
		expect( after.movements ).toEqual( before.movements );
	} );

	test( 'keeps the Mollie report apart from the costs of an uploaded file', async () => {
		await setState( { variant: 'precise' } );
		await runImport();
		const saved = await byProviderId( 'stl_e2e0001' );

		const imported = await importCsv( MATCHING_CSV, {
			account_id: String( saved.account.id ),
			confirm_account: 'true',
		} );
		expect( imported.settlement_id ).toBe( saved.id );

		const merged = await detail( saved.id );
		expect( merged.sources ).toEqual( [ 'api', 'csv' ] );
		// The file's summed fee is its own row and is not a report line.
		const fileRows = merged.aggregates.filter( ( row ) => ! row.in_report );
		expect( fileRows ).toHaveLength( 1 );
		expect( fileRows[ 0 ].sources ).toEqual( [ 'csv' ] );
		expect( fileRows[ 0 ].settlement_amount ).toBe( '-1.45' );
		// The report and its total are unchanged by the file.
		expect( merged.report ).toEqual( saved.report );
		expect( merged.revisions.api.totals.aggregate.settlement_amount ).toBe(
			'-3.9000'
		);
		expect( merged.revisions.csv.totals.aggregate.settlement_amount ).toBe(
			'-1.45'
		);
		// Each payment is still one movement from both sources.
		expect( merged.movements ).toHaveLength( 2 );
	} );

	test( 'does not serve the report to users who cannot manage settlements', async () => {
		await setState( { variant: 'precise' } );
		await runImport();
		const saved = await byProviderId( 'stl_e2e0001' );
		const editor = await createUser( 'editor' );

		const forbidden = await api.get( `${ SETTLEMENTS }/${ saved.id }`, {
			headers: editor,
		} );
		expect( forbidden.status() ).toBe( 403 );
		expect( await forbidden.text() ).not.toContain( '0.7545' );

		const anonymous = await api.get( `${ SETTLEMENTS }/${ saved.id }` );
		expect( anonymous.status() ).toBe( 401 );
	} );

	test( 'explains a missing permission while saved data and CSV import stay available', async () => {
		await runImport();
		await setState( { scopes: [ 'payments.read' ] } );

		const blocked = await startImport( { kind: 'history' } );
		expect( blocked.status() ).toBe( 403 );
		const body = await blocked.json();
		expect( body.code ).toBe( 'settlement_access_missing' );
		expect( body.message ).toContain( 'Reconnect Mollie' );

		const connection = ( await accounts() ).connection;
		expect( connection.connected ).toBe( true );
		expect( connection.can_import ).toBe( false );
		expect( connection.problem ).toBe( 'settlement_access_missing' );

		expect( ( await list() ).total ).toBe( 3 );
		expect(
			( await byProviderId( 'stl_e2e0001' ) ).movements
		).toHaveLength( 2 );
		const imported = await importCsv(
			buildCsv( 'E2E.SCOPE.01', [
				{ id: 'tr_e2escope01', amount: '5.00' },
			] ),
			{ account_label: 'No permission' }
		);
		expect( imported.outcome ).toBe( 'new' );

		// A run that loses the permission stops and can continue once it is back.
		await setState( { scopes: [ 'payments.read', 'settlements.read' ] } );
		const started = await startImport( { kind: 'history' } );
		const { run } = await started.json();
		await setState( { scopes: [] } );
		const stopped = await step( run.id );
		expect( stopped.status ).toBe( 'failed' );
		expect( stopped.error_code ).toBe( 'settlement_access_missing' );
		expect( stopped.resumable ).toBe( true );

		await setState( { scopes: [ 'payments.read', 'settlements.read' ] } );
		expect( ( await drive( await step( run.id ) ) ).status ).toBe(
			'completed'
		);
	} );

	test( 'stops an import when Mollie is switched to another organization', async () => {
		const started = await startImport( { kind: 'history' } );
		const { run } = await started.json();
		await step( run.id );
		await step( run.id );

		await setState( { organization_id: 'org_e2e0002' } );
		const stopped = await step( run.id );
		expect( stopped.status ).toBe( 'aborted' );
		expect( stopped.resumable ).toBe( false );
		expect( stopped.error_code ).toBe( 'account_switched' );

		const again = await api.post( `${ IMPORTS }/${ run.id }/step`, {
			headers: admin,
		} );
		expect( again.status() ).toBe( 409 );

		// Nothing half-loaded was published, and the first account's records
		// cannot be refreshed through the other organization.
		const first = ( await list() ).items;
		expect( first.every( ( item ) => item.sources.length === 0 ) ).toBe(
			true
		);
		const refresh = await startImport( {
			kind: 'refresh',
			settlement_id: first[ 0 ].id,
		} );
		expect( refresh.status() ).toBe( 409 );
		expect( ( await refresh.json() ).code ).toBe(
			'settlement_account_mismatch'
		);

		// The other organization gets its own account and records.
		expect( ( await runImport() ).status ).toBe( 'completed' );
		const all = await list( '?per_page=100' );
		// Two listed for the first organization, three loaded for the other.
		expect( all.total ).toBe( 5 );
		const listed = await accounts();
		expect( listed.accounts ).toHaveLength( 2 );
		const other = listed.accounts.find(
			( account ) => account.organization_id === 'org_e2e0002'
		);
		expect( other.is_connected ).toBe( true );
		expect( ( await list( `?account_id=${ other.id }` ) ).total ).toBe( 3 );
	} );

	test( 'converges a CSV and the API on one settlement and shows conflicting values', async () => {
		await runImport();
		const api1 = await byProviderId( 'stl_e2e0001' );
		const account = api1.account;

		const differing = buildCsv( 'E2E.2605.01', [
			{ id: 'tr_e2estl01a', amount: '25.00' },
			{ id: 'tr_e2estl01b', amount: '15.00', settled: '14.50' },
			{ id: 'tr_e2estl01x', amount: '2.00' },
			{ amount: '-1.45', description: 'Transaction fees ideal' },
		] );

		const preview = await upload( CSV_VALIDATE, differing, {
			account_id: String( account.id ),
		} );
		const previewed = await preview.json();
		expect( previewed.outcome ).toBe( 'attach' );
		expect( previewed.settlement_id ).toBe( api1.id );
		expect( previewed.requires_confirming ).toBe( true );

		// A file does not prove which organization it came from.
		const unconfirmed = await upload( CSV_IMPORT, differing, {
			account_id: String( account.id ),
		} );
		expect( unconfirmed.status() ).toBe( 400 );
		expect( ( await unconfirmed.json() ).code ).toBe(
			'settlement_account_confirmation_required'
		);

		const imported = await importCsv( differing, {
			account_id: String( account.id ),
			confirm_account: 'true',
		} );
		expect( imported.outcome ).toBe( 'attach' );
		expect( imported.settlement_id ).toBe( api1.id );

		// Still one record for this payout.
		expect( ( await list() ).total ).toBe( 3 );
		const merged = await detail( api1.id );
		expect( merged.sources ).toEqual( [ 'api', 'csv' ] );
		expect( merged.provider_id ).toBe( 'stl_e2e0001' );
		// Provider facts stay as Mollie reported them.
		expect( merged.amount ).toBe( '38.55' );

		const movements = Object.fromEntries(
			merged.movements.map( ( m ) => [ m.external_id, m ] )
		);
		// Reported by both: one row, not two.
		expect( merged.movements ).toHaveLength( 3 );
		expect( movements.tr_e2estl01a.sources ).toEqual( [ 'api', 'csv' ] );
		expect( movements.tr_e2estl01a.conflict ).toBeNull();
		// Contradicting values: both visible, Mollie's shown, nothing summed.
		expect( movements.tr_e2estl01b.settlement_amount ).toBe( '15.00' );
		expect( movements.tr_e2estl01b.conflict.settlement_amount ).toEqual( {
			api: '15.00',
			csv: '14.50',
		} );
		expect( movements.tr_e2estl01x.sources ).toEqual( [ 'csv' ] );
		// Each source keeps its own totals.
		expect( merged.revisions.api.totals.detail.settlement_amount ).toBe(
			'40.00'
		);
		expect( merged.revisions.csv.totals.detail.settlement_amount ).toBe(
			'41.50'
		);
		// Summed fee rows are never merged across sources.
		expect(
			merged.aggregates.filter( ( a ) => a.type === 'fee' )
		).toHaveLength( 2 );

		const codes = merged.discrepancies.map( ( d ) => d.code );
		expect( codes ).toContain( 'value_conflict' );
		expect( codes ).toContain( 'only_in_csv' );
		expect( codes ).not.toContain( 'only_in_api' );
		expect(
			merged.discrepancies.find( ( d ) => d.code === 'value_conflict' )
				.external_id
		).toBe( 'tr_e2estl01b' );
		expect(
			( await list() ).items.find( ( item ) => item.id === api1.id )
				.discrepancy_count
		).toBe( 2 );

		// Loading from Mollie again keeps the CSV side and the single record.
		await runImport();
		const reloaded = await detail( api1.id );
		expect( reloaded.sources ).toEqual( [ 'api', 'csv' ] );
		expect( reloaded.movements ).toHaveLength( 3 );
		expect( ( await list() ).total ).toBe( 3 );
	} );

	test( 'cannot refresh a settlement that only came from a file', async () => {
		await runImport();
		const [ verified ] = ( await accounts() ).accounts;

		const early = await importCsv(
			buildCsv( 'E2E.EARLY.01', [
				{ id: 'tr_e2eearly001', amount: '9.00' },
			] ),
			{ account_id: String( verified.id ), confirm_account: 'true' }
		);
		expect( early.outcome ).toBe( 'new' );
		const csvOnly = await detail( early.settlement_id );
		expect( csvOnly.provider_id ).toBeNull();
		expect( csvOnly.can_refresh ).toBe( false );

		// Without a provider record there is nothing to refresh by ID.
		const refresh = await startImport( {
			kind: 'refresh',
			settlement_id: csvOnly.id,
		} );
		expect( refresh.status() ).toBe( 409 );
		expect( ( await refresh.json() ).code ).toBe(
			'settlement_not_from_mollie'
		);
	} );

	test( 'keeps an unconfirmed account apart until its identity is confirmed', async () => {
		// CSV first, into a named local account.
		const local = await importCsv( MATCHING_CSV, {
			account_label: 'Old exports',
		} );
		const extra = await importCsv(
			buildCsv( 'E2E.LOCAL.09', [
				{ id: 'tr_e2elocal09', amount: '7.00' },
			] ),
			{ account_label: 'Old exports' }
		);
		await runImport();

		// Same reference, but nothing proves it is the same organization yet.
		expect( ( await list() ).total ).toBe( 5 );
		const unmerged = await detail( local.settlement_id );
		expect( unmerged.sources ).toEqual( [ 'csv' ] );
		expect( unmerged.account.verified ).toBe( false );
		expect( ( await byProviderId( 'stl_e2e0001' ) ).sources ).toEqual( [
			'api',
		] );

		const localAccount = ( await accounts() ).accounts.find(
			( account ) => ! account.verified
		);
		expect( localAccount.label ).toBe( 'Old exports' );

		// Only the connected organization can be confirmed.
		const wrong = await api.post(
			`${ ACCOUNTS }/${ localAccount.id }/confirm`,
			{ headers: admin, data: { organization_id: 'org_e2e0009' } }
		);
		expect( wrong.status() ).toBe( 409 );
		expect( ( await wrong.json() ).code ).toBe(
			'settlement_account_mismatch'
		);
		expect( ( await list() ).total ).toBe( 5 );

		const confirmed = await api.post(
			`${ ACCOUNTS }/${ localAccount.id }/confirm`,
			{ headers: admin, data: { organization_id: 'org_e2e0001' } }
		);
		expect( confirmed.status(), await confirmed.text() ).toBe( 200 );
		expect( ( await confirmed.json() ).account.verified ).toBe( true );

		// The shared payout is now one record with both sources; the other
		// file's settlement moved to the confirmed account.
		expect( ( await list() ).total ).toBe( 4 );
		expect( ( await accounts() ).accounts ).toHaveLength( 1 );
		const merged = await byProviderId( 'stl_e2e0001' );
		expect( merged.sources ).toEqual( [ 'api', 'csv' ] );
		expect( merged.movements ).toHaveLength( 2 );
		expect( merged.discrepancies ).toEqual( [] );
		const moved = await detail( extra.settlement_id );
		expect( moved.account.verified ).toBe( true );
		expect( moved.reference ).toBe( 'E2E.LOCAL.09' );

		// Confirming twice is refused.
		const again = await api.post(
			`${ ACCOUNTS }/${ moved.account.id }/confirm`,
			{ headers: admin, data: { organization_id: 'org_e2e0001' } }
		);
		expect( again.status() ).toBe( 409 );
	} );

	test( 'converges when the CSV came first and its account was confirmed before loading', async () => {
		const local = await importCsv( MATCHING_CSV, {
			account_label: 'Confirmed early',
		} );
		const [ localAccount ] = ( await accounts() ).accounts;

		const confirmed = await api.post(
			`${ ACCOUNTS }/${ localAccount.id }/confirm`,
			{ headers: admin, data: { organization_id: 'org_e2e0001' } }
		);
		expect( confirmed.status(), await confirmed.text() ).toBe( 200 );

		await runImport();

		// Mollie's settlement adopted the record the file created.
		expect( ( await list() ).total ).toBe( 3 );
		const merged = await detail( local.settlement_id );
		expect( merged.provider_id ).toBe( 'stl_e2e0001' );
		expect( merged.sources ).toEqual( [ 'api', 'csv' ] );
		expect( merged.amount ).toBe( '38.55' );
		expect( merged.movements ).toHaveLength( 2 );
		expect( merged.discrepancies ).toEqual( [] );
	} );

	test( 'links movements to local payments once they exist', async () => {
		await runImport();
		const before = await byProviderId( 'stl_e2e0001' );
		expect( before.unresolved_payment_count ).toBe( 2 );

		const res = await api.post( '/wp-json/fair-e2e/v1/test-transactions', {
			headers: admin,
			data: {
				amount: 25,
				status: 'paid',
				description: 'E2E settlement payment',
				mollie_payment_id: 'tr_e2estl01a',
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const { id } = await res.json();
		seeded.push( id );

		// No re-import needed: the reference was kept.
		const after = await detail( before.id );
		expect( after.unresolved_payment_count ).toBe( 1 );
		expect(
			after.movements.find( ( m ) => m.external_id === 'tr_e2estl01a' )
				.local_transaction_id
		).toBe( id );
		expect(
			after.movements.find( ( m ) => m.external_id === 'tr_e2estl01b' )
				.local_transaction_id
		).toBeNull();
	} );

	test( 'leaves reconciliation decisions untouched', async () => {
		const reconciliation = async () => {
			const res = await api.get(
				'/wp-json/fair-finance/v1/reconciliation',
				{
					headers: admin,
				}
			);
			expect( res.ok(), await res.text() ).toBeTruthy();
			return res.json();
		};
		const before = await reconciliation();

		await runImport();
		await importCsv( MATCHING_CSV, { account_label: 'Side by side' } );
		await setState( { variant: 'changed' } );
		await runImport();

		expect( await reconciliation() ).toEqual( before );
	} );

	test( 'reads saved settlements without contacting Mollie', async () => {
		await runImport();
		const requests = await mollieRequests();
		await setConnected( false );

		const saved = await list();
		expect( saved.total ).toBe( 3 );
		for ( const item of saved.items ) {
			const one = await detail( item.id );
			expect( one.provider_id ).toBe( item.provider_id );
			// Refreshing needs the connection; reading does not.
			expect( one.can_refresh ).toBe( true );
		}
		await accounts();
		await api.get( IMPORTS, { headers: admin } );

		expect( await mollieRequests() ).toBe( requests );
	} );
} );
