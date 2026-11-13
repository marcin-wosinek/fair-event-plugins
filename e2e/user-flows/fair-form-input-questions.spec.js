/**
 * E2E: the Date, Date & Time, Email and Short Text questions, which share
 * one editor and one public renderer (#2235).
 *
 * A visitor fills a standalone Fair Form holding one required question of
 * each type: the form rejects a missing answer and an invalid email, then
 * stores every answer unchanged — dates and times without any timezone
 * conversion. Content saved under the canonical and the legacy
 * (`fair-audience/fair-form*`) names reopens in the editor without block
 * validation errors and keeps its question keys and required settings
 * through a save.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const seedPage = (variant = '') =>
	runScript(
		'seed-fair-form-input-questions-page.php',
		'E2E_FAIR_FORM_INPUT_QUESTIONS_PAGE',
		variant
	);

const cleanupPage = (pageId) =>
	runScript(
		'cleanup-fair-form-notification-page.php',
		'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
		`${pageId}`
	);

const fieldOf = (page, key) =>
	page.locator(`[data-question-key="${key}"] input`);

test.describe('Fair Form single-input questions', () => {
	// The submit endpoint rate-limits by IP.
	test.beforeEach(() => {
		wpCli('transient delete --all');
	});

	test('validates and stores date, date/time, email and short-text answers', async ({
		page,
	}) => {
		const seed = seedPage();
		let state = { found: false };

		try {
			await page.goto(seed.pageUrl);

			// Each question keeps its native input, unique labelled id and
			// required attribute.
			const expectedTypes = {
				visit_date: 'date',
				arrival: 'datetime-local',
				email: 'email',
				full_name: 'text',
			};
			for (const question of seed.questions) {
				const input = page.getByLabel(question.questionText);
				await expect(input).toHaveAttribute(
					'type',
					expectedTypes[question.questionKey]
				);
				await expect(input).toHaveAttribute(
					'name',
					`fair_form_q_${question.questionKey}`
				);
				await expect(input).toHaveAttribute('required', '');
			}
			await expect(fieldOf(page, 'email')).toHaveAttribute(
				'placeholder',
				'name@example.com'
			);
			await expect(
				page.locator('[data-question-key="full_name"]')
			).toHaveAttribute('data-question-type', 'short_text');
			await expect(
				page.locator('[data-question-key="arrival"]')
			).toHaveAttribute('data-question-type', 'datetime');

			const message = page.locator('.fair-form-message');
			const submit = page.locator('.fair-form-submit-button');

			await fieldOf(page, 'visit_date').fill('2026-12-24');
			await fieldOf(page, 'arrival').fill('2026-12-24T18:30');
			await fieldOf(page, 'email').fill('not-an-email');
			await submit.click();
			await expect(message).toHaveText(
				'Please answer the required question: Your name'
			);

			await fieldOf(page, 'full_name').fill('Input Question Visitor');
			await submit.click();
			await expect(message).toHaveText(
				'Please enter a valid email address for: Your email'
			);

			state = runScript(
				'fair-form-submission-state.php',
				'E2E_FAIR_FORM_SUBMISSION',
				`${seed.pageId}`
			);
			expect(state.found).toBe(false);

			const email = `e2e.input-questions.${Date.now()}@example.test`;
			await fieldOf(page, 'email').fill(email);
			await submit.click();
			await expect(message).toHaveText('Thank you for your submission!');

			state = runScript(
				'fair-form-submission-state.php',
				'E2E_FAIR_FORM_SUBMISSION',
				`${seed.pageId}`
			);
			expect(state.found).toBe(true);
			expect(state.answers).toEqual({
				visit_date: '2026-12-24',
				arrival: '2026-12-24 18:30:00',
				email,
				full_name: 'Input Question Visitor',
			});
		} finally {
			cleanupPage(seed.pageId);
			if (state.participantId) {
				runScript(
					'cleanup-participant.php',
					'E2E_PARTICIPANT_CLEANUP',
					`${state.participantId}`
				);
			}
		}
	});

	for (const variant of ['canonical', 'legacy']) {
		test(`reopens ${variant} saved questions and keeps their settings through a save`, async ({
			page,
		}) => {
			const seed = seedPage('legacy' === variant ? 'legacy' : '');

			try {
				await loginAsAdmin(page);
				const editUrl = `/wp-admin/post.php?post=${seed.pageId}&action=edit`;

				const openEditor = async () => {
					await page.goto(editUrl);
					const canvas = page.frameLocator('[name="editor-canvas"]');
					await canvas
						.locator('.block-editor-iframe__body')
						.waitFor();
					const guide = page.locator('.components-guide');
					if (await guide.isVisible().catch(() => false)) {
						await page
							.getByRole('button', { name: 'Close' })
							.first()
							.click();
					}
					return canvas;
				};

				const readQuestions = () =>
					page.evaluate(() => {
						const collect = (blocks) =>
							blocks.flatMap((block) => [
								...(block.attributes?.questionKey
									? [
											{
												name: block.name,
												isValid: block.isValid,
												questionKey:
													block.attributes
														.questionKey,
												questionText:
													block.attributes
														.questionText,
												required:
													block.attributes.required,
											},
										]
									: []),
								...collect(block.innerBlocks || []),
							]);
						return collect(
							window.wp.data
								.select('core/block-editor')
								.getBlocks()
						);
					});

				const expected = seed.questions.map((question) => ({
					name: `fair-form/${question.slug}`,
					isValid: true,
					questionKey: question.questionKey,
					questionText: question.questionText,
					required: true,
				}));

				let canvas = await openEditor();
				await expect(
					canvas.locator('.fair-form-question-label-input')
				).toHaveCount(seed.questions.length);
				await expect(
					canvas.getByText('This block contains unexpected')
				).toHaveCount(0);
				// A legacy block replaces itself with the canonical one.
				await expect.poll(readQuestions).toEqual(expected);

				// Edit the short-text label: a customized key is kept.
				await canvas
					.locator('.fair-form-question-short-text textarea')
					.fill('Your full name');
				expected[3].questionText = 'Your full name';

				await page.evaluate(() =>
					window.wp.data.dispatch('core/editor').savePost()
				);
				await page.waitForFunction(() => {
					const editor = window.wp.data.select('core/editor');
					return (
						!editor.isSavingPost() && !editor.isEditedPostDirty()
					);
				});

				canvas = await openEditor();
				await expect.poll(readQuestions).toEqual(expected);
				const stored = wpCli(
					`post get ${seed.pageId} --field=post_content`
				);
				expect(stored).not.toContain('wp:fair-audience/');
				expect(stored).toContain('"questionKey":"full_name"');
			} finally {
				cleanupPage(seed.pageId);
			}
		});
	}
});
