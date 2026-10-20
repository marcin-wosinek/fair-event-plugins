/** Bulk email browser regression: saved week selection, preview and captured test. */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript } from '../support/wp-cli.js';

const fixture = (action) =>
	runScript(
		'notification-weeks-fixture.php',
		'E2E_NOTIFICATION_WEEKS',
		action
	);

test('bulk email previews and tests the selected week while scheduling is off', async ({
	page,
}) => {
	test.setTimeout(180000);
	const site = fixture('site');
	expect(site.url).toBe(process.env.WP_BASE_URL || 'http://localhost:8889');
	expect(site.offline).toBe(true);
	const source = runScript(
		'weekly-summary-fixture.php',
		'E2E_WEEKLY',
		'source'
	);
	try {
		const seeded = fixture(`seed ${source.termId}`);
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-events-event-notifications'
		);
		// One notification is open at a time, reached through the list.
		const view = page.locator('.fair-events-notifications');
		const open = async (name) => {
			const back = page.getByRole('link', {
				name: '← All notifications',
			});
			if (await back.count()) {
				await back.click();
			}
			await page
				.getByRole('table')
				.getByRole('link', { name, exact: true })
				.click();
			await expect(
				page.getByRole('navigation', { name: 'Notification sections' })
			).toBeVisible();
		};
		const listRow = (name) =>
			page.getByRole('row').filter({
				has: page.getByRole('link', { name, exact: true }),
			});

		// An unsaved draft of another notification stays apart from this one,
		// also while other views are open.
		await open('Individual email');
		const individualSubject = view.getByLabel('Subject', {
			exact: true,
		});
		const savedIndividualSubject = await individualSubject.inputValue();
		await individualSubject.fill('Individual draft {week_start}');
		await expect(view.getByText('Unsaved changes')).toBeVisible();

		await open('Bulk email');
		const channel = view;

		await channel
			.getByLabel('Subject', { exact: true })
			.fill('Unsaved {week_start}');
		await expect(
			channel.getByRole('button', { name: 'Preview next email' })
		).toBeDisabled();
		await expect(
			channel.getByText(
				'Save your changes first — the preview and the test use the saved settings.'
			)
		).toBeVisible();
		await channel
			.getByLabel('Email the weekly summary to subscribers')
			.uncheck();
		await channel
			.getByLabel('Events to include')
			.selectOption({ label: source.sourceName });
		await channel
			.getByLabel('Subject', { exact: true })
			.fill('Preview {week_start}');
		for (const scope of ['current', 'next']) {
			await channel
				.getByLabel('Which week to include')
				.selectOption(scope);
			await channel
				.getByRole('button', { name: 'Save bulk email settings' })
				.click();
			await expect(channel.getByText('Unsaved changes')).toHaveCount(0);
			await channel
				.getByRole('button', { name: 'Preview next email' })
				.click();
			const preview = channel.getByRole('group', {
				name: 'Email preview',
			});
			const monday = new Date(`${seeded.today}T12:00:00Z`);
			monday.setUTCDate(
				monday.getUTCDate() -
					seeded.weekday +
					1 +
					(scope === 'next' ? 7 : 0)
			);
			const weekStart = monday.toISOString().slice(0, 10);
			const sunday = new Date(monday);
			sunday.setUTCDate(sunday.getUTCDate() + 6);
			const weekEnd = sunday.toISOString().slice(0, 10);
			await expect(
				channel.getByText('Subject:', { exact: true }).locator('..')
			).toHaveText(`Subject: Preview ${weekStart}`);
			const expected = seeded.events.filter(
				(event) => event.date >= weekStart && event.date <= weekEnd
			);
			await expect(preview.getByRole('link')).toHaveCount(
				expected.length
			);
			for (const event of expected) {
				await expect(
					preview.getByRole('link', {
						name: event.title,
						exact: true,
					})
				).toBeVisible();
			}
			fixture('clear');
			await channel
				.getByRole('button', { name: /^Send test email to / })
				.click();
			await expect(
				channel
					.getByText(
						/Test email sent to .*No subscriber received it\./
					)
					.first()
			).toBeVisible();
			const captured = fixture('captured');
			expect(captured.mail).toHaveLength(1);
			expect(captured.mail[0].subject).toBe(`Preview ${weekStart}`);
			for (const event of seeded.events) {
				if (expected.includes(event)) {
					expect(captured.mail[0].body).toContain(event.title);
				} else {
					expect(captured.mail[0].body).not.toContain(event.title);
				}
			}
			expect(captured.telegram).toEqual([]);
		}
		// Saving bulk email twice left the individual draft unsaved and alone.
		await page.getByRole('link', { name: '← All notifications' }).click();
		await expect(
			listRow('Individual email').getByText('Unsaved changes')
		).toBeVisible();
		await open('Individual email');
		await expect(individualSubject).toHaveValue(
			'Individual draft {week_start}'
		);
		await expect(view.getByText('Unsaved changes')).toBeVisible();
		await expect(
			view.getByText('Individual email settings saved.')
		).toHaveCount(0);
		await individualSubject.fill(savedIndividualSubject);
		await expect(view.getByText('Unsaved changes')).toHaveCount(0);
	} finally {
		fixture('cleanup');
		runScript(
			'weekly-summary-fixture.php',
			'E2E_WEEKLY',
			`cleanup ${source.termId} ${source.sourceId}`
		);
	}
});
