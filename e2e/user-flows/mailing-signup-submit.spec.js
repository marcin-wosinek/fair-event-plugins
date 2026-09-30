/**
 * E2E: the public Mailing Signup block validates its fields, submits to
 * `/fair-audience/v1/mailing-signup`, and shows its success, info, and error
 * states — without loading the editor component bundle on the public page
 * (#1668).
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

test.describe('Mailing signup block', () => {
	let seed;
	const email = `e2e.mailing-signup.${Date.now()}@example.test`;

	test.beforeAll(() => {
		seed = runScript(
			'seed-mailing-signup-page.php',
			'E2E_MAILING_SIGNUP_PAGE'
		);
	});

	test.afterAll(() => {
		runScript(
			'cleanup-mailing-signup.php',
			'E2E_MAILING_SIGNUP_CLEANUP',
			`${seed.pageId} ${email}`
		);
	});

	test('validates, subscribes, resends, and reports server errors', async ({
		page,
	}) => {
		const scriptUrls = [];
		page.on('request', (request) => {
			if (request.resourceType() === 'script') {
				scriptUrls.push(request.url());
			}
		});

		await page.goto(seed.pageUrl);

		const form = page.locator('.fair-audience-mailing-form');
		const name = form.getByLabel('First Name');
		const surname = form.getByLabel('Last Name');
		const emailInput = form.getByLabel('Email');
		const submit = form.locator('.fair-audience-mailing-submit-button');
		const message = form.locator('.fair-audience-mailing-message');

		expect(
			scriptUrls.filter((url) =>
				/\/dist\/components(\.min)?\.js/.test(url)
			)
		).toEqual([]);

		// Whitespace passes the native `required` check but not the script's.
		await name.fill('   ');
		await surname.fill('Tester');
		await emailInput.fill(email);
		await submit.click();
		await expect(message).toHaveText('Please enter your first name.');
		await expect(message).toHaveClass(
			/fair-audience-mailing-message-error/
		);

		// A new address is accepted and the form is cleared.
		await name.fill('E2E');
		await submit.click();
		await expect(message).toHaveText(
			'Please check your email to confirm your subscription.'
		);
		await expect(message).toHaveClass(
			/fair-audience-mailing-message-success/
		);
		await expect(emailInput).toHaveValue('');
		await expect(submit).toBeEnabled();
		await expect(submit).toHaveText('Subscribe');

		// The same pending address gets another confirmation email.
		await name.fill('E2E');
		await surname.fill('Tester');
		await emailInput.fill(email);
		await submit.click();
		await expect(message).toHaveText(
			'We sent you another confirmation email. Please check your inbox.'
		);
		await expect(message).toHaveClass(/fair-audience-mailing-message-info/);

		// `a@b` passes the browser's email check but the endpoint's argument
		// validation rejects it; its error message is shown as-is.
		await emailInput.fill('a@b');
		await submit.click();
		await expect(message).toHaveText('Invalid parameter(s): email');
		await expect(message).toHaveClass(
			/fair-audience-mailing-message-error/
		);
		await expect(submit).toBeEnabled();
	});
});
