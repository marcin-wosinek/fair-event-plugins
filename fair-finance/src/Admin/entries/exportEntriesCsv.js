/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Escapes a single CSV field value.
 *
 * Quotes fields containing commas, double-quotes, or newlines.
 * Prefixes fields starting with = + - @ to prevent spreadsheet formula injection.
 */
export const escapeCsvField = (field) => {
	const str = String(field ?? '');

	// CSV injection: prefix formula-starting chars with a single quote.
	const safe = str.length > 0 && '=+-@'.includes(str[0]) ? "'" + str : str;

	if (safe.includes(',') || safe.includes('"') || safe.includes('\n')) {
		return '"' + safe.replace(/"/g, '""') + '"';
	}
	return safe;
};

/**
 * Builds a CSV string (with UTF-8 BOM) from an array of financial entries.
 *
 * @param {Array}  entries Entries returned by /fair-finance/v1/financial-entries.
 * @param {Array}  budgets Budgets array (id, name) for resolving budget names.
 */
export const buildEntriesCsv = (entries, budgets) => {
	const budgetMap = Object.fromEntries(
		(budgets || []).map((b) => [String(b.id), b.name])
	);

	const headers = [
		__('Date', 'fair-payments-connector'),
		__('Type', 'fair-payments-connector'),
		__('Amount', 'fair-payments-connector'),
		__('Description', 'fair-payments-connector'),
		__('Budget', 'fair-payments-connector'),
		__('Event Date', 'fair-payments-connector'),
		__('Imported', 'fair-payments-connector'),
	];

	const rows = entries.map((entry) => [
		entry.entry_date ?? '',
		entry.entry_type ?? '',
		entry.amount ?? '',
		entry.description ?? '',
		entry.budget_id ? budgetMap[String(entry.budget_id)] ?? '' : '',
		entry.event_date_id ?? '',
		entry.imported_at ?? '',
	]);

	const csvContent = [
		headers.map(escapeCsvField).join(','),
		...rows.map((row) => row.map(escapeCsvField).join(',')),
	].join('\n');

	// BOM for UTF-8 Excel compatibility.
	return '﻿' + csvContent;
};

/**
 * Triggers a browser download of the given CSV string.
 *
 * @param {string} csvContent Full CSV text (including BOM if needed).
 * @param {string} filename   Suggested download filename.
 */
export const downloadCsv = (csvContent, filename) => {
	const blob = new Blob([csvContent], {
		type: 'text/csv;charset=utf-8;',
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
};
