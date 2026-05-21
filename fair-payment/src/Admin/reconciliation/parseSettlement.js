/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Column headers expected in a Mollie settlement export. Matching is
 * case-insensitive and trimmed.
 */
const REQUIRED_HEADERS = ['id', 'settlement reference', 'amount', 'status'];

/**
 * Parse a numeric cell into a Number.
 *
 * Assumes dot-decimal formatting (as in the Mollie sample export). Currency
 * symbols, spaces, and thousands separators are stripped. Returns 0 for empty
 * or unparseable cells.
 *
 * @param {*} value Raw cell value.
 * @return {number} Parsed number.
 */
function parseNumber(value) {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0;
	}
	if (value === null || value === undefined) {
		return 0;
	}
	const cleaned = String(value).replace(/[^0-9.\-]/g, '');
	if (cleaned === '' || cleaned === '-' || cleaned === '.') {
		return 0;
	}
	const parsed = parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalize a header cell for comparison.
 *
 * @param {*} cell Raw header cell.
 * @return {string} Lowercased, trimmed string.
 */
function normalizeHeader(cell) {
	return typeof cell === 'string' ? cell.trim().toLowerCase() : '';
}

/**
 * Locate the header row and build a map of column name to column index.
 *
 * @param {Array<Array>} rows Array-of-arrays from XLSX.utils.sheet_to_json.
 * @return {{ headerRowIndex: number, columns: Object }} Header location and index map.
 */
function findHeader(rows) {
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!Array.isArray(row)) {
			continue;
		}

		const normalized = row.map(normalizeHeader);
		const hasAll = REQUIRED_HEADERS.every((header) =>
			normalized.includes(header)
		);

		if (hasAll) {
			const columns = {};
			normalized.forEach((name, index) => {
				if (name && !(name in columns)) {
					columns[name] = index;
				}
			});
			return { headerRowIndex: i, columns };
		}
	}

	return { headerRowIndex: -1, columns: {} };
}

/**
 * Parse the raw rows of a Mollie settlement CSV into a request body for the
 * settlement preview endpoint.
 *
 * Pure function (no FileReader/DOM) so it can be unit-tested. Throws an Error
 * with a translated message for files that are not a recognizable Mollie
 * settlement export.
 *
 * @param {Array<Array>} rows Array-of-arrays from XLSX.utils.sheet_to_json(sheet, { header: 1 }).
 * @return {Object} Parsed settlement: { settlement_reference, currency, payment_rows, fee_rows, settlement_total }.
 */
export function parseSettlementRows(rows) {
	if (!Array.isArray(rows) || rows.length === 0) {
		throw new Error(
			__('The file is empty or could not be read.', 'fair-payment')
		);
	}

	const { headerRowIndex, columns } = findHeader(rows);
	if (headerRowIndex === -1) {
		throw new Error(
			__(
				'This does not look like a Mollie settlement export (missing expected columns).',
				'fair-payment'
			)
		);
	}

	const idCol = columns.id;
	const amountCol = columns.amount;
	const statusCol = columns.status;
	const descriptionCol = columns.description;
	const settlementRefCol = columns['settlement reference'];
	const settlementAmountCol = columns['settlement amount'];
	const currencyCol = columns.currency;

	const paymentRows = [];
	const feeRows = [];
	const references = new Set();
	const currencies = new Set();
	let settlementTotal = 0;

	for (let i = headerRowIndex + 1; i < rows.length; i++) {
		const row = rows[i];
		if (!Array.isArray(row) || row.length === 0) {
			continue;
		}

		const id =
			typeof row[idCol] === 'string'
				? row[idCol].trim()
				: row[idCol]
				? String(row[idCol]).trim()
				: '';
		const amount = parseNumber(row[amountCol]);
		const status =
			statusCol !== undefined && row[statusCol] !== undefined
				? String(row[statusCol]).trim()
				: '';
		const description =
			descriptionCol !== undefined && row[descriptionCol] !== undefined
				? String(row[descriptionCol]).trim()
				: '';
		const settlementAmount =
			settlementAmountCol !== undefined
				? parseNumber(row[settlementAmountCol])
				: 0;

		const reference =
			settlementRefCol !== undefined &&
			row[settlementRefCol] !== undefined
				? String(row[settlementRefCol]).trim()
				: '';
		if (reference) {
			references.add(reference);
		}

		if (currencyCol !== undefined && row[currencyCol] !== undefined) {
			const currency = String(row[currencyCol]).trim();
			if (currency) {
				currencies.add(currency);
			}
		}

		// Skip fully blank rows (no id, no amount, no settlement amount).
		if (id === '' && amount === 0 && settlementAmount === 0) {
			continue;
		}

		settlementTotal += settlementAmount;

		if (id.startsWith('tr_')) {
			paymentRows.push({
				mollie_payment_id: id,
				amount,
				status,
				description,
				settlement_amount: settlementAmount,
			});
		} else if (id === '' && amount !== 0) {
			feeRows.push({
				description,
				amount,
			});
		}
		// Other rows (refunds, chargebacks) are not matched here but still
		// contribute to settlement_total above.
	}

	if (references.size === 0) {
		throw new Error(
			__('No settlement reference found in the file.', 'fair-payment')
		);
	}
	if (references.size > 1) {
		throw new Error(
			__(
				'The file contains multiple settlement references. Upload one settlement at a time.',
				'fair-payment'
			)
		);
	}
	if (currencies.size > 1) {
		throw new Error(
			__(
				'The file contains multiple currencies. Upload one settlement at a time.',
				'fair-payment'
			)
		);
	}

	if (paymentRows.length === 0) {
		throw new Error(
			__('No payment rows found in the settlement file.', 'fair-payment')
		);
	}

	return {
		settlement_reference: references.values().next().value,
		currency: currencies.size === 1 ? currencies.values().next().value : '',
		payment_rows: paymentRows,
		fee_rows: feeRows,
		settlement_total: settlementTotal,
	};
}
