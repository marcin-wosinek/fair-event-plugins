/**
 * Playwright API tests for event timing consumers (#1819, stage 4).
 *
 * Lists and metadata read the dates and optional times of an event date.
 * A date without an end time stays current (and upcoming) through its end
 * date and is past from the next day; a timed date missing its start time
 * stays upcoming until then too. JSON-LD and Open Graph use a bare date
 * where a time is missing, never an invented midnight.
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

/**
 * A 'Y-m-d' date shifted by whole days.
 *
 * @param {string} date Date.
 * @param {number} days Days to add.
 * @return {string} Shifted date.
 */
const addDays = ( date, days ) => {
	const shifted = new Date( `${ date }T12:00:00Z` );
	shifted.setUTCDate( shifted.getUTCDate() + days );
	return shifted.toISOString().slice( 0, 10 );
};

test.describe( 'Event timing consumers', () => {
	let api;
	let today;
	const eventDateIds = [];
	const postIds = [];
	const pageIds = [];
	const blockIds = [];
	const runId = Date.now();

	const createEventDate = async ( data ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					link_type: 'external',
					external_url: 'https://example.com/timing-consumers',
					...data,
				},
			}
		);
		expect( response.status(), await response.text() ).toBe( 201 );
		const body = await response.json();
		eventDateIds.push( body.id );
		return body;
	};

	/**
	 * Create a published event post linked to a new event date.
	 *
	 * @param {string} title  Post title.
	 * @param {Object} timing Event date fields.
	 * @return {Promise<Object>} The post.
	 */
	const createEventPost = async ( title, timing ) => {
		const postResponse = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postResponse.ok() ).toBeTruthy();
		const post = await postResponse.json();
		postIds.push( post.id );

		const eventDate = await createEventDate( {
			title,
			link_type: 'post',
			external_url: undefined,
			...timing,
		} );
		// The create endpoint doesn't wire event_id through.
		const linkResponse = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDate.id }`,
			{ headers: adminHeaders, data: { event_id: post.id } }
		);
		expect( linkResponse.ok() ).toBeTruthy();

		return post;
	};

	const renderPage = async ( content ) => {
		const response = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: {
				title: `Timing consumers ${ runId }`,
				status: 'publish',
				content,
			},
		} );
		expect( response.ok() ).toBeTruthy();
		const page = await response.json();
		pageIds.push( page.id );

		const html = await api.get( page.link );
		expect( html.ok() ).toBeTruthy();
		return html.text();
	};

	/**
	 * Create a synced pattern for the events list.
	 *
	 * @param {string} content Pattern block markup.
	 * @return {Promise<string>} The displayPattern value.
	 */
	const createPattern = async ( content ) => {
		const response = await api.post( '/wp-json/wp/v2/blocks', {
			headers: adminHeaders,
			data: {
				title: `Timing pattern ${ runId }`,
				status: 'publish',
				content,
			},
		} );
		expect( response.ok() ).toBeTruthy();
		const block = await response.json();
		blockIds.push( block.id );
		return `wp_block:${ block.id }`;
	};

	const eventsList = ( timeFilter, pattern ) =>
		`<!-- wp:fair-events/events-list ${ JSON.stringify( {
			timeFilter,
			...( pattern ? { displayPattern: pattern } : {} ),
		} ) } /-->`;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const settings = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		expect( settings.ok() ).toBeTruthy();
		const { timezone } = await settings.json();
		try {
			today = new Intl.DateTimeFormat( 'en-CA', {
				timeZone: timezone || 'UTC',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			} ).format( new Date() );
		} catch ( e ) {
			today = new Date().toISOString().slice( 0, 10 );
		}
	} );

	test.afterAll( async () => {
		for ( const id of pageIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of blockIds ) {
			await api.delete( `/wp-json/wp/v2/blocks/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of [ ...new Set( eventDateIds ) ] ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'the events list keeps a date without an end time current through its end date', async () => {
		const yesterday = addDays( today, -1 );
		const cases = {
			neitherToday: { start_date: today },
			startOnlyToday: { start_date: today, start_time: '00:00' },
			timedEarlyToday: {
				start_date: today,
				start_time: '00:00',
				end_time: '00:01',
			},
			neitherYesterday: { start_date: yesterday },
			spanningToday: { start_date: yesterday, end_date: today },
		};
		const titles = {};
		for ( const [ name, timing ] of Object.entries( cases ) ) {
			titles[ name ] = `Consumer ${ name } ${ runId }`;
			await createEventDate( { title: titles[ name ], ...timing } );
		}

		// Per-event patterns list standalone dates; Query Loops only posts.
		const perEvent = await createPattern(
			'<!-- wp:paragraph --><p>{{title}}</p><!-- /wp:paragraph -->'
		);

		const expected = {
			upcoming: {
				neitherToday: true,
				startOnlyToday: true,
				timedEarlyToday: false,
				neitherYesterday: false,
			},
			ongoing: {
				neitherToday: true,
				startOnlyToday: true,
				timedEarlyToday: false,
				neitherYesterday: false,
				spanningToday: true,
			},
			past: {
				neitherToday: false,
				startOnlyToday: false,
				timedEarlyToday: true,
				neitherYesterday: true,
				spanningToday: false,
			},
		};

		for ( const [ filter, cases ] of Object.entries( expected ) ) {
			const html = await renderPage( eventsList( filter, perEvent ) );
			for ( const [ name, listed ] of Object.entries( cases ) ) {
				expect(
					html.includes( titles[ name ] ),
					`${ filter }: ${ name }`
				).toBe( listed );
			}
		}
	} );

	test( 'a Query Loop events list follows the same boundaries', async () => {
		const yesterday = addDays( today, -1 );
		const cases = {
			startOnlyToday: { start_date: today, start_time: '00:00' },
			timedEarlyToday: {
				start_date: today,
				start_time: '00:00',
				end_time: '00:01',
			},
			neitherYesterday: { start_date: yesterday },
		};
		const titles = {};
		for ( const [ name, timing ] of Object.entries( cases ) ) {
			titles[ name ] = `Loop ${ name } ${ runId }`;
			await createEventPost( titles[ name ], timing );
		}

		const blockResponse = await api.post( '/wp-json/wp/v2/blocks', {
			headers: adminHeaders,
			data: {
				title: `Timing loop ${ runId }`,
				status: 'publish',
				content:
					'<!-- wp:query {"query":{"postType":"fair_event","perPage":100,"inherit":false}} --><div class="wp-block-query"><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --></div><!-- /wp:query -->',
			},
		} );
		expect( blockResponse.ok() ).toBeTruthy();
		const block = await blockResponse.json();
		blockIds.push( block.id );

		const expected = {
			upcoming: {
				startOnlyToday: true,
				timedEarlyToday: false,
				neitherYesterday: false,
			},
			past: {
				startOnlyToday: false,
				timedEarlyToday: true,
				neitherYesterday: true,
			},
		};

		for ( const [ filter, cases ] of Object.entries( expected ) ) {
			const html = await renderPage(
				eventsList( filter, `wp_block:${ block.id }` )
			);
			for ( const [ name, listed ] of Object.entries( cases ) ) {
				expect(
					html.includes( titles[ name ] ),
					`${ filter }: ${ name }`
				).toBe( listed );
			}
		}
	} );

	test( 'JSON-LD and Open Graph use bare dates where a time is missing', async () => {
		const untimed = await createEventPost( `Untimed ${ runId }`, {
			start_date: '2035-06-01',
			end_date: '2035-06-03',
		} );
		const startOnly = await createEventPost( `Start only ${ runId }`, {
			start_date: '2035-06-05',
			start_time: '18:00',
		} );
		const allDay = await createEventPost( `All day ${ runId }`, {
			start_date: '2035-06-07',
			all_day: true,
		} );

		const page = async ( post ) => {
			const response = await api.get( post.link );
			expect( response.ok() ).toBeTruthy();
			return response.text();
		};

		const untimedHtml = await page( untimed );
		expect( untimedHtml ).toMatch( /"startDate":\s*"2035-06-01"/ );
		expect( untimedHtml ).toMatch( /"endDate":\s*"2035-06-03"/ );
		expect( untimedHtml ).toMatch(
			/<meta property="event:start_time" content="2035-06-01"/
		);
		expect( untimedHtml ).toMatch(
			/<meta property="event:end_time" content="2035-06-03"/
		);
		expect( untimedHtml ).not.toContain( '2035-06-01T00:00:00' );

		const startOnlyHtml = await page( startOnly );
		expect( startOnlyHtml ).toMatch(
			/"startDate":\s*"2035-06-05T18:00:00/
		);
		expect( startOnlyHtml ).not.toContain( '"endDate"' );
		expect( startOnlyHtml ).not.toContain( 'event:end_time' );

		const allDayHtml = await page( allDay );
		expect( allDayHtml ).toMatch( /"startDate":\s*"2035-06-07"/ );
		expect( allDayHtml ).toMatch( /"endDate":\s*"2035-06-07"/ );
	} );
} );
