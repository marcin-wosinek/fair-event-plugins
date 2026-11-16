/**
 * Playwright API tests for bank-imported entries' origin (#2342).
 *
 * Imports can reference a bank account (an ID and a display name). A bank
 * import can never be recorded as event cash or personal funds, through
 * ordinary edits, split allocations or after unsplitting, while its
 * description, budget, event and tag stay editable. Provenance fields are
 * not writable through ordinary entry endpoints. A legacy import that was
 * classified before the protection keeps its classification, accepts
 * unrelated edits, and refuses changes to it.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const basicAuth = ( user, password ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ user }:${ password }` ).toString(
		'base64'
	) }`,
} );
const headers = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const IMPORT = `${ ENTRIES }/import`;
const ACCOUNTS = '/wp-json/fair-finance/v1/bank-accounts';
const BUDGETS = '/wp-json/fair-finance/v1/budgets';
const LEGACY = '/wp-json/fair-e2e/v1/finance/legacy-classification';
const DAY = '2031-07-09';

test.describe( 'FinancialEntry bank origin', () => {
	let api;
	let suffix;
	let postId;
	let eventDateId;
	let budgetId;
	let account;
	let subscriber;
	let sequence = 0;
	const entryIds = [];

	const get = async ( id ) => {
		const res = await api.get( `${ ENTRIES }/${ id }`, { headers } );
		expect( res.status() ).toBe( 200 );
		return res.json();
	};

	// Import one entry and return it as stored.
	const importEntry = async ( data = {}, bankAccountId = null ) => {
		const reference = `bank-origin-${ suffix }-${ ++sequence }`;
		const res = await api.post( IMPORT, {
			headers,
			data: {
				import_source: `bank-${ suffix }.xlsx`,
				bank_account_id: bankAccountId,
				entries: [
					{
						amount: 40,
						entry_type: 'cost',
						entry_date: DAY,
						description: 'Imported room hire',
						external_reference: reference,
						...data,
					},
				],
			},
		} );
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await res.json() ).imported ).toBe( 1 );

		const list = await api.get(
			`${ ENTRIES }?date_from=${ DAY }&date_to=${ DAY }&per_page=100`,
			{ headers }
		);
		const entry = ( await list.json() ).entries.find(
			( row ) => row.external_reference === reference
		);
		expect( entry ).toBeTruthy();
		entryIds.push( entry.id );
		return entry;
	};

	// Fields every ordinary editor sends.
	const editable = ( entry, changes = {} ) => ( {
		amount: entry.amount,
		entry_type: entry.entry_type,
		entry_date: entry.entry_date,
		description: entry.description,
		budget_id: entry.budget_id,
		event_url: entry.event_url,
		event_date_id: entry.event_date_id,
		tag: entry.tag,
		...changes,
	} );

	const put = ( entry, changes ) =>
		api.put( `${ ENTRIES }/${ entry.id }`, {
			headers,
			data: editable( entry, changes ),
		} );

	const expectBankImportRefusal = async ( res ) => {
		expect( res.status() ).toBe( 409 );
		expect( ( await res.json() ).code ).toBe( 'rest_entry_bank_import' );
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		suffix = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers,
			data: { title: `Bank origin ${ suffix }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;
		const ensureRes = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers, data: { post_id: postId } }
		);
		expect( ensureRes.ok() ).toBeTruthy();
		eventDateId = ( await ensureRes.json() ).id;

		const budgetRes = await api.post( BUDGETS, {
			headers,
			data: { name: `Bank origin ${ suffix }` },
		} );
		expect( budgetRes.status() ).toBe( 201 );
		budgetId = ( await budgetRes.json() ).id;

		const accountRes = await api.post( ACCOUNTS, {
			headers,
			data: { name: `  Main account ${ suffix }  ` },
		} );
		expect( accountRes.status() ).toBe( 201 );
		account = await accountRes.json();

		const username = `bank-origin-subscriber-${ suffix }`;
		const password = 'Bank-origin-test-2342!';
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		subscriber = {
			id: ( await userRes.json() ).id,
			headers: basicAuth( username, password ),
		};
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		}
		if ( budgetId ) {
			await api.delete( `${ BUDGETS }/${ budgetId }`, { headers } );
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{ headers }
			);
		}
		if ( subscriber ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriber.id }?force=true&reassign=1`,
				{ headers }
			);
		}
		await api.dispose();
	} );

	test( 'creates and lists bank accounts by name only', async () => {
		expect( account.name ).toBe( `Main account ${ suffix }` );
		expect( Object.keys( account ).sort() ).toEqual( [
			'created_at',
			'id',
			'name',
			'updated_at',
		] );

		const list = await api.get( ACCOUNTS, { headers } );
		expect( list.status() ).toBe( 200 );
		expect( await list.json() ).toContainEqual( account );

		const blank = await api.post( ACCOUNTS, {
			headers,
			data: { name: '   ' },
		} );
		expect( blank.status() ).toBe( 400 );
		expect( ( await blank.json() ).data.params.name ).toBeTruthy();

		const long = await api.post( ACCOUNTS, {
			headers,
			data: { name: 'x'.repeat( 256 ) },
		} );
		expect( long.status() ).toBe( 400 );
	} );

	test( 'keeps bank accounts from unauthorized users', async () => {
		const read = await api.get( ACCOUNTS, {
			headers: subscriber.headers,
		} );
		expect( read.status() ).toBe( 403 );

		const write = await api.post( ACCOUNTS, {
			headers: subscriber.headers,
			data: { name: 'Sneaky' },
		} );
		expect( write.status() ).toBe( 403 );

		const anonymous = await request.newContext( { baseURL: BASE_URL } );
		try {
			expect( ( await anonymous.get( ACCOUNTS ) ).status() ).toBe( 401 );
		} finally {
			await anonymous.dispose();
		}
	} );

	test( 'records the originating account on imported entries', async () => {
		const known = await importEntry( {}, account.id );
		expect( known.bank_account_id ).toBe( account.id );
		expect( known.bank_origin ).toEqual( {
			account: { id: account.id, name: account.name },
		} );
		expect( ( await get( known.id ) ).bank_origin ).toEqual(
			known.bank_origin
		);

		const unknown = await importEntry();
		expect( unknown.bank_account_id ).toBeNull();
		expect( unknown.bank_origin ).toEqual( { account: null } );
	} );

	test( 'rejects an import that names a missing account', async () => {
		const reference = `bank-origin-${ suffix }-missing`;
		const res = await api.post( IMPORT, {
			headers,
			data: {
				bank_account_id: 999999999,
				entries: [
					{
						amount: 5,
						entry_type: 'cost',
						entry_date: DAY,
						external_reference: reference,
					},
				],
			},
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'rest_bank_account_not_found' );
		expect( body.data.params.bank_account_id ).toBeTruthy();

		const list = await api.get(
			`${ ENTRIES }?date_from=${ DAY }&date_to=${ DAY }&per_page=100`,
			{ headers }
		);
		expect(
			( await list.json() ).entries.some(
				( row ) => row.external_reference === reference
			)
		).toBe( false );
	} );

	test( 'leaves manual entries without a bank origin', async () => {
		const res = await api.post( ENTRIES, {
			headers,
			data: {
				amount: 12,
				entry_type: 'cost',
				entry_date: DAY,
				description: 'Paid at the door',
				event_date_id: eventDateId,
				payment_source: 'personal_funds',
				payer_name: 'Anna',
			},
		} );
		expect( res.status() ).toBe( 201 );
		const manual = await res.json();
		entryIds.push( manual.id );
		expect( manual.bank_origin ).toBeNull();

		// Manual classification still changes freely.
		const changed = await put( manual, {
			payment_source: 'event_cash',
			payer_name: null,
		} );
		expect( changed.status() ).toBe( 200 );
		expect( ( await changed.json() ).payment_source ).toBe( 'event_cash' );
	} );

	test( 'refuses to record a bank import as event cash or personal funds', async () => {
		const entry = await importEntry(
			{ description: 'Card payment' },
			account.id
		);
		const attempts = [
			{ payment_source: 'event_cash', event_date_id: eventDateId },
			{
				payment_source: 'personal_funds',
				payer_name: 'Anna',
				event_date_id: eventDateId,
			},
			{ payer_name: 'Anna' },
		];
		for ( const changes of attempts ) {
			await expectBankImportRefusal( await put( entry, changes ) );
		}

		const stored = await get( entry.id );
		expect( stored.payment_source ).toBeNull();
		expect( stored.payer_name ).toBeNull();
		expect( stored.event_date_id ).toBeNull();
	} );

	test( 'saves accounting edits on a bank import', async () => {
		const entry = await importEntry( {}, account.id );

		const res = await put( entry, {
			description: 'Room hire, March',
			budget_id: budgetId,
			event_date_id: eventDateId,
			tag: 'venue',
			// Sending the stored (empty) source back is not a change.
			payment_source: null,
			payer_name: null,
		} );
		expect( res.status(), await res.text() ).toBe( 200 );

		const stored = await get( entry.id );
		expect( stored.description ).toBe( 'Room hire, March' );
		expect( stored.budget_id ).toBe( budgetId );
		expect( stored.event_date_id ).toBe( eventDateId );
		expect( stored.tag ).toBe( 'venue' );
		expect( stored.payment_source ).toBeNull();
		expect( stored.bank_origin ).toEqual( entry.bank_origin );
	} );

	test( 'ignores provenance fields in ordinary edits', async () => {
		const entry = await importEntry();
		const other = await api.post( ACCOUNTS, {
			headers,
			data: { name: `Other ${ suffix }` },
		} );
		expect( other.status() ).toBe( 201 );

		const res = await api.put( `${ ENTRIES }/${ entry.id }`, {
			headers,
			data: editable( entry, {
				bank_account_id: ( await other.json() ).id,
				external_reference: 'tampered',
				import_source: 'tampered.xlsx',
				imported_at: null,
				bank_origin: null,
			} ),
		} );
		expect( res.status() ).toBe( 200 );

		const stored = await get( entry.id );
		expect( stored.bank_account_id ).toBeNull();
		expect( stored.external_reference ).toBe( entry.external_reference );
		expect( stored.import_source ).toBe( entry.import_source );
		expect( stored.imported_at ).toBe( entry.imported_at );
		expect( stored.bank_origin ).toEqual( { account: null } );
	} );

	test( 'keeps the origin through split, split edits and unsplit', async () => {
		const entry = await importEntry( { amount: 100 }, account.id );
		const totals = async () =>
			(
				await api.get( `${ ENTRIES }/totals?entry_id=${ entry.id }`, {
					headers,
				} )
			).json();
		const before = await totals();

		const split = await api.post( `${ ENTRIES }/${ entry.id }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 60, budget_id: budgetId, description: 'Room' },
					{ amount: 40, budget_id: null, description: 'Snacks' },
				],
			},
		} );
		expect( split.status(), await split.text() ).toBeLessThan( 300 );

		// The list nests allocations under their parent.
		const listed = async () => {
			const res = await api.get( `${ ENTRIES }?entry_id=${ entry.id }`, {
				headers,
			} );
			const [ parent ] = ( await res.json() ).entries;
			expect( parent.bank_origin ).toEqual( entry.bank_origin );
			return parent.children || [];
		};

		let children = await listed();
		expect( children ).toHaveLength( 2 );
		for ( const child of children ) {
			expect( child.bank_origin ).toEqual( entry.bank_origin );
			expect( ( await get( child.id ) ).bank_origin ).toEqual(
				entry.bank_origin
			);
			await expectBankImportRefusal(
				await put( child, {
					payment_source: 'event_cash',
					event_date_id: eventDateId,
				} )
			);
		}

		// A child stays editable for accounting fields.
		const edited = await put( children[ 0 ], { tag: 'split-tag' } );
		expect( edited.status() ).toBe( 200 );

		const replaced = await api.put( `${ ENTRIES }/${ entry.id }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 70, budget_id: budgetId, description: 'Room' },
					{ amount: 30, budget_id: null, description: 'Snacks' },
				],
			},
		} );
		expect( replaced.status(), await replaced.text() ).toBeLessThan( 300 );
		children = await listed();
		expect( children.map( ( child ) => child.amount ).sort() ).toEqual( [
			30, 70,
		] );
		for ( const child of children ) {
			expect( child.bank_origin ).toEqual( entry.bank_origin );
			expect( child.payment_source ).toBeNull();
		}
		expect( await totals() ).toEqual( before );

		const unsplit = await api.delete( `${ ENTRIES }/${ entry.id }/split`, {
			headers,
		} );
		expect( unsplit.status() ).toBeLessThan( 300 );
		expect( await listed() ).toHaveLength( 0 );

		const parent = await get( entry.id );
		expect( parent.bank_origin ).toEqual( entry.bank_origin );
		await expectBankImportRefusal(
			await put( parent, {
				payment_source: 'event_cash',
				event_date_id: eventDateId,
			} )
		);
		expect( await totals() ).toEqual( before );
	} );

	test( 'keeps a legacy classification and allows unrelated edits', async () => {
		const entry = await importEntry( { description: 'Old import' } );
		const seeded = await api.post( LEGACY, {
			headers,
			data: {
				entry_id: entry.id,
				payment_source: 'personal_funds',
				payer_name: 'Anna',
				event_date_id: eventDateId,
			},
		} );
		expect( seeded.ok(), await seeded.text() ).toBeTruthy();
		const legacy = await get( entry.id );
		expect( legacy.payment_source ).toBe( 'personal_funds' );

		// An edit that omits the classification, or sends it back
		// unchanged, saves without revalidating it: the note a classified
		// expense needs is not enforced on the legacy record.
		const omitted = await put( legacy, {
			description: '',
			tag: 'legacy',
		} );
		expect( omitted.status(), await omitted.text() ).toBe( 200 );
		const unchanged = await put( await get( entry.id ), {
			payment_source: 'personal_funds',
			payer_name: 'Anna',
			budget_id: budgetId,
		} );
		expect( unchanged.status(), await unchanged.text() ).toBe( 200 );

		for ( const changes of [
			{ payment_source: null },
			{ payment_source: 'event_cash' },
			{ payment_source: 'personal_funds', payer_name: 'Ben' },
		] ) {
			await expectBankImportRefusal(
				await put( await get( entry.id ), changes )
			);
		}

		const stored = await get( entry.id );
		expect( stored.payment_source ).toBe( 'personal_funds' );
		expect( stored.payer_name ).toBe( 'Anna' );
		expect( stored.tag ).toBe( 'legacy' );
		expect( stored.budget_id ).toBe( budgetId );
		expect( stored.bank_origin ).toEqual( { account: null } );
	} );
} );
