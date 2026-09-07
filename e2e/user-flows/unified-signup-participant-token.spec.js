import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('unified signup participant-token identity', () => {
	test('an invalid token leaves the anonymous form usable', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		await page.goto(`${event.pageUrl}?participant_token=invalid`);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await expect(form.locator('input[name="name"]')).toHaveValue('');
		await expect(form.locator('input[name="email"]')).toHaveValue('');
	});

	test('hydrates and submits with the same validated token identity', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		const participant = runScript(
			'seed-participant-token.php',
			'E2E_TOKEN',
			String(event.eventDateId)
		);

		await page.goto(
			`${event.pageUrl}?participant_token=${participant.token}`
		);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form.locator('input[name="name"]')).toHaveValue(
			participant.name
		);
		await expect(form.locator('input[name="email"]')).toHaveValue(
			participant.email
		);

		await form.locator('button[type="submit"]').click();
		await expect(
			page.locator('.fair-events-get-tickets-message-success')
		).toBeVisible();

		const state = runScript(
			'participant-signup-state.php',
			'E2E_PARTICIPANT_STATE',
			`${participant.participantId} ${event.eventDateId}`
		);
		expect(state.label).toBe('signed_up');

		const freshPage = await page.context().browser().newPage();
		await freshPage.goto(event.pageUrl);
		await expect(freshPage.locator('input[name="email"]')).toHaveValue('');
		await freshPage.close();
	});
});
