/**
 * E2E: the Event Signup block's "Show mailing signup checkbox" setting (#1789).
 *
 * The setting is a per-block display option: on (the default, also for blocks
 * saved before it existed) the form carries the "Keep me informed about future
 * events" checkbox, off it omits the checkbox row altogether. A form without
 * the checkbox submits `mailing_opt_in: false`, so a signup through it must
 * grant no mailing consent and leave an existing participant's subscription
 * preferences alone.
 *
 * Covers the editor (toggle, per-block persistence across a save and reopen)
 * and a completed signup for both settings, with fair-audience active (consent
 * lives on the participant, plus the double opt-in confirmation token) and
 * inactive (consent lives on the fair-events signup row).
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript, loginAsAdmin } from '../support/wp-cli.js';

const MAILING_CHECKBOX = 'input[name="mailing_opt_in"]';
const MAILING_LABEL = 'Keep me informed about future events';
const SETTING_LABEL = 'Show mailing signup checkbox';

/**
 * Open the seeded event in the block editor and wait for both the block
 * store and the canvas to be ready.
 *
 * @param {import('@playwright/test').Page} page    Playwright page.
 * @param {number}                          eventId Event post id.
 */
async function openEditor(page, eventId) {
	await page.goto(`/wp-admin/post.php?post=${eventId}&action=edit`);
	await page.waitForFunction(() =>
		window.wp?.data
			?.select('core/block-editor')
			?.getBlocks()
			.some((block) => block.name === 'fair-events/event-signup')
	);

	// The "Welcome to the block editor" guide overlays the canvas on a
	// user's first visit.
	const welcomeGuide = page.locator('.components-guide');
	if (await welcomeGuide.isVisible().catch(() => false)) {
		await page.getByRole('button', { name: 'Close' }).first().click();
	}
}

/**
 * Select the nth Event Signup block and show its settings in the sidebar.
 * The block's live preview ignores pointer events, so it is selected through
 * the block-editor store instead of a click.
 *
 * @param {import('@playwright/test').Page} page  Playwright page.
 * @param {number}                          index Zero-based block position.
 */
async function selectSignupBlock(page, index) {
	await page.evaluate((position) => {
		const { select, dispatch } = window.wp.data;
		const clientIds = select('core/block-editor')
			.getBlocks()
			.filter((block) => block.name === 'fair-events/event-signup')
			.map((block) => block.clientId);
		dispatch('core/block-editor').selectBlock(clientIds[position]);
		dispatch('core/edit-post').openGeneralSidebar('edit-post/block');
	}, index);
}

/**
 * Fill and submit the signup form on an event page, waiting for the
 * in-place confirmation of a free signup.
 *
 * @param {import('@playwright/test').Page} page            Playwright page.
 * @param {object}                          event           Seeded event payload.
 * @param {object}                          buyer           Buyer details.
 * @param {string}                          buyer.name      Buyer name.
 * @param {string}                          buyer.email     Buyer email.
 * @param {boolean}                         [buyer.optedIn] Tick the mailing checkbox.
 */
async function signUp(page, event, { name, email, optedIn = false }) {
	await page.goto(event.pageUrl);

	const form = page.locator('.fair-events-get-tickets-form');
	await expect(form).toBeVisible();
	await form.locator('input[name="name"]').fill(name);
	await form.locator('input[name="email"]').fill(email);
	await form
		.locator(`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`)
		.check();
	if (optedIn) {
		await form.locator(MAILING_CHECKBOX).check();
	}

	await form.locator('button[type="submit"]').click();
	await expect(
		page.locator('.fair-events-get-tickets-message-success')
	).toBeVisible({ timeout: 15000 });
}

