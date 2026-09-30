import { test, expect } from '@playwright/test';
import {
	loginAsAdmin,
	resetCapturedMail,
	runScript,
	wpCli,
} from './support/wp-cli.js';

const EXPERIMENTAL = 'fair-payments-connector-experimental';
const ROUTES_OPTION = 'fair_payment_notification_routes';
const DESTINATION = 'e2e-notifications-1657@example.test';

test.describe('Payment notifications in Fair Payments Connector (#1657)', () => {
	let experimentalWasActive;
	let savedRoutes;

	test.beforeAll(() => {
		experimentalWasActive =
			wpCli(`plugin list --name=${EXPERIMENTAL} --field=status`, {
				allowFailure: true,
			}).trim() === 'active';
		if (experimentalWasActive) {
			wpCli(`plugin deactivate ${EXPERIMENTAL}`);
		}

		savedRoutes = wpCli(`option get ${ROUTES_OPTION} --format=json`, {
			allowFailure: true,
		}).trim();
		wpCli(`option update ${ROUTES_OPTION} '[]' --format=json`);
		resetCapturedMail();
	});

	test.afterAll(() => {
		if (savedRoutes) {
			wpCli(
				`option update ${ROUTES_OPTION} '${savedRoutes}' --format=json`
			);
		} else {
			wpCli(`option delete ${ROUTES_OPTION}`, { allowFailure: true });
		}
		resetCapturedMail();
		if (experimentalWasActive) {
			wpCli(`plugin activate ${EXPERIMENTAL}`);
		}
	});

	test('configures a route and sends a test notification without the experimental plugin', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-notifications'
		);
		await expect(
			page.getByRole('heading', { level: 1, name: 'Notifications' })
		).toBeVisible();

		await page.getByRole('button', { name: 'Add route' }).click();
		await page.getByLabel('Channel').selectOption('email');
		await page.getByLabel('Email address').fill(DESTINATION);
		await page.getByLabel('Frequency').selectOption('daily');
		await page.getByLabel('Include PII').uncheck();

		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(
			page.getByText('Notification settings saved.').first()
		).toBeVisible();

		// The saved route comes back after a reload with every field kept.
		await page.reload();
		await expect(page.getByLabel('Email address')).toHaveValue(DESTINATION);
		await expect(page.getByLabel('Channel')).toHaveValue('email');
		await expect(page.getByLabel('Frequency')).toHaveValue('daily');
		await expect(page.getByLabel('Include PII')).not.toBeChecked();
		await expect(page.getByLabel('Enabled')).toBeChecked();

		await page.getByRole('button', { name: 'Send test' }).click();
		await expect(
			page.getByText('Test notification sent.').first()
		).toBeVisible();

		const { mail } = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION',
			DESTINATION
		);
		expect(mail).toHaveLength(1);
		expect(mail[0].subject).toMatch(/^Payment notification — /);
		// Personal information is omitted as the route asks.
		expect(mail[0].body).toContain('Sample P.');
		expect(mail[0].body).not.toContain('Sample Participant');
		expect(mail[0].body).not.toContain('sample@example.com');
	});
});
