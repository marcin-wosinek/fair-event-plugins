/**
 * Playwright API tests for filtering entries by a local event date (#2134).
 *
 * GET /fair-finance/v1/financial-entries?event_date_id=N and its totals match
 * entries linked to the event date by ID, plus entries that carry only a URL
 * exactly equal to the event date's display URL. Entries assigned to another
 * event date stay excluded even when their URL matches, other filters still
 * apply, split allocations count once, and a focused entry wins.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
	'base64'
);
const headers = { Authorization: `Basic ${ adminAuth }` };

const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const TOTALS = `${ ENTRIES }/totals`;
const DAY = '2031-02-11';
const OTHER_DAY = '2031-02-12';

test.describe( 'FinancialEntry event filter', () => {
	let api;
	const postIds = [];
	const eventDateIds = [];
	const entryIds = [];
	let budgetId;
	let tag;

	// The selected event date and an unrelated one.
	let eventA;
	let urlA;
	let eventB;
	let urlB;

	// Entries, by role.
	const ids = {};

	const createEventDate = async ( title ) => {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const ensureRes = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers, data: { post_id: postId } }
		);
		expect( ensureRes.ok() ).toBeTruthy();
		const eventDateId = ( await ensureRes.json() ).id;
		eventDateIds.push( eventDateId );

		const getRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers }
		);
		expect( getRes.ok() ).toBeTruthy();
		const displayUrl = ( await getRes.json() ).display_url;
		expect( displayUrl ).toBeTruthy();

		return [ eventDateId, displayUrl ];
	};

	const createEntry = async ( data ) => {
		const res = await api.post( ENTRIES, {
			headers,
			data: { entry_date: DAY, ...data },
		} );
		expect( res.ok() ).toBeTruthy();
		const id = ( await res.json() ).id;
		entryIds.push( id );
		return id;
	};

	const list = async ( query ) => {
		const res = await api.get( `${ ENTRIES }?per_page=100&${ query }`, {
			headers,
		} );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const totals = async ( query ) => {
		const res = await api.get( `${ TOTALS }?${ query }`, { headers } );
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const sortedIds = ( body ) =>
		body.entries.map( ( entry ) => entry.id ).sort( ( a, b ) => a - b );

	const sorted = ( values ) => [ ...values ].sort( ( a, b ) => a - b );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const suffix = `${ Date.now() }-${ Math.floor( Math.random() * 1e6 ) }`;
		tag = `event-filter-${ suffix }`;

		[ eventA, urlA ] = await createEventDate(
			`Event filter A ${ suffix }`
		);
		[ eventB, urlB ] = await createEventDate(
			`Event filter B ${ suffix }`
		);
		expect( urlA ).not.toBe( urlB );

		const budgetRes = await api.post( '/wp-json/fair-finance/v1/budgets', {
			headers,
			data: { name: `Event filter budget ${ suffix }` },
		} );
		expect( budgetRes.ok() ).toBeTruthy();
		budgetId = ( await budgetRes.json() ).id;

		ids.idOnly = await createEntry( {
			amount: 10,
			entry_type: 'cost',
			description: 'Event filter: ID only',
			event_date_id: eventA,
			budget_id: budgetId,
			entry_date: OTHER_DAY,
		} );
		ids.urlOnly = await createEntry( {
			amount: 20,
			entry_type: 'cost',
			description: 'Event filter: URL only',
			event_url: urlA,
			tag,
		} );
		ids.dualIncome = await createEntry( {
			amount: 30,
			entry_type: 'income',
			description: 'Event filter: ID and URL',
			event_date_id: eventA,
			event_url: urlA,
		} );
		ids.conflicting = await createEntry( {
			amount: 40,
			entry_type: 'cost',
			description: 'Event filter: other ID, same URL',
			event_date_id: eventB,
			event_url: urlA,
		} );
		ids.otherUrl = await createEntry( {
			amount: 50,
			entry_type: 'cost',
			description: 'Event filter: other URL',
			event_url: urlB,
		} );
		ids.unrelated = await createEntry( {
			amount: 60,
			entry_type: 'cost',
			description: 'Event filter: no event',
		} );

		ids.splitParent = await createEntry( {
			amount: 100,
			entry_type: 'cost',
			description: 'Event filter: split parent',
		} );
		const split = await api.post(
			`${ ENTRIES }/${ ids.splitParent }/split`,
			{
				headers,
				data: {
					allocations: [
						{
							amount: 70,
							description: 'Event filter: split to A by URL',
							event_url: urlA,
						},
						{
							amount: 30,
							description: 'Event filter: split to B',
							event_date_id: eventB,
						},
					],
				},
			}
		);
		expect( split.status() ).toBe( 201 );
		const children = ( await split.json() ).children;
		ids.splitToA = children.find( ( c ) => Number( c.amount ) === 70 ).id;
		ids.splitToB = children.find( ( c ) => Number( c.amount ) === 30 ).id;
	} );

	test.afterAll( async () => {
		for ( const id of entryIds ) {
			await api.delete( `${ ENTRIES }/${ id }`, { headers } );
		}
		if ( budgetId ) {
			await api.delete(
				`/wp-json/fair-finance/v1/budgets/${ budgetId }`,
				{
					headers,
				}
			);
		}
		for ( const id of eventDateIds ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers,
			} );
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers,
			} );
		}
		await api.dispose();
	} );

	test( 'matches ID-linked and URL-only entries, excluding the rest', async () => {
		const body = await list( `event_date_id=${ eventA }` );
		const expected = sorted( [
			ids.idOnly,
			ids.urlOnly,
			ids.dualIncome,
			ids.splitToA,
		] );
		expect( sortedIds( body ) ).toEqual( expected );
		expect( body.total ).toBe( 4 );
		expect( body.pages ).toBe( 1 );

		// Costs and income both stay visible.
		const types = body.entries.map( ( e ) => e.entry_type );
		expect( types ).toContain( 'cost' );
		expect( types ).toContain( 'income' );

		// The split parent's event fields are cleared, so it is never listed.
		expect( sortedIds( body ) ).not.toContain( ids.splitParent );
	} );

	test( 'counts each matching allocation once in totals', async () => {
		expect( await totals( `event_date_id=${ eventA }` ) ).toEqual( {
			total_cost: 100,
			total_income: 30,
			balance: -70,
		} );

		// Event B: the conflicting entry by ID and its split allocation.
		const bodyB = await list( `event_date_id=${ eventB }` );
		expect( sortedIds( bodyB ) ).toEqual(
			sorted( [ ids.conflicting, ids.otherUrl, ids.splitToB ] )
		);
		expect( await totals( `event_date_id=${ eventB }` ) ).toEqual( {
			total_cost: 120,
			total_income: 0,
			balance: -120,
		} );
	} );

	test( 'paginates the matching entries', async () => {
		const res = await api.get(
			`${ ENTRIES }?event_date_id=${ eventA }&per_page=3&page=2`,
			{ headers }
		);
		const body = await res.json();
		expect( body.total ).toBe( 4 );
		expect( body.pages ).toBe( 2 );
		expect( body.entries ).toHaveLength( 1 );
	} );

	test( 'combines with the other filters', async () => {
		const event = `event_date_id=${ eventA }`;

		const costs = await list( `${ event }&entry_type=cost` );
		expect( sortedIds( costs ) ).toEqual(
			sorted( [ ids.idOnly, ids.urlOnly, ids.splitToA ] )
		);

		const day = `${ event }&date_from=${ DAY }&date_to=${ DAY }`;
		expect( sortedIds( await list( day ) ) ).toEqual(
			sorted( [ ids.urlOnly, ids.dualIncome, ids.splitToA ] )
		);
		expect( await totals( day ) ).toEqual( {
			total_cost: 90,
			total_income: 30,
			balance: -60,
		} );

		const budget = `${ event }&budget_id=${ budgetId }`;
		expect( sortedIds( await list( budget ) ) ).toEqual( [ ids.idOnly ] );
		expect( ( await totals( budget ) ).total_cost ).toBe( 10 );

		const tagged = `${ event }&tag=${ encodeURIComponent( tag ) }`;
		expect( sortedIds( await list( tagged ) ) ).toEqual( [ ids.urlOnly ] );
		expect( ( await totals( tagged ) ).total_cost ).toBe( 20 );

		// None of the entries has a transaction or decision yet.
		const unmatched = await list( `${ event }&unmatched=true` );
		expect( sortedIds( unmatched ) ).toEqual(
			sorted( [ ids.idOnly, ids.urlOnly, ids.dualIncome, ids.splitToA ] )
		);
	} );

	test( 'keeps exact URL filtering for URL-only links', async () => {
		const body = await list( `event_url=${ encodeURIComponent( urlB ) }` );
		expect( sortedIds( body ) ).toEqual( [ ids.otherUrl ] );
		expect(
			await totals( `event_url=${ encodeURIComponent( urlB ) }` )
		).toEqual( { total_cost: 50, total_income: 0, balance: -50 } );
	} );

	test( 'lets a focused entry take precedence over the event filter', async () => {
		const query = `entry_id=${ ids.unrelated }&event_date_id=${ eventA }`;
		expect( sortedIds( await list( query ) ) ).toEqual( [ ids.unrelated ] );
		expect( ( await totals( query ) ).total_cost ).toBe( 60 );
	} );

	test( 'leaves associations and amounts unchanged', async () => {
		const res = await api.get( `${ ENTRIES }/${ ids.urlOnly }`, {
			headers,
		} );
		const entry = await res.json();
		expect( entry.event_url ).toBe( urlA );
		expect( entry.event_date_id ).toBeNull();
		expect( Number( entry.amount ) ).toBe( 20 );
	} );
} );
