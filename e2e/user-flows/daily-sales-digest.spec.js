/**
 * E2E: a daily email route delivers a sales digest after paid transactions.
 *
 * Drives the real fair-payments-connector-experimental code — the
 * fair_payment_paid hook, the notification queue table, and the daily cron
 * callback — through the wp-env instance and asserts on what the recipient
 * would receive (mail captured by e2e/mu-plugins/fair-e2e-support.php). The
 * eval-file helper scripts/digest-flow.php stands in for WP-Cron and for the
 * paying customer; no real mail or payment is involved.
 */

import { test, expect } from '@playwright/test';
import { runScript, ADMIN_USER, ADMIN_PASSWORD } from '../support/wp-cli.js';

const flow = (args) => runScript('digest-flow.php', 'E2E_DIGEST', args);

test.describe('daily sales digest', () => {
	test.afterAll(() => {
		flow('cleanup');
	});

	test('queues paid sales, retries a failed send, then delivers one digest', () => {
		const queued = flow('enqueue daily 0');

		// Every paid transaction is queued once, tagged with the route's frequency.
		expect(queued.rows).toHaveLength(3);
		for (const row of queued.rows) {
			expect(row.frequency).toBe('daily');
			expect(row.status).toBe('pending');
			expect(row.destination).toBe('owner@example.test');
		}
		// Include PII off: only the abbreviated name is ever stored.
		for (const row of queued.rows) {
			expect(row.rendered_text).toContain('Jane D.');
			expect(row.rendered_text).not.toContain('Doe');
			expect(row.rendered_text).not.toContain('@example.test');
		}

		// Other frequencies' callbacks leave the daily rows alone.
		const hourly = flow('flush hourly');
		expect(hourly.mail).toHaveLength(0);
		expect(hourly.rows.map((r) => r.status)).toEqual([
			'pending',
			'pending',
			'pending',
		]);

		// A failed send is detectable and loses nothing.
		const failed = flow('flush daily fail');
		expect(failed.mail).toHaveLength(0);
		expect(failed.rows).toHaveLength(3);
		for (const row of failed.rows) {
			expect(row.status).toBe('pending');
			expect(row.sent_at).toBeNull();
			expect(Number(row.attempts)).toBe(1);
			expect(row.last_error).toBe('Channel reported a failed send.');
		}

		// The next run delivers a single digest covering every sale once.
		const sent = flow('flush daily');
		expect(sent.mail).toHaveLength(1);
		const [mail] = sent.mail;
		expect(mail.to).toBe('owner@example.test');
		expect(mail.body).toContain('3 sales');
		expect(mail.body).toContain('15.50 EUR');
		expect(mail.body).toContain('20.00 USD');
		expect(mail.body).toContain('Jane D.');
		expect(mail.body).not.toContain('Doe');
		expect(mail.body).not.toMatch(/jane\.\d+@example\.test/);
		expect(mail.body.split('Jane D.').length - 1).toBe(3);
		for (const row of sent.rows) {
			expect(row.status).toBe('sent');
			expect(row.sent_at).not.toBeNull();
			expect(Number(row.attempts)).toBe(2);
		}

		// Running again sends nothing further.
		const again = flow('flush daily');
		expect(again.mail).toHaveLength(1);
	});

	test('a route with Include PII on delivers full names', () => {
		flow('enqueue daily 1');

		const sent = flow('flush daily');
		expect(sent.mail).toHaveLength(1);
		expect(sent.mail[0].body).toContain('Jane Doe 9001');
		expect(sent.mail[0].body).toContain('Jane Doe 9003');
	});

	test('Send test reports its own result and leaves queued sales untouched', async ({
		request,
	}) => {
		const queued = flow('enqueue daily 0');
		expect(queued.rows).toHaveLength(3);

		const res = await request.post(
			'/wp-json/fair-payments-connector/v1/notifications/test',
			{
				headers: {
					Authorization:
						'Basic ' +
						Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
							'base64'
						),
				},
				data: {
					channel: 'email',
					destination: 'owner@example.test',
					include_pii: false,
				},
			}
		);
		expect(res.status()).toBe(200);
		expect(await res.json()).toHaveProperty('success', true);

		// The test message went out on its own; the queue is exactly as it was,
		// so a successful test says nothing about scheduled delivery.
		const after = flow('report');
		expect(after.rows).toEqual(queued.rows);
		expect(after.mail).toHaveLength(1);
		expect(after.mail[0].subject).toContain('Payment notification');
		expect(after.mail[0].body).not.toContain('3 sales');
	});
});
