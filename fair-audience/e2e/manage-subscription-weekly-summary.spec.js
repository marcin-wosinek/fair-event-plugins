/**
 * E2E test for the weekly-summary opt-out preference on the public
 * manage-subscription page (#1157).
 *
 * Exercises the real save flow: navigates to the tokenized manage-subscription
 * URL as an anonymous visitor, unchecks the "Weekly summary of upcoming
 * events" checkbox, and submits the form — then verifies the stored
 * preference via the admin REST API while the email_profile stays
 * unaffected. Fixtures (participant, weekly-digest config) are created via
 * the admin REST API using Application Password credentials
 * (WP_ADMIN_USER / WP_ADMIN_PASSWORD) and torn down at the end of the suite.
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

test.describe('Manage-subscription page — weekly summary opt-out', () => {
	let api;
	let participantId;
	let subscriptionUrl;
	let originalDigestConfig;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Save the original weekly-digest config and enable the feature so the
		// preference is shown on the manage page.
		const configRes = await api.get(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders }
		);
		if (configRes.ok()) {
			originalDigestConfig = (await configRes.json()).config;
		}
		const enableRes = await api.put(
			'/wp-json/fair-audience/v1/weekly-digest',
			{ headers: authHeaders, data: { enabled: true } }
		);
		expect(enableRes.ok()).toBeTruthy();

		// A confirmed marketing subscriber so the checkbox renders checked and
		// enabled by default.
		const createRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Weekly Summary Opt-out Test',
					email: uniqueEmail('weekly-summary'),
					email_profile: 'marketing',
				},
			}
		);
		expect(createRes.ok()).toBeTruthy();
		participantId = (await createRes.json()).id;

		const urlRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${participantId}/subscription-url`,
			{ headers: authHeaders }
		);
		expect(urlRes.ok()).toBeTruthy();
		subscriptionUrl = (await urlRes.json()).url;
	});

	test.afterAll(async () => {
		if (participantId) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${participantId}`,
				{ headers: authHeaders }
			);
		}
		if (originalDigestConfig) {
			await api.put('/wp-json/fair-audience/v1/weekly-digest', {
				headers: authHeaders,
				data: originalDigestConfig,
			});
		}
		await api.dispose();
	});

	test('unchecking and saving persists the opt-out without touching email_profile', async ({
		page,
	}) => {
		await page.goto(subscriptionUrl);

		const summaryCheckbox = page.locator('#fair-audience-weekly-summary');
		await expect(summaryCheckbox).toBeVisible();
		await expect(summaryCheckbox).toBeChecked();
		await expect(summaryCheckbox).toBeEnabled();

		await summaryCheckbox.uncheck();
		await page.click('.fair-audience-subscription-submit');

		await expect(
			page.locator('.fair-audience-subscription-message.success')
		).toBeVisible();

		const afterUncheck = page.locator('#fair-audience-weekly-summary');
		await expect(afterUncheck).not.toBeChecked();

		const getRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${participantId}`,
			{ headers: authHeaders }
		);
		expect(getRes.ok()).toBeTruthy();
		const participant = await getRes.json();
		expect(participant.email_profile).toBe('marketing');
		expect(participant.weekly_summary_opt_out).toBe(true);

		// Re-checking and saving re-subscribes them to the summary.
		await page.goto(subscriptionUrl);
		const recheckCheckbox = page.locator('#fair-audience-weekly-summary');
		await recheckCheckbox.check();
		await page.click('.fair-audience-subscription-submit');
		await expect(
			page.locator('.fair-audience-subscription-message.success')
		).toBeVisible();

		const getResAfter = await api.get(
			`/wp-json/fair-audience/v1/participants/${participantId}`,
			{ headers: authHeaders }
		);
		const participantAfter = await getResAfter.json();
		expect(participantAfter.weekly_summary_opt_out).toBe(false);
	});

	test('preference is hidden for a minimal-profile subscriber', async ({
		page,
	}) => {
		const minimalRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Minimal Profile Test',
					email: uniqueEmail('minimal-profile'),
					email_profile: 'minimal',
				},
			}
		);
		expect(minimalRes.ok()).toBeTruthy();
		const minimalId = (await minimalRes.json()).id;

		const urlRes = await api.get(
			`/wp-json/fair-audience/v1/participants/${minimalId}/subscription-url`,
			{ headers: authHeaders }
		);
		const minimalUrl = (await urlRes.json()).url;

		await page.goto(minimalUrl);
		await expect(
			page.locator('#fair-audience-weekly-summary-wrap')
		).toBeHidden();

		await api.delete(
			`/wp-json/fair-audience/v1/participants/${minimalId}`,
			{ headers: authHeaders }
		);
	});
});