test.describe('Event Signup block mailing signup checkbox setting', () => {
	test('the setting is saved for each block and survives reopening the editor', async ({
		page,
		seedEvent,
	}) => {
		test.setTimeout(120000);

		// Two blocks saved without the attribute, as content from before the
		// setting existed.
		const event = seedEvent('free', { block: 'unified-two-signups' });

		await loginAsAdmin(page);
		await openEditor(page, event.eventId);

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		const signupBlocks = editorFrame.locator(
			'.wp-block-fair-events-event-signup'
		);
		const setting = page.getByRole('checkbox', { name: SETTING_LABEL });

		// Existing blocks keep showing the checkbox, with the setting on.
		await expect(signupBlocks).toHaveCount(2);
		await expect(signupBlocks.nth(0).locator(MAILING_CHECKBOX)).toHaveCount(
			1
		);
		await expect(signupBlocks.nth(1).locator(MAILING_CHECKBOX)).toHaveCount(
			1
		);
		await selectSignupBlock(page, 0);
		await expect(setting).toBeChecked();

		// Hiding it on the second block leaves the first one alone, and the
		// preview drops the row and its label rather than the whole form.
		await selectSignupBlock(page, 1);
		await expect(setting).toBeChecked();
		await setting.click();
		await expect(setting).not.toBeChecked();
		await expect(signupBlocks.nth(1).locator(MAILING_CHECKBOX)).toHaveCount(
			0
		);
		await expect(
			signupBlocks.nth(1).locator('input[name="email"]')
		).toHaveCount(1);
		await expect(signupBlocks.nth(1)).not.toContainText(MAILING_LABEL);
		await expect(signupBlocks.nth(0).locator(MAILING_CHECKBOX)).toHaveCount(
			1
		);
		await expect(signupBlocks.nth(0)).toContainText(MAILING_LABEL);

		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await page.waitForFunction(() => {
			const editor = window.wp.data.select('core/editor');
			return !editor.isSavingPost() && !editor.isEditedPostDirty();
		});

		// Reopened: each block still has its own value.
		await openEditor(page, event.eventId);
		await expect(signupBlocks).toHaveCount(2);
		await selectSignupBlock(page, 0);
		await expect(setting).toBeChecked();
		await selectSignupBlock(page, 1);
		await expect(setting).not.toBeChecked();
		await expect(signupBlocks.nth(0).locator(MAILING_CHECKBOX)).toHaveCount(
			1
		);
		await expect(signupBlocks.nth(1).locator(MAILING_CHECKBOX)).toHaveCount(
			0
		);

		// The public page follows the same per-block values.
		await page.goto(event.pageUrl);
		const forms = page.locator('.fair-events-get-tickets-form');
		await expect(forms).toHaveCount(2);
		await expect(forms.nth(0).locator(MAILING_CHECKBOX)).toBeVisible();
		await expect(forms.nth(0)).toContainText(MAILING_LABEL);
		await expect(forms.nth(1).locator(MAILING_CHECKBOX)).toHaveCount(0);
		await expect(forms.nth(1)).not.toContainText(MAILING_LABEL);
	});

	test.describe('signup with fair-audience active', () => {
		test('a ticked visible checkbox records mailing consent', async ({
			page,
			seedEvent,
		}) => {
			// A block saved without the attribute: the checkbox is shown.
			const event = seedEvent('free');
			const stamp = Date.now();
			const email = `mailing.visible.${stamp}@example.test`;

			await signUp(page, event, {
				name: `E2E Mailing Visible ${stamp}`,
				email,
				optedIn: true,
			});

			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);
			expect(state.found).toBe(true);
			expect(state.label).toBe('signed_up');
			expect(state.email_profile).toBe('marketing');
			expect(state.status).toBe('pending');
			expect(state.confirmation_tokens).toBe(1);
		});

		test('a hidden checkbox signs up without mailing consent or a confirmation token', async ({
			page,
			seedEvent,
		}) => {
			const event = seedEvent('free', {
				block: 'unified-hidden-mailing',
			});
			const stamp = Date.now();
			const email = `mailing.hidden.${stamp}@example.test`;

			await page.goto(event.pageUrl);
			const form = page.locator('.fair-events-get-tickets-form');
			await expect(form).toBeVisible();
			await expect(form.locator(MAILING_CHECKBOX)).toHaveCount(0);
			await expect(form).not.toContainText(MAILING_LABEL);

			await signUp(page, event, {
				name: `E2E Mailing Hidden ${stamp}`,
				email,
			});

			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);
			expect(state.found).toBe(true);
			expect(state.label).toBe('signed_up');
			expect(state.email_profile).toBe('minimal');
			expect(state.status).toBe('confirmed');
			expect(state.confirmation_tokens).toBe(0);
			expect(
				state.mail.filter((mail) =>
					mail.subject.includes('Confirm your subscription')
				)
			).toHaveLength(0);
		});

		test("a hidden checkbox leaves an existing participant's preferences untouched", async ({
			page,
			seedEvent,
		}) => {
			const event = seedEvent('free', {
				block: 'unified-hidden-mailing',
			});
			// Already subscribed to mailings, and recognised here through a
			// validated participant token.
			const participant = runScript(
				'seed-participant-token.php',
				'E2E_TOKEN',
				`${event.eventDateId} marketing`
			);

			await page.goto(
				`${event.pageUrl}?participant_token=${participant.token}`
			);
			const form = page.locator('.fair-events-get-tickets-form');
			await expect(form.locator('input[name="email"]')).toHaveValue(
				participant.email
			);
			await expect(form.locator(MAILING_CHECKBOX)).toHaveCount(0);

			await form.locator('button[type="submit"]').click();
			await expect(
				page.locator('.fair-events-get-tickets-message-success')
			).toBeVisible({ timeout: 15000 });

			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${participant.email} ${event.eventDateId}`
			);
			expect(state.label).toBe('signed_up');
			expect(state.email_profile).toBe('marketing');
			expect(state.status).toBe('confirmed');
			expect(state.confirmation_tokens).toBe(0);
		});
	});

	test.describe('signup with fair-audience inactive', () => {
		test.beforeAll(() => {
			wpCli('plugin deactivate fair-audience');
		});

		test.afterAll(() => {
			wpCli('plugin activate fair-audience');
		});

		test('both settings complete a signup, and only a ticked visible checkbox stores consent', async ({
			page,
			seedEvent,
		}) => {
			const visibleEvent = seedEvent('free');
			const hiddenEvent = seedEvent('free', {
				block: 'unified-hidden-mailing',
			});
			const stamp = Date.now();

			await signUp(page, visibleEvent, {
				name: `E2E Standalone Visible ${stamp}`,
				email: `standalone.visible.${stamp}@example.test`,
				optedIn: true,
			});

			await page.goto(hiddenEvent.pageUrl);
			await expect(
				page.locator('.fair-events-get-tickets-form')
			).toBeVisible();
			await expect(page.locator(MAILING_CHECKBOX)).toHaveCount(0);
			await signUp(page, hiddenEvent, {
				name: `E2E Standalone Hidden ${stamp}`,
				email: `standalone.hidden.${stamp}@example.test`,
			});

			const visibleState = runScript(
				'get-tickets-state.php',
				'E2E_GT_STATE',
				String(visibleEvent.eventDateId)
			);
			expect(visibleState.signups).toHaveLength(1);
			expect(visibleState.signups[0].status).toBe('confirmed');
			expect(visibleState.signups[0].mailing_opt_in).toBe(true);

			const hiddenState = runScript(
				'get-tickets-state.php',
				'E2E_GT_STATE',
				String(hiddenEvent.eventDateId)
			);
			expect(hiddenState.signups).toHaveLength(1);
			expect(hiddenState.signups[0].status).toBe('confirmed');
			expect(hiddenState.signups[0].mailing_opt_in).toBe(false);
		});
	});
});
