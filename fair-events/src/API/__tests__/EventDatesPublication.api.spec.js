/**
 * Playwright API tests for drafting and publishing an event (#1692).
 *
 * Covers POST /fair-events/v1/event-dates/{id}/publication-status:
 * - permissions on the route and on every linked post, and invalid states;
 * - calendar-only, externally linked and post-linked events, including every
 *   linked post following the event;
 * - a series changing as a whole, from the series or from one of its dates,
 *   and dates added later following it;
 * - a post linked to another event blocking the action;
 * - a failed post update leaving the event and its posts unchanged;
 * - cancellation, event details, recurrence and signups staying intact;
 * - public visibility: the JSON feed, the iCal feed and the standalone
 *   `?fair_event_date=` page, while admin endpoints keep the event.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const USER_PASSWORD = 'Test-password-1692!';

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

// A date range no other spec uses, so feed assertions see only these events.
const FEED_RANGE = 'start_date=2037-03-01&end_date=2037-03-31';

test.describe( 'EventDatesController — draft and publish an event', () => {
	let api;
	const eventDateIds = [];
	const postIds = [];
	const userIds = [];
	const signupIds = [];
	const run = Date.now();

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await api.put( '/wp-json/fair-e2e/v1/polylang-groups', {
			headers: adminHeaders,
			data: { groups: {}, enabled_post_types: [] },
		} );
	} );

	test.afterAll( async () => {
		await api.put( '/wp-json/fair-e2e/v1/post-update-failure', {
			headers: adminHeaders,
			data: { post_id: 0 },
		} );
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
				{ headers: adminHeaders }
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
		for ( const userId of userIds ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ userId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	const createUser = async ( role ) => {
		const login = `publication-${ role }-${ run }-${ userIds.length }`;
		const response = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: USER_PASSWORD,
				roles: [ role ],
			},
		} );
		expect( response.ok(), await response.text() ).toBeTruthy();
		const id = ( await response.json() ).id;
		userIds.push( id );
		return { id, headers: basicAuth( login, USER_PASSWORD ) };
	};

	const createEvent = async ( label, data = {} ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Publication ${ label } ${ run }`,
					start_datetime: '2037-03-10 10:00:00',
					end_datetime: '2037-03-10 12:00:00',
					...data,
				},
			}
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		const eventDate = await response.json();
		eventDateIds.push( eventDate.id );
		return eventDate;
	};

	const createPost = async ( label, data = {} ) => {
		const response = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Publication page ${ label } ${ run }`,
				status: 'publish',
				...data,
			},
		} );
		expect( response.ok(), await response.text() ).toBeTruthy();
		const postId = ( await response.json() ).id;
		postIds.push( postId );

		// Publishing a fair_event post creates its own event date; these
		// specs link the post to an event of their choosing instead.
		const own = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${ postId }`,
			{ headers: adminHeaders }
		);
		for ( const eventDate of await own.json() ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDate.id }`,
				{ headers: adminHeaders }
			);
		}
		return postId;
	};

	const linkPost = async ( eventDateId, postId ) => {
		const response = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return response.json();
	};

	const setPublication = ( eventDateId, status, headers = adminHeaders ) =>
		api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/publication-status`,
			{ headers, data: { publication_status: status } }
		);

	const getEvent = async ( eventDateId ) => {
		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return response.json();
	};

	const getPostStatus = async ( postId ) => {
		const response = await api.get(
			`/wp-json/wp/v2/fair_event/${ postId }?context=edit`,
			{ headers: adminHeaders }
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return ( await response.json() ).status;
	};

	// Event date IDs in the public JSON feed, without authentication.
	const publicFeedIds = async () => {
		const response = await api.get(
			`/wp-json/fair-events/v1/events?${ FEED_RANGE }&per_page=500`
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return ( await response.json() ).events.map(
			( event ) => event.event_date_id
		);
	};

	const publicIcal = async () => {
		const response = await api.get(
			`/wp-json/fair-events/v1/calendar.ics?${ FEED_RANGE }`
		);
		expect( response.ok(), await response.text() ).toBeTruthy();
		return response.text();
	};

	test( 'requires a logged-in user who can edit events', async () => {
		const eventDate = await createEvent( 'permissions' );
		const subscriber = await createUser( 'subscriber' );

		const anonymous = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDate.id }/publication-status`,
			{ data: { publication_status: 'draft' } }
		);
		expect( anonymous.status() ).toBe( 401 );

		const forbidden = await setPublication(
			eventDate.id,
			'draft',
			subscriber.headers
		);
		expect( forbidden.status() ).toBe( 403 );

		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'publish'
		);
	} );

	test( 'rejects an unknown state, a missing state and an unknown event', async () => {
		const eventDate = await createEvent( 'validation' );

		const invalid = await setPublication( eventDate.id, 'cancelled' );
		expect( invalid.status() ).toBe( 400 );

		const missing = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDate.id }/publication-status`,
			{ headers: adminHeaders, data: {} }
		);
		expect( missing.status() ).toBe( 400 );

		const unknown = await setPublication( 999999999, 'draft' );
		expect( unknown.status() ).toBe( 404 );

		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'publish'
		);
	} );

	test( 'a calendar-only event leaves and rejoins every public surface, and stays editable', async () => {
		const eventDate = await createEvent( 'calendar-only' );
		expect( eventDate.publication_status ).toBe( 'publish' );

		const standaloneUrl = `/?fair_event_date=${ eventDate.id }`;
		expect( await publicFeedIds() ).toContain( eventDate.id );
		expect( await publicIcal() ).toContain( eventDate.title );
		expect( ( await api.get( standaloneUrl ) ).status() ).toBe( 200 );

		const drafted = await setPublication( eventDate.id, 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();
		expect( ( await drafted.json() ).publication_status ).toBe( 'draft' );

		expect( await publicFeedIds() ).not.toContain( eventDate.id );
		expect( await publicIcal() ).not.toContain( eventDate.title );
		expect( ( await api.get( standaloneUrl ) ).status() ).toBe( 404 );

		// Admin endpoints still reach it: the saved state, the admin
		// calendar's feed, the All Events list, and edits.
		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'draft'
		);
		const adminFeed = await api.get(
			`/wp-json/fair-events/v1/events?${ FEED_RANGE }&per_page=500&context=edit`,
			{ headers: adminHeaders }
		);
		expect(
			( await adminFeed.json() ).events.map(
				( event ) => event.event_date_id
			)
		).toContain( eventDate.id );
		const allEvents = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${ encodeURIComponent(
				eventDate.title
			) }`,
			{ headers: adminHeaders }
		);
		expect( ( await allEvents.json() )[ 0 ] ).toMatchObject( {
			id: eventDate.id,
			publication_status: 'draft',
		} );
		// The edit context is for editors only: a visitor asking for it
		// still gets the public feed.
		const anonymousEdit = await api.get(
			`/wp-json/fair-events/v1/events?${ FEED_RANGE }&per_page=500&context=edit`
		);
		expect(
			( await anonymousEdit.json() ).events.map(
				( event ) => event.event_date_id
			)
		).not.toContain( eventDate.id );

		const edited = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDate.id }`,
			{
				headers: adminHeaders,
				data: { address: 'Draft Street 1' },
			}
		);
		expect( edited.ok(), await edited.text() ).toBeTruthy();
		expect( await edited.json() ).toMatchObject( {
			address: 'Draft Street 1',
			publication_status: 'draft',
		} );

		const published = await setPublication( eventDate.id, 'publish' );
		expect( ( await published.json() ).publication_status ).toBe(
			'publish'
		);
		expect( await publicFeedIds() ).toContain( eventDate.id );
		expect( await publicIcal() ).toContain( eventDate.title );
		expect( ( await api.get( standaloneUrl ) ).status() ).toBe( 200 );
	} );

	test( 'an externally linked event is drafted without touching its external page', async () => {
		const eventDate = await createEvent( 'external', {
			link_type: 'external',
			external_url: 'https://example.com/partner-event-1692',
		} );

		const drafted = await setPublication( eventDate.id, 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();
		expect( await drafted.json() ).toMatchObject( {
			publication_status: 'draft',
			link_type: 'external',
			external_url: 'https://example.com/partner-event-1692',
			linked_posts: [],
		} );
		expect( await publicFeedIds() ).not.toContain( eventDate.id );

		const published = await setPublication( eventDate.id, 'publish' );
		expect( await published.json() ).toMatchObject( {
			publication_status: 'publish',
			link_type: 'external',
			external_url: 'https://example.com/partner-event-1692',
		} );
		expect( await publicFeedIds() ).toContain( eventDate.id );
	} );

	test( 'every linked post follows the event, and publishing publishes a post that was a draft', async () => {
		const eventDate = await createEvent( 'linked-posts' );
		const firstPostId = await createPost( 'first' );
		const secondPostId = await createPost( 'second' );
		await linkPost( eventDate.id, firstPostId );
		await linkPost( eventDate.id, secondPostId );

		const drafted = await setPublication( eventDate.id, 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();
		const draftedBody = await drafted.json();
		expect( draftedBody.publication_status ).toBe( 'draft' );
		expect(
			draftedBody.linked_posts.map( ( post ) => post.status )
		).toEqual( [ 'draft', 'draft' ] );
		expect( await getPostStatus( firstPostId ) ).toBe( 'draft' );
		expect( await getPostStatus( secondPostId ) ).toBe( 'draft' );
		expect( await publicFeedIds() ).not.toContain( eventDate.id );

		// The links themselves are untouched.
		expect( draftedBody.event_id ).toBe( firstPostId );
		expect(
			draftedBody.linked_posts.map( ( post ) => post.id ).sort()
		).toEqual( [ firstPostId, secondPostId ].sort() );

		const published = await setPublication( eventDate.id, 'publish' );
		expect( published.ok(), await published.text() ).toBeTruthy();
		expect( await getPostStatus( firstPostId ) ).toBe( 'publish' );
		expect( await getPostStatus( secondPostId ) ).toBe( 'publish' );
		expect( await publicFeedIds() ).toContain( eventDate.id );

		// A post drafted on its own is published with the event, and the
		// action is safe to repeat on an already published event.
		const redraft = await api.post(
			`/wp-json/wp/v2/fair_event/${ secondPostId }`,
			{ headers: adminHeaders, data: { status: 'draft' } }
		);
		expect( redraft.ok(), await redraft.text() ).toBeTruthy();

		const republished = await setPublication( eventDate.id, 'publish' );
		expect( republished.ok(), await republished.text() ).toBeTruthy();
		expect( await getPostStatus( secondPostId ) ).toBe( 'publish' );
	} );

	test( 'a series changes as a whole, from one of its dates, and later dates follow it', async () => {
		const master = await createEvent( 'series' );
		const withSeries = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ master.id }`,
			{ headers: adminHeaders, data: { rrule: 'FREQ=WEEKLY;COUNT=3' } }
		);
		expect( withSeries.ok(), await withSeries.text() ).toBeTruthy();
		const occurrenceIds = (
			await withSeries.json()
		).generated_occurrences.map( ( occurrence ) => occurrence.id );
		expect( occurrenceIds ).toHaveLength( 2 );
		const seriesIds = [ master.id, ...occurrenceIds ];

		expect( await publicFeedIds() ).toEqual(
			expect.arrayContaining( seriesIds )
		);

		// Opened from a generated date, the action applies to its series.
		const drafted = await setPublication( occurrenceIds[ 0 ], 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();
		expect( await drafted.json() ).toMatchObject( {
			id: occurrenceIds[ 0 ],
			publication_status: 'draft',
		} );
		for ( const id of seriesIds ) {
			expect( ( await getEvent( id ) ).publication_status ).toBe(
				'draft'
			);
		}
		let feedIds = await publicFeedIds();
		for ( const id of seriesIds ) {
			expect( feedIds ).not.toContain( id );
		}

		// A date added while the series is a draft is a draft too.
		const extended = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ master.id }`,
			{ headers: adminHeaders, data: { rrule: 'FREQ=WEEKLY;COUNT=4' } }
		);
		expect( extended.ok(), await extended.text() ).toBeTruthy();
		const extendedBody = await extended.json();
		expect( extendedBody.publication_status ).toBe( 'draft' );
		const addedId = extendedBody.generated_occurrences
			.map( ( occurrence ) => occurrence.id )
			.find( ( id ) => ! occurrenceIds.includes( id ) );
		expect( addedId ).toBeTruthy();
		expect( ( await getEvent( addedId ) ).publication_status ).toBe(
			'draft'
		);
		expect( await publicFeedIds() ).not.toContain( addedId );

		const published = await setPublication( master.id, 'publish' );
		expect( published.ok(), await published.text() ).toBeTruthy();
		feedIds = await publicFeedIds();
		for ( const id of [ ...seriesIds, addedId ] ) {
			expect( feedIds ).toContain( id );
		}
	} );

	test( 'a post linked to another event blocks the action and changes nothing', async () => {
		const eventDate = await createEvent( 'shared-a' );
		const otherEvent = await createEvent( 'shared-b' );
		const ownPostId = await createPost( 'own' );
		const sharedPostId = await createPost( 'shared' );
		await linkPost( eventDate.id, ownPostId );
		await linkPost( eventDate.id, sharedPostId );

		const fixture = await api.post(
			'/wp-json/fair-e2e/v1/event-date-post-links',
			{
				headers: adminHeaders,
				data: { event_date_id: otherEvent.id, post_id: sharedPostId },
			}
		);
		expect( fixture.ok(), await fixture.text() ).toBeTruthy();

		const blocked = await setPublication( eventDate.id, 'draft' );
		expect( blocked.status() ).toBe( 409 );
		const error = await blocked.json();
		expect( error.code ).toBe( 'rest_post_linked_to_other_event' );
		expect( error.message ).toContain( `Publication page shared ${ run }` );
		expect( error.message ).toContain( otherEvent.title );
		expect( error.data ).toMatchObject( {
			post_id: sharedPostId,
			event_date_ids: [ otherEvent.id ],
		} );

		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'publish'
		);
		expect( await getPostStatus( ownPostId ) ).toBe( 'publish' );
		expect( await getPostStatus( sharedPostId ) ).toBe( 'publish' );
		expect( await publicFeedIds() ).toContain( eventDate.id );
	} );

	test( 'refuses when the user may not change a linked post, and changes nothing', async () => {
		const author = await createUser( 'author' );
		const contributor = await createUser( 'contributor' );

		// An author can edit events, but not a page someone else wrote.
		const eventDate = await createEvent( 'capability-draft' );
		const adminPostId = await createPost( 'admin-owned' );
		await linkPost( eventDate.id, adminPostId );

		const refusedDraft = await setPublication(
			eventDate.id,
			'draft',
			author.headers
		);
		expect( refusedDraft.status() ).toBe( 403 );
		expect( ( await refusedDraft.json() ).code ).toBe(
			'rest_cannot_change_linked_post'
		);
		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'publish'
		);
		expect( await getPostStatus( adminPostId ) ).toBe( 'publish' );

		// A contributor can edit their own draft, but not publish it.
		const draftEvent = await createEvent( 'capability-publish' );
		const contributorPostId = await createPost( 'contributor-owned', {
			status: 'draft',
			author: contributor.id,
		} );
		await linkPost( draftEvent.id, contributorPostId );
		const drafted = await setPublication( draftEvent.id, 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();

		const refusedPublish = await setPublication(
			draftEvent.id,
			'publish',
			contributor.headers
		);
		expect( refusedPublish.status() ).toBe( 403 );
		expect( ( await refusedPublish.json() ).code ).toBe(
			'rest_cannot_change_linked_post'
		);
		expect( ( await getEvent( draftEvent.id ) ).publication_status ).toBe(
			'draft'
		);
		expect( await getPostStatus( contributorPostId ) ).toBe( 'draft' );

		// With nothing linked, editing the event is all it takes.
		const calendarOnly = await createEvent( 'capability-calendar-only' );
		const allowed = await setPublication(
			calendarOnly.id,
			'draft',
			contributor.headers
		);
		expect( allowed.ok(), await allowed.text() ).toBeTruthy();
	} );

	test( 'a post that cannot be updated leaves the event and the other posts as they were', async () => {
		const eventDate = await createEvent( 'failure' );
		const firstPostId = await createPost( 'updated-first' );
		const failingPostId = await createPost( 'failing' );
		expect( failingPostId ).toBeGreaterThan( firstPostId );
		await linkPost( eventDate.id, firstPostId );
		await linkPost( eventDate.id, failingPostId );

		await api.put( '/wp-json/fair-e2e/v1/post-update-failure', {
			headers: adminHeaders,
			data: { post_id: failingPostId },
		} );

		const failed = await setPublication( eventDate.id, 'draft' );

		await api.put( '/wp-json/fair-e2e/v1/post-update-failure', {
			headers: adminHeaders,
			data: { post_id: 0 },
		} );

		expect( failed.status() ).toBe( 500 );
		const error = await failed.json();
		expect( error.code ).toBe( 'rest_publication_status_failed' );
		expect( error.data.post_id ).toBe( failingPostId );

		// The first post had already been drafted; it is published again.
		expect( await getPostStatus( firstPostId ) ).toBe( 'publish' );
		expect( await getPostStatus( failingPostId ) ).toBe( 'publish' );
		expect( ( await getEvent( eventDate.id ) ).publication_status ).toBe(
			'publish'
		);
		expect( await publicFeedIds() ).toContain( eventDate.id );
	} );

	test( 'keeps cancellation, event details, recurrence and signups', async () => {
		const master = await createEvent( 'preserved', {
			start_datetime: '2037-03-03 18:00:00',
			end_datetime: '2037-03-03 20:00:00',
		} );
		const withSeries = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ master.id }`,
			{
				headers: adminHeaders,
				data: {
					rrule: 'FREQ=WEEKLY;COUNT=3',
					address: 'Preserved Street 7',
				},
			}
		);
		expect( withSeries.ok(), await withSeries.text() ).toBeTruthy();

		const cancelled = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2037-03-10' } }
		);
		expect( cancelled.ok(), await cancelled.text() ).toBeTruthy();

		const tickets = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General Admission',
							capacity: null,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: 'Always available',
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
					],
					settings: {},
				},
			}
		);
		expect( tickets.ok(), await tickets.text() ).toBeTruthy();
		const ticketTypeId = ( await tickets.json() ).ticket_types[ 0 ].id;

		const signup = await api.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: master.id,
				name: 'Publication Tester',
				email: `publication-signup-${ run }@example.test`,
				ticket_type_id: ticketTypeId,
				quantity: 1,
			},
		} );
		expect( signup.ok(), await signup.text() ).toBeTruthy();

		const listSignups = async () => {
			const response = await api.get(
				`/wp-json/fair-events/v1/get-tickets?event_date=${ master.id }`,
				{ headers: adminHeaders }
			);
			expect( response.ok(), await response.text() ).toBeTruthy();
			const body = await response.json();
			return ( body.items || body ).map( ( row ) => ( {
				id: row.id,
				email: row.email,
				status: row.status,
			} ) );
		};
		const signupsBefore = await listSignups();
		expect( signupsBefore ).toHaveLength( 1 );
		signupIds.push( signupsBefore[ 0 ].id );

		const pickPreserved = ( eventDate ) => ( {
			title: eventDate.title,
			start_datetime: eventDate.start_datetime,
			end_datetime: eventDate.end_datetime,
			address: eventDate.address,
			rrule: eventDate.rrule,
			recurrence_mode: eventDate.recurrence_mode,
			status: eventDate.status,
			cancelled_dates: eventDate.cancelled_dates,
			generated_occurrences: eventDate.generated_occurrences,
			categories: eventDate.categories,
		} );
		const before = pickPreserved( await getEvent( master.id ) );
		expect( before.status ).toBe( 'active' );
		expect( before.cancelled_dates ).toEqual( [ '2037-03-10' ] );

		const drafted = await setPublication( master.id, 'draft' );
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();
		expect( pickPreserved( await drafted.json() ) ).toEqual( before );
		expect( await listSignups() ).toEqual( signupsBefore );

		// Cancelling and restoring a date while drafted changes only that.
		const restored = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2037-03-10' } }
		);
		expect( await restored.json() ).toMatchObject( {
			publication_status: 'draft',
			cancelled_dates: [],
		} );
		const recancelled = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2037-03-10' } }
		);
		expect( await recancelled.json() ).toMatchObject( {
			publication_status: 'draft',
			cancelled_dates: [ '2037-03-10' ],
		} );

		const published = await setPublication( master.id, 'publish' );
		expect( published.ok(), await published.text() ).toBeTruthy();
		expect( pickPreserved( await published.json() ) ).toEqual( before );
		expect( await listSignups() ).toEqual( signupsBefore );

		// The cancelled date stays out of the feed once published again.
		const cancelledId = before.generated_occurrences.find(
			( occurrence ) => occurrence.status === 'cancelled'
		).id;
		const feedIds = await publicFeedIds();
		expect( feedIds ).toContain( master.id );
		expect( feedIds ).not.toContain( cancelledId );
	} );
} );
