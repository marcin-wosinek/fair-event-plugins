/**
 * Parse a Mollie payments CSV export into the transaction import shape.
 *
 * @param {string} text Raw CSV file contents.
 * @return {Array<Object>} Parsed transactions keyed by mollie_payment_id.
 */
export const parseMollieCsv = (text) => {
	const lines = text.split('\n').filter((line) => line.trim());
	if (lines.length < 2) {
		return [];
	}

	const parseRow = (line) => {
		const values = [];
		let current = '';
		let inQuotes = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '"') {
				inQuotes = !inQuotes;
			} else if (ch === ',' && !inQuotes) {
				values.push(current);
				current = '';
			} else {
				current += ch;
			}
		}
		values.push(current);
		return values;
	};

	const headers = parseRow(lines[0]);
	const idxId = headers.indexOf('ID');
	const idxAmount = headers.indexOf('Amount');
	const idxCurrency = headers.indexOf('Currency');
	const idxStatus = headers.indexOf('Status');
	const idxDescription = headers.indexOf('Description');
	const idxDate = headers.indexOf('Date');

	if (idxId === -1) {
		return [];
	}

	const mollieStatusMap = {
		paidout: 'paid',
		paid: 'paid',
		open: 'open',
		failed: 'failed',
		canceled: 'canceled',
		expired: 'expired',
		refunded: 'refunded',
		charged_back: 'charged_back',
	};

	return lines
		.slice(1)
		.map((line) => {
			const values = parseRow(line);
			const rawStatus = (values[idxStatus] || '').toLowerCase();
			return {
				mollie_payment_id: values[idxId] || '',
				amount: parseFloat(values[idxAmount]) || 0,
				currency: values[idxCurrency] || 'EUR',
				status: mollieStatusMap[rawStatus] || rawStatus,
				description:
					idxDescription !== -1 ? values[idxDescription] || '' : '',
				created_at: idxDate !== -1 ? values[idxDate] || '' : '',
			};
		})
		.filter((t) => t.mollie_payment_id);
};
