/**
 * Playwright API tests confirming a paid ticket purchase's transaction
 * description uses the event's name rather than its numeric event-date ID
 * (#1462).
 *
 * Covers:
 *   - a single-occurrence paid signup produces a transaction described as
 *     "Ticket for {event title}".
 *   - a multi-instance (recurring) paid signup produces a transaction
 *     described as "Tickets for {event title}", while its per-occurrence
 *     line items stay date/time-based.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('GetTicketsController — transaction description uses event name', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('single paid signup transaction description uses the event name', async () => {
		const eventTitle = `Get-tickets description test ${Date.now()}`;

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: eventTitle, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		const eventPostId = (await postRes.json()).id;

		try {
			const edRes = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title: eventTitle,
						link_type: 'post',
						start_datetime: '2035-07-01 10:00:00',
						end_datetime: '2035-07-01 12:00:00',
					},
				}
			);
			expect(edRes.ok()).toBeTruthy();
			const eventDateId = (await edRes.json()).id;

			const linkRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders, data: { event_id: eventPostId } }
			);
			expect(linkRes.ok()).toBeTruthy();

			const ticketsRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
				{
					headers: adminHeaders,
					data: {
						ticket_types: [
							{
								name: 'Standard',
								capacity: null,
								minimum_activities: 0,
								disable_at: null,
								recurrence_scope: 'single_instance',
								group_ids: [],
							},
						],
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
								price: 15,
							},
						],
						settings: {},
					},
				}
			);
			expect(ticketsRes.ok()).toBeTruthy();
			const ticketTypeId = (await ticketsRes.json()).ticket_types?.[0]
				?.id;
			expect(ticketTypeId).toBeTruthy();

			const signupRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: eventDateId,
						name: 'Description Tester',
						email: `description-test-${Date.now()}@example.test`,
						ticket_type_id: ticketTypeId,
						quantity: 1,
					},
				}
			);
			expect(signupRes.ok()).toBeTruthy();
			const signupBody = await signupRes.json();
			expect(signupBody.transaction_id).toBeTruthy();

			const transactionRes = await api.get(
				`/wp-json/fair-payments-connector/v1/transactions/${signupBody.transaction_id}`,
				{ headers: adminHeaders }
			);
			expect(transactionRes.ok()).toBeTruthy();
			const transaction = await transactionRes.json();
			expect(transaction.description).toBe(`Ticket for ${eventTitle}`);
		} finally {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
	});

	test('multi-instance paid signup transaction description uses the event name, line items stay date/time-based', async () => {
		const eventTitle = `Get-tickets multi description test ${Date.now()}`;

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: eventTitle, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		const eventPostId = (await postRes.json()).id;

		try {
			const edRes = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title: eventTitle,
						link_type: 'post',
						start_datetime: '2035-08-01 10:00:00',
						end_datetime: '2035-08-01 12:00:00',
						rrule: 'FREQ=WEEKLY;COUNT=3',
					},
				}
			);
			expect(edRes.ok()).toBeTruthy();
			const edBody = await edRes.json();
			const masterEventDateId = edBody.id;

			const linkRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders, data: { event_id: eventPostId } }
			);
			expect(linkRes.ok()).toBeTruthy();

			const occurrenceIds = [
				masterEventDateId,
				...edBody.generated_occurrences.map((o) => o.id),
			].sort();
			expect(occurrenceIds.length).toBe(3);

			const ticketsRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/tickets`,
				{
					headers: adminHeaders,
					data: {
						ticket_types: [
							{
								name: 'Multi-session',
								capacity: null,
								minimum_activities: 0,
								disable_at: null,
								recurrence_scope: 'multiple_instances',
								minimum_instances: 1,
								group_ids: [],
							},
						],
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
								price: 10,
							},
						],
						settings: {},
					},
				}
			);
			expect(ticketsRes.ok()).toBeTruthy();
			const ticketTypeId = (await ticketsRes.json()).ticket_types?.[0]
				?.id;
			expect(ticketTypeId).toBeTruthy();

			const signupRes = await api.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: masterEventDateId,
						event_date_ids: occurrenceIds.slice(0, 2),
						name: 'Description Tester',
						email: `description-multi-test-${Date.now()}@example.test`,
						ticket_type_id: ticketTypeId,
					},
				}
			);
			expect(signupRes.ok()).toBeTruthy();
			const signupBody = await signupRes.json();
			expect(signupBody.transaction_id).toBeTruthy();

			const transactionRes = await api.get(
				`/wp-json/fair-payments-connector/v1/transactions/${signupBody.transaction_id}`,
				{ headers: adminHeaders }
			);
			expect(transactionRes.ok()).toBeTruthy();
			const transaction = await transactionRes.json();
			expect(transaction.description).toBe(`Tickets for ${eventTitle}`);
			for (const item of transaction.line_items || []) {
				expect(item.name).not.toContain(eventTitle);
			}
		} finally {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
	});
});
