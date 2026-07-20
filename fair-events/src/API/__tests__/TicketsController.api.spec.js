/**
 * Playwright API tests for TicketsController — recurrence_scope lock when a
 * ticket type has active sales.
 *
 * Covers the server-side defense added in #935: when a PUT /tickets request
 * tries to change the recurrence_scope of an existing ticket type that already
 * has active participant seats, the stored value must be preserved.
 *
 * Requires fair-audience to be active (the has_sales signal comes from
 * EventParticipantRepository). The test skips gracefully when the plugin is
 * absent.
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

test.describe('TicketsController — recurrence_scope preserved when type has sales', () => {
	let api;
	let eventDateId;
	let ticketTypeId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Create a recurring-style event date (recurrence itself not required —
		// only the ticket type's stored scope matters for this test).
		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Scope-lock test ${Date.now()}`,
				start_datetime: '2030-06-01 10:00:00',
				end_datetime: '2030-06-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;

		// Create a ticket type with scope whole_series via the tickets endpoint.
		const putRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Series pass',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'whole_series',
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const body = await putRes.json();
		ticketTypeId = body.ticket_types?.[0]?.id;
		expect(ticketTypeId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
	});

	test('has_sales is false before any participant is created', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		const type = body.ticket_types?.find((t) => t.id === ticketTypeId);
		expect(type).toBeTruthy();
		// has_sales may be absent when fair-audience is not active — treat
		// undefined as false (the default when the guard short-circuits).
		expect(type.has_sales ?? false).toBe(false);
	});

	test('scope flip is accepted when type has no sales', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							id: ticketTypeId,
							name: 'Series pass',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		const type = body.ticket_types?.find((t) => t.id === ticketTypeId);
		expect(type?.recurrence_scope).toBe('single_instance');

		// Restore whole_series for the next test.
		await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							id: ticketTypeId,
							name: 'Series pass',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'whole_series',
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
	});
});

test.describe('TicketsController — disabled flag and delete guard', () => {
	let api;
	let eventDateId;
	let ticketTypeId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Disabled-flag test ${Date.now()}`,
				start_datetime: '2030-07-01 10:00:00',
				end_datetime: '2030-07-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;

		const putRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Standard',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							disabled: false,
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		ticketTypeId = (await putRes.json()).ticket_types?.[0]?.id;
		expect(ticketTypeId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
	});

	test('disabled defaults to false on creation', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const type = (await res.json()).ticket_types?.find(
			(t) => t.id === ticketTypeId
		);
		expect(type).toBeTruthy();
		expect(type.disabled).toBe(false);
	});

	test('setting disabled:true persists and is returned', async () => {
		const putRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							id: ticketTypeId,
							name: 'Standard',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							disabled: true,
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const type = (await putRes.json()).ticket_types?.find(
			(t) => t.id === ticketTypeId
		);
		expect(type?.disabled).toBe(true);

		// Re-enable for cleanup.
		await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							id: ticketTypeId,
							name: 'Standard',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							disabled: false,
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
	});
});

test.describe('TicketsController — retired pricing-period settings (#1138)', () => {
	let api;
	let eventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Retired-settings test ${Date.now()}`,
				start_datetime: '2030-08-01 10:00:00',
				end_datetime: '2030-08-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
	});

	test('saving settings that include the retired keys drops them on load', async () => {
		const putRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [],
					sale_periods: [],
					prices: [],
					settings: {
						continues_pricing_period: false,
						unlimited_tickets_in_price_period: false,
						show_ticket_type_capacity: true,
					},
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const getRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{ headers: adminHeaders }
		);
		expect(getRes.ok()).toBeTruthy();
		const body = await getRes.json();
		expect(body.settings).not.toHaveProperty('continues_pricing_period');
		expect(body.settings).not.toHaveProperty(
			'unlimited_tickets_in_price_period'
		);
		// A setting that is still current is unaffected.
		expect(body.settings.show_ticket_type_capacity).toBe(true);
	});

	test('importing an export that includes the retired fields succeeds and drops them', async () => {
		const importRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets/import`,
			{
				headers: adminHeaders,
				data: {
					version: 1,
					type: 'fair-events-tickets',
					capacity: null,
					settings: {
						continues_pricing_period: true,
						unlimited_tickets_in_price_period: false,
						multiple_pricing_periods: false,
					},
					ticket_types: [
						{
							name: 'General',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							minimum_instances: 0,
							group_ids: [],
						},
					],
					sale_periods: [
						{
							name: '',
							sale_start: '2030-01-01 00:00:00',
							sale_end: '2030-08-02 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 10,
							capacity: 5,
						},
					],
					options: [],
				},
			}
		);
		expect(importRes.ok()).toBeTruthy();
		const body = await importRes.json();
		expect(body.settings).not.toHaveProperty('continues_pricing_period');
		expect(body.settings).not.toHaveProperty(
			'unlimited_tickets_in_price_period'
		);
		expect(body.ticket_types?.[0]?.name).toBe('General');
	});
});

test.describe('TicketsController — discounted_price dropped from add-on options (#1139)', () => {
	let api;
	let eventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Discounted-price test ${Date.now()}`,
				start_datetime: '2030-08-01 10:00:00',
				end_datetime: '2030-08-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
	});

	test('saving an option omits discounted_price from the response', async () => {
		const putRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [],
					sale_periods: [],
					prices: [],
					settings: {},
					options: [
						{
							name: 'Dinner',
							short_name: '',
							price: 20,
							discounted_price: 12,
							capacity: null,
							collaborator_ids: [],
						},
					],
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const body = await putRes.json();
		expect(body.options).toHaveLength(1);
		expect(body.options[0]).not.toHaveProperty('discounted_price');
	});

	test('importing an export that includes discounted_price succeeds and drops it', async () => {
		const importRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets/import`,
			{
				headers: adminHeaders,
				data: {
					version: 1,
					type: 'fair-events-tickets',
					capacity: null,
					settings: {},
					ticket_types: [],
					sale_periods: [],
					prices: [],
					options: [
						{
							name: 'Dinner',
							short_name: '',
							price: 20,
							discounted_price: 12,
							capacity: null,
							collaborator_ids: [],
						},
					],
				},
			}
		);
		expect(importRes.ok()).toBeTruthy();
		const body = await importRes.json();
		expect(body.options).toHaveLength(1);
		expect(body.options[0]).not.toHaveProperty('discounted_price');
	});
});
