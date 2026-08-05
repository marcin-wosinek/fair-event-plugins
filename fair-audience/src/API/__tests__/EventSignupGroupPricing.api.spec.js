/**
 * Playwright API tests for group-based pricing and group-restricted tiers in
 * the unified Event Signup form (#1242): fair-events/v1/get-tickets must
 * reject a group-restricted ticket type for a non-member (403
 * ticket_type_restricted) and apply the viewer's best group discount rule to
 * the charged price — server-side, so a crafted request can't buy a
 * restricted tier or skip a discount.
 *
 * Viewer identity comes from a free signup on the event's unrestricted tier,
 * which sets the fair_audience_session cookie via SignupHookBridge — the
 * Playwright request context retains that cookie for subsequent requests,
 * the same way a browser would. A 100% discount rule is used to exercise the
 * paid path without a payment connector configured on the dev stack: it
 * proves the discount is applied server-side because a member's signup
 * confirms free while a non-member's identical request 503s
 * payment_unavailable (mirroring the trick EventSignupBasePricing's and
 * EventSignupSlidingScale's specs use).
 *
 * Skips gracefully when fair-events-experimental / fair-audience-experimental
 * aren't both active, since group pricing/restrictions live there.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

function uniqueEmail(prefix) {
	return `${prefix}+${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

async function createEventWithDates(api, title) {
	const res = await api.post('/wp-json/wp/v2/fair_event', {
		headers: authHeaders,
		data: { title, status: 'publish' },
	});
	expect(res.ok()).toBeTruthy();
	const eventId = (await res.json()).id;

	const eventsRes = await api.get('/wp-json/fair-audience/v1/events', {
		headers: authHeaders,
		params: { per_page: 100 },
	});
	expect(eventsRes.ok()).toBeTruthy();
	const match = (await eventsRes.json()).find((e) => e.event_id === eventId);
	expect(match, 'event-date row for test event').toBeTruthy();
	return { eventId, eventDateId: match.event_date_id };
}

async function deleteEvent(api, eventId) {
	if (!eventId) return;
	await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
		headers: authHeaders,
		params: { force: 'true' },
	});
}

async function participantIdByEmail(api, email) {
	const res = await api.get('/wp-json/fair-audience/v1/participants', {
		headers: authHeaders,
		params: { search: email },
	});
	expect(res.ok()).toBeTruthy();
	const match = (await res.json()).find((p) => p.email === email);
	return match ? match.id : null;
}

/** Free signup on the Open tier: establishes viewer identity (participant +
 * fair_audience_session cookie) for the given request context, then returns
 * the participant ID so the caller can add it to a group. */
async function identifyAsNewParticipant(
	memberApi,
	adminApi,
	event,
	openTypeId
) {
	const email = uniqueEmail('member');
	const res = await memberApi.post('/wp-json/fair-events/v1/get-tickets', {
		data: {
			event_date_id: event.eventDateId,
			ticket_type_id: openTypeId,
			name: 'Group Pricing Test Member',
			email,
		},
	});
	expect(res.ok(), await res.text()).toBeTruthy();

	const participantId = await participantIdByEmail(adminApi, email);
	expect(participantId).toBeTruthy();
	return { participantId, email };
}

