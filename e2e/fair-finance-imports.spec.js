/**
 * Fair Finance spreadsheet imports (#1812): an administrator imports bank
 * entries from an Excel export and matches a Mollie settlement CSV to a bank
 * entry. A broken file shows an error, offers nothing to send, and is
 * recovered from by choosing a valid file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const ENTRIES_PAGE = '/wp-admin/admin.php?page=fair-finance-entries';
const RECONCILIATION_PAGE =
	'/wp-admin/admin.php?page=fair-finance-reconciliation';
const ENTRIES_API = '/wp-json/fair-finance/v1/financial-entries';
const SEED = '/wp-json/fair-e2e/v1/transaction-filters/seed';
const KEY = `i${Date.now().toString(36)}`;

// The bank export also read by the Fair Finance unit tests.
const WORKBOOK = readFileSync(
	fileURLToPath(
		new URL(
			'../fair-finance/src/Admin/entries/__tests__/fixtures/bank-entries.xlsx',
			import.meta.url
		)
	)
);

// What the importer makes of that export.
const IMPORTED = [
	{
		entry_date: '2026-05-01',
		description: 'TRANSFERENCIA DE MOLLIE',
		amount: 38.55,
		entry_type: 'income',
		external_reference: 'import_2026-05-01_1001_38.55',
	},
	{
		entry_date: '2026-05-02',
		description: 'ALQUILER SALA',
		amount: 250,
		entry_type: 'cost',
		external_reference: 'import_2026-05-02_1002_-250',
	},
	{
		entry_date: '2026-05-03',
		description: 'CUOTA SOCIO',
		amount: 20.5,
		entry_type: 'income',
		external_reference: 'import_2026-05-03_6_20.5',
	},
];

const PAYOUT_DESCRIPTION = 'E2E settlement import payout';

test.describe('Fair Finance spreadsheet imports', () => {
	let api;

	const listEntries = async (params) => {
		const res = await api.get(ENTRIES_API, {
			headers: adminHeaders,
			params: { per_page: 100, ...params },
		});
		expect(res.ok(), await res.text()).toBeTruthy();
		return (await res.json()).entries;
	};

	const importedEntries = async () => {
		const references = IMPORTED.map((entry) => entry.external_reference);
		const entries = await listEntries({
			date_from: '2026-05-01',
			date_to: '2026-05-03',
		});
		return entries
			.filter((entry) => references.includes(entry.external_reference))
			.sort((a, b) => a.entry_date.localeCompare(b.entry_date));
	};

	const payoutEntries = async () =>
		(
			await listEntries({
				date_from: '2026-05-04',
				date_to: '2026-05-04',
			})
		).filter((entry) => entry.description === PAYOUT_DESCRIPTION);

	const removeEntries = async (entries) => {
		for (const entry of entries) {
			await api.delete(`${ENTRIES_API}/${entry.id}/match`, {
				headers: adminHeaders,
			});
			await api.delete(`${ENTRIES_API}/${entry.id}`, {
				headers: adminHeaders,
			});
		}
	};

	const cleanUp = async () => {
		await removeEntries(await importedEntries());
		await removeEntries(await payoutEntries());
		await api.delete(SEED, { headers: adminHeaders, params: { key: KEY } });
	};

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
		await cleanUp();
	});

	test.afterAll(async () => {
		await cleanUp();
		await api.dispose();
	});

	test('imports bank entries from an Excel export after a broken file', async ({
		page,
	}) => {
		const importRequests = [];
		page.on('request', (req) => {
			if (req.url().includes('/financial-entries/import')) {
				importRequests.push(req);
			}
		});

		await loginAsAdmin(page);
		await page.goto(ENTRIES_PAGE);
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		const dialog = page.getByRole('dialog', {
			name: 'Import Financial Entries',
		});
		const fileInput = dialog.locator('input[type="file"]');
		const importButton = dialog.getByRole('button', {
			name: 'Import',
			exact: true,
		});
		await expect(importButton).toBeDisabled();

		// A truncated workbook: an error, no preview, nothing to import.
		await fileInput.setInputFiles({
			name: 'broken.xlsx',
			mimeType:
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			buffer: WORKBOOK.subarray(0, 400),
		});
		await expect(dialog.getByText('Failed to parse file.')).toBeVisible();
		await expect(dialog.getByText('Preview')).toHaveCount(0);
		await expect(dialog.getByText('Parsing file...')).toHaveCount(0);
		await expect(importButton).toBeDisabled();

		// The valid export replaces the error with its preview.
		await fileInput.setInputFiles({
			name: `bank-${KEY}.xlsx`,
			mimeType:
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			buffer: WORKBOOK,
		});
		await expect(dialog.getByText('Preview')).toBeVisible();
		await expect(dialog.getByText('Failed to parse file.')).toHaveCount(0);
		for (const entry of IMPORTED) {
			await expect(
				dialog.getByRole('row', { name: new RegExp(entry.description) })
			).toContainText(entry.entry_date);
		}
		expect(importRequests).toHaveLength(0);

		await importButton.click();
		await expect(
			dialog.getByText(
				'Imported 3 entries, skipped 0 (duplicates or errors).'
			)
		).toBeVisible();
		expect(importRequests).toHaveLength(1);

		// The saved entries are exactly what the export states.
		const saved = await importedEntries();
		expect(
			saved.map((entry) => ({
				entry_date: entry.entry_date,
				description: entry.description,
				amount: Number(entry.amount),
				entry_type: entry.entry_type,
				external_reference: entry.external_reference,
			}))
		).toEqual(IMPORTED);
		for (const entry of saved) {
			expect(entry.import_source).toBe(`bank-${KEY}.xlsx`);
		}
	});

	test('previews a settlement CSV and matches it to a bank entry after a broken file', async ({
		page,
	}) => {
		const seeded = await api.post(SEED, {
			headers: adminHeaders,
			data: {
				key: KEY,
				transactions: [
					{
						amount: 25,
						status: 'paid',
						description: `${KEY} ticket A`,
						created_at: '2026-05-01 10:00:00',
					},
					{
						amount: 15,
						status: 'paid',
						description: `${KEY} ticket B`,
						created_at: '2026-05-01 10:05:00',
					},
				],
			},
		});
		expect(seeded.ok(), await seeded.text()).toBeTruthy();
		const transactionIds = (await seeded.json()).transaction_ids;

		const created = await api.post(ENTRIES_API, {
			headers: adminHeaders,
			data: {
				amount: 38.13,
				entry_type: 'income',
				entry_date: '2026-05-04',
				description: PAYOUT_DESCRIPTION,
			},
		});
		expect(created.ok(), await created.text()).toBeTruthy();
		const entryId = (await created.json()).id;

		const reference = `E2EIMP.${KEY}`;
		const csv = [
			'Date,Payment method,Currency,Amount,Status,ID,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded',
			`2026-05-01 10:00:00,ideal,EUR,25.00,paid,tr_tf${KEY}n0,Ticket A,Jane Example,NL00BANK0123456789,,EUR,25.00,${reference},`,
			`2026-05-01 10:05:00,ideal,EUR,15.00,paid,tr_tf${KEY}n1,Ticket B,,,,EUR,15.00,${reference},`,
			`,,EUR,-1.87,,,Transaction fees ideal,,,,EUR,-1.87,${reference},`,
			'',
		].join('\n');

		const previewRequests = [];
		page.on('request', (req) => {
			if (req.url().includes('/reconciliation/settlement/preview')) {
				previewRequests.push(req);
			}
		});

		await loginAsAdmin(page);
		await page.goto(RECONCILIATION_PAGE);
		await page
			.getByRole('button', { name: 'Import settlement CSV' })
			.click();
		const dialog = page.getByRole('dialog', {
			name: 'Import Mollie Settlement CSV',
		});
		const fileInput = dialog.locator('input[type="file"]');
		const confirmButton = dialog.getByRole('button', {
			name: 'Confirm Match',
		});
		await expect(confirmButton).toBeDisabled();

		// Not a settlement export: an error, and nothing is sent for matching.
		await fileInput.setInputFiles({
			name: 'other.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from('Name,Amount\nSomeone,10\n', 'utf8'),
		});
		await expect(
			dialog.getByText(
				'This does not look like a Mollie settlement export (missing expected columns).'
			)
		).toBeVisible();
		await expect(dialog.getByText('Parsing file…')).toHaveCount(0);
		await expect(confirmButton).toBeDisabled();
		expect(previewRequests).toHaveLength(0);

		// The settlement export replaces the error with its report.
		await fileInput.setInputFiles({
			name: 'settlement.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(csv, 'utf8'),
		});
		await expect(
			dialog.getByRole('heading', { name: `Settlement ${reference}` })
		).toBeVisible();
		await expect(
			dialog.getByText('This does not look like a Mollie settlement', {
				exact: false,
			})
		).toHaveCount(0);
		expect(previewRequests).toHaveLength(1);
		expect(previewRequests[0].postDataJSON()).toEqual({
			settlement_reference: reference,
			currency: 'EUR',
			payment_rows: [
				{
					mollie_payment_id: `tr_tf${KEY}n0`,
					amount: 25,
					status: 'paid',
					description: 'Ticket A',
					settlement_amount: 25,
				},
				{
					mollie_payment_id: `tr_tf${KEY}n1`,
					amount: 15,
					status: 'paid',
					description: 'Ticket B',
					settlement_amount: 15,
				},
			],
			fee_rows: [
				{ description: 'Transaction fees ideal', amount: -1.87 },
			],
			settlement_total: 25 + 15 - 1.87,
		});

		await expect(
			dialog.locator('p', { hasText: 'Payments matched:' })
		).toContainText('2 / 2');
		await expect(
			dialog.locator('p', { hasText: 'Settlement total:' })
		).toContainText('€38.13');
		await expect(dialog.getByLabel('Match to bank entry')).toHaveValue(
			String(entryId)
		);

		await confirmButton.click();
		await expect(
			dialog.getByText('Settlement matched successfully.')
		).toBeVisible();

		const matched = await api.get(`${ENTRIES_API}/${entryId}`, {
			headers: adminHeaders,
		});
		expect(matched.ok(), await matched.text()).toBeTruthy();
		expect(
			((await matched.json()).transaction_ids || []).map(Number).sort()
		).toEqual([...transactionIds].sort());
	});
});
