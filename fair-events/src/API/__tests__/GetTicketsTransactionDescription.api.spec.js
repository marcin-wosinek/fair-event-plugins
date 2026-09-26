/**
 * Playwright API tests confirming a paid ticket purchase's transaction
 * describes and links the purchased event (#1462, #1467).
 *
 * Covers:
 *   - a single-occurrence paid signup produces a transaction described as
 *     "Ticket for {event title}" and linked to the event post.
 *   - a multi-instance (recurring) paid signup produces a transaction
 *     described as "Tickets for {event title}", linked to the series' own
 *     event post, while its per-occurrence line items stay date/time-based.
 *   - a signup with a paid optional activity links the event post too.
 *
 * retry-payment is covered by e2e/user-flows/get-tickets-return-and-retry,
 * which can drive the Mollie double into a failed payment.
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

const SINGLE_TICKET_TYPE = {
	name: 'Standard',
	capacity: null,
	minimum_activities: 0,
	disable_at: null,
	recurrence_scope: 'single_instance',
	group_ids: [],
};

test.describe( 'GetTicketsController — transaction describes and links the event', () => {
	let api;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		await api.dispose();
	} );

	async function isExperimentalActive() {
		const res = await api.get( '/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		} );
		if ( ! res.ok() ) {
			return false;
		}
		return ( await res.json() ).some(
			( p ) =>
				p.plugin?.includes( 'fair-events-experimental' ) &&
				p.status === 'active'
		);
	}

	async function createEventPost( title ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		return ( await postRes.json() ).id;
	}

	async function deleteEventPost( postId ) {
		await api.delete( `/wp-json/wp/v2/fair_event/${ postId }?force=true`, {
			headers: adminHeaders,
		} );
	}

	async function createLinkedEventDate( title, eventPostId, data ) {
		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: { title, link_type: 'post', ...data },
		} );
		expect( edRes.ok() ).toBeTruthy();
		const edBody = await edRes.json();

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		return edBody;
	}

	async function putTickets( eventDateId, ticketType, price, extra = {} ) {
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [ ticketType ],
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
							price,
						},
					],
					settings: {},
					...extra,
				},
			}
		);
		expect( ticketsRes.ok() ).toBeTruthy();
		const body = await ticketsRes.json();
		expect( body.ticket_types?.[ 0 ]?.id ).toBeTruthy();
		return body;
	}

	async function getTransaction( transactionId ) {
		const transactionRes = await api.get(
			`/wp-json/fair-payments-connector/v1/transactions/${ transactionId }`,
			{ headers: adminHeaders }
		);
		expect( transactionRes.ok() ).toBeTruthy();
		return transactionRes.json();
	}

	test( 'single paid signup transaction is described by and linked to the event', async () => {
		const eventTitle = `Get-tickets description test ${ Date.now() }`;
		const eventPostId = await createEventPost( eventTitle );

		try {
			const eventDate = await createLinkedEventDate(
				eventTitle,
				eventPostId,
				{
					start_datetime: '2035-07-01 10:00:00',
					end_datetime: '2035-07-01 12:00:00',
				}
			);
			const tickets = await putTickets(
				eventDate.id,
				SINGLE_TICKET_TYPE,
				15
			);

			const signupRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDate.id,
						name: 'Description Tester',
						email: `description-test-${ Date.now() }@example.test`,
						ticket_type_id: tickets.ticket_types[ 0 ].id,
						quantity: 1,
					},
				}
			);
			expect( signupRes.ok() ).toBeTruthy();
			const signupBody = await signupRes.json();
			expect( signupBody.transaction_id ).toBeTruthy();

			const transaction = await getTransaction(
				signupBody.transaction_id
			);
			expect( transaction.description ).toBe(
				`Ticket for ${ eventTitle }`
			);
			expect( transaction.post_id ).toBe( eventPostId );
			expect( transaction.post_title ).toBe( eventTitle );
		} finally {
			await deleteEventPost( eventPostId );
		}
	} );

	test( 'multi-instance paid signup transaction is described by and linked to the series event, line items stay date/time-based', async () => {
		const eventTitle = `Get-tickets multi description test ${ Date.now() }`;
		const eventPostId = await createEventPost( eventTitle );

		try {
			const edBody = await createLinkedEventDate(
				eventTitle,
				eventPostId,
				{
					start_datetime: '2035-08-01 10:00:00',
					end_datetime: '2035-08-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				}
			);
			const masterEventDateId = edBody.id;

			const occurrenceIds = [
				masterEventDateId,
				...edBody.generated_occurrences.map( ( o ) => o.id ),
			].sort();
			expect( occurrenceIds.length ).toBe( 3 );

			const tickets = await putTickets(
				masterEventDateId,
				{
					name: 'Multi-session',
					capacity: null,
					minimum_activities: 0,
					disable_at: null,
					recurrence_scope: 'multiple_instances',
					minimum_instances: 1,
					group_ids: [],
				},
				10
			);

			// Buy from a generated occurrence's page, not the master's: the
			// transaction must still link to the series' own event post.
			const generatedIds = occurrenceIds.filter(
				( id ) => id !== masterEventDateId
			);
			const signupRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: generatedIds[ 0 ],
						event_date_ids: generatedIds,
						name: 'Description Tester',
						email: `description-multi-test-${ Date.now() }@example.test`,
						ticket_type_id: tickets.ticket_types[ 0 ].id,
					},
				}
			);
			expect( signupRes.ok() ).toBeTruthy();
			const signupBody = await signupRes.json();
			expect( signupBody.transaction_id ).toBeTruthy();

			const transaction = await getTransaction(
				signupBody.transaction_id
			);
			expect( transaction.description ).toBe(
				`Tickets for ${ eventTitle }`
			);
			expect( transaction.post_id ).toBe( eventPostId );
			expect( transaction.post_title ).toBe( eventTitle );
			for ( const item of transaction.line_items || [] ) {
				expect( item.name ).not.toContain( eventTitle );
			}
		} finally {
			await deleteEventPost( eventPostId );
		}
	} );

	test( 'paid signup with an optional activity links the event', async () => {
		test.skip(
			! ( await isExperimentalActive() ),
			'Optional activities require fair-events-experimental.'
		);

		const eventTitle = `Get-tickets activity link test ${ Date.now() }`;
		const eventPostId = await createEventPost( eventTitle );

		try {
			const eventDate = await createLinkedEventDate(
				eventTitle,
				eventPostId,
				{
					start_datetime: '2035-09-01 10:00:00',
					end_datetime: '2035-09-01 12:00:00',
				}
			);
			const tickets = await putTickets(
				eventDate.id,
				SINGLE_TICKET_TYPE,
				15,
				{
					options: [ { name: 'Workshop', price: 5, capacity: null } ],
				}
			);
			const optionId = tickets.options?.find(
				( o ) => o.name === 'Workshop'
			)?.id;
			expect( optionId ).toBeTruthy();

			const signupRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDate.id,
						name: 'Activity Tester',
						email: `activity-link-test-${ Date.now() }@example.test`,
						ticket_type_id: tickets.ticket_types[ 0 ].id,
						quantity: 1,
						ticket_option_ids: [ optionId ],
					},
				}
			);
			expect( signupRes.ok() ).toBeTruthy();
			const signupBody = await signupRes.json();
			expect( signupBody.transaction_id ).toBeTruthy();

			const transaction = await getTransaction(
				signupBody.transaction_id
			);
			expect(
				( transaction.line_items || [] ).some(
					( item ) => item.name === 'Workshop'
				)
			).toBeTruthy();
			expect( transaction.post_id ).toBe( eventPostId );
			expect( transaction.post_title ).toBe( eventTitle );
		} finally {
			await deleteEventPost( eventPostId );
		}
	} );
} );