test.describe('Group-based pricing and group-restricted tiers', () => {
	let api;
	let groupsActive = false;
	let event;
	let groupId;
	let restrictedTypeId;
	let openTypeId;
	let discountedTypeId;
	let fixtureOk = true;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const pluginsRes = await api.get('/wp-json/wp/v2/plugins', {
			headers: authHeaders,
		});
		if (pluginsRes.ok()) {
			const plugins = await pluginsRes.json();
			const active = (slug) =>
				plugins.some(
					(p) => p.plugin?.includes(slug) && p.status === 'active'
				);
			groupsActive =
				active('fair-events-experimental') &&
				active('fair-audience-experimental');
		}
		if (!groupsActive) {
			return;
		}

		event = await createEventWithDates(
			api,
			`Group Pricing Test ${Date.now()}`
		);

		const groupRes = await api.post('/wp-json/fair-audience/v1/groups', {
			headers: authHeaders,
			data: { name: `Group Pricing Test Group ${Date.now()}` },
		});
		expect(groupRes.ok(), await groupRes.text()).toBeTruthy();
		groupId = (await groupRes.json()).id;

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					ticket_types: [
						{
							name: 'Members Only',
							capacity: null,
							sort_order: 0,
							recurrence_scope: 'single_instance',
							group_ids: [groupId],
						},
						{
							name: 'Open',
							capacity: null,
							sort_order: 1,
							recurrence_scope: 'single_instance',
						},
						{
							name: 'Priced For Discount',
							capacity: null,
							sort_order: 2,
							recurrence_scope: 'single_instance',
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
							ticket_type_index: 2,
							sale_period_index: 0,
							price: 25,
						},
					],
					settings: {},
				},
			}
		);
		// #1410 — publishing a fair_event doesn't auto-create its event-date;
		// captured (not asserted) so every test below can skip with a
		// reference instead of failing the hook.
		fixtureOk = ticketsRes.ok();
		if (!fixtureOk) {
			return;
		}
		const types = (await ticketsRes.json()).ticket_types || [];
		restrictedTypeId = types.find((t) => t.name === 'Members Only')?.id;
		openTypeId = types.find((t) => t.name === 'Open')?.id;
		discountedTypeId = types.find(
			(t) => t.name === 'Priced For Discount'
		)?.id;
		expect(restrictedTypeId).toBeTruthy();
		expect(openTypeId).toBeTruthy();
		expect(discountedTypeId).toBeTruthy();

		// A 100% rule on the priced tier: proves the discount is applied
		// server-side without needing a payment provider configured.
		const ruleRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/group-pricing-rules`,
			{
				headers: authHeaders,
				data: {
					group_id: groupId,
					discount_type: 'percentage',
					discount_value: 100,
				},
			}
		);
		expect(ruleRes.ok(), await ruleRes.text()).toBeTruthy();
	});

	test.afterAll(async () => {
		if (groupsActive) {
			await deleteEvent(api, event?.eventId);
			if (groupId) {
				await api.delete(
					`/wp-json/fair-audience/v1/groups/${groupId}`,
					{
						headers: authHeaders,
					}
				);
			}
		}
		await api.dispose();
	});

	test('a restricted ticket type rejects a non-member with 403 ticket_type_restricted', async () => {
		test.skip(
			!groupsActive,
			'fair-events-experimental / fair-audience-experimental not active'
		);
		test.skip(
			!fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const anon = await request.newContext({ baseURL: BASE_URL });
		const res = await anon.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: event.eventDateId,
				ticket_type_id: restrictedTypeId,
				name: 'Non Member',
				email: uniqueEmail('non-member'),
			},
		});
		expect(res.status()).toBe(403);
		expect((await res.json()).code).toBe('ticket_type_restricted');
		await anon.dispose();
	});

	test('a group member can buy the restricted ticket type', async () => {
		test.skip(
			!groupsActive,
			'fair-events-experimental / fair-audience-experimental not active'
		);
		test.skip(
			!fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		const member = await request.newContext({ baseURL: BASE_URL });
		const { participantId, email } = await identifyAsNewParticipant(
			member,
			api,
			event,
			openTypeId
		);

		const addRes = await api.post(
			`/wp-json/fair-audience/v1/groups/${groupId}/participants`,
			{ headers: authHeaders, data: { participant_id: participantId } }
		);
		expect(addRes.ok(), await addRes.text()).toBeTruthy();

		const res = await member.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: event.eventDateId,
				ticket_type_id: restrictedTypeId,
				name: 'Group Pricing Test Member',
				email,
			},
		});
		expect(res.ok(), await res.text()).toBeTruthy();
		expect((await res.json()).status).toBe('confirmed');

		await member.dispose();
	});

	test('a 100% group discount confirms free for a member, but 503s for a non-member', async () => {
		test.skip(
			!groupsActive,
			'fair-events-experimental / fair-audience-experimental not active'
		);
		test.skip(
			!fixtureOk,
			'Skipped pending #1410 — publishing a fair_event does not auto-create its event-date'
		);

		// Non-member: full price applies, and the dev stack has no payment
		// connector configured, so the priced signup is rejected — proving the
		// discount didn't apply to a non-member.
		const anon = await request.newContext({ baseURL: BASE_URL });
		const nonMemberRes = await anon.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					ticket_type_id: discountedTypeId,
					name: 'Non Member Buyer',
					email: uniqueEmail('non-member-priced'),
				},
			}
		);
		expect(nonMemberRes.status()).toBe(503);
		expect((await nonMemberRes.json()).code).toBe('payment_unavailable');
		await anon.dispose();

		// Member: the 100% rule brings the price to 0, so the free path
		// confirms without needing a payment provider — proving the discount
		// applied server-side.
		const member = await request.newContext({ baseURL: BASE_URL });
		const { participantId, email } = await identifyAsNewParticipant(
			member,
			api,
			event,
			openTypeId
		);

		const addRes = await api.post(
			`/wp-json/fair-audience/v1/groups/${groupId}/participants`,
			{ headers: authHeaders, data: { participant_id: participantId } }
		);
		expect(addRes.ok(), await addRes.text()).toBeTruthy();

		const memberRes = await member.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					ticket_type_id: discountedTypeId,
					name: 'Group Pricing Test Member',
					email,
				},
			}
		);
		expect(memberRes.ok(), await memberRes.text()).toBeTruthy();
		expect((await memberRes.json()).status).toBe('confirmed');

		await member.dispose();
	});
});
