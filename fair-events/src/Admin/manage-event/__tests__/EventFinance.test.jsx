/**
 * @jest-environment jsdom
 *
 * Component tests for the Finance tab double-counting fix (#1337).
 *
 * fair-finance FinancialEntry rows that have been reconciliation-matched to a
 * fair-payments-connector Transaction must be excluded from the totals/entries
 * fetched here (via `unmatched=true`), since the matched transaction's gross
 * amount already covers that income.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventFinance from '../EventFinance.js';

jest.mock('@wordpress/api-fetch');

const paidTransaction = {
	id: 1,
	amount: 45,
	mollie_fee: 0.79,
	application_fee: 0,
	status: 'paid',
	created_at: '2026-07-20 10:00:00',
};

const unmatchedIncomeEntry = {
	id: 5,
	entry_type: 'income',
	entry_date: '2026-07-19',
	amount: 30,
	description: 'Sponsorship',
};

function mockApiFetchByPath({
	totals = { total_income: 0, total_cost: 0, balance: 0 },
	entries = [],
	paidTransactions = [],
} = {}) {
	apiFetch.mockImplementation(({ path }) => {
		if (path.startsWith('/fair-finance/v1/financial-entries/totals')) {
			expect(path).toContain('unmatched=true');
			return Promise.resolve(totals);
		}
		if (path.startsWith('/fair-finance/v1/financial-entries')) {
			expect(path).toContain('unmatched=true');
			return Promise.resolve({ entries });
		}
		if (path.includes('status=paid')) {
			return Promise.resolve({ transactions: paidTransactions });
		}
		return Promise.resolve({ transactions: [] });
	});
}

afterEach(() => {
	jest.clearAllMocks();
});

function statValue(label) {
	return screen.getByText(label).previousSibling.textContent;
}

describe('EventFinance — reconciled entries are not double-counted (#1337)', () => {
	it('reports Total Income as only the gross transaction amount when the matching entry is excluded', async () => {
		// Simulates the backend already filtering out the matched entry via
		// unmatched=true — totals only reflect the paid transaction.
		mockApiFetchByPath({
			totals: { total_income: 0, total_cost: 0, balance: 0 },
			paidTransactions: [paidTransaction],
		});

		render(<EventFinance eventDateId={42} entriesUrl="admin.php" />);

		await waitFor(() =>
			expect(screen.getByText('Total Income')).toBeInTheDocument()
		);

		expect(statValue('Total Income')).toBe('€45.00');
	});

	it('still includes an unmatched manual entry in totals and the entries table', async () => {
		mockApiFetchByPath({
			totals: { total_income: 30, total_cost: 0, balance: 30 },
			entries: [unmatchedIncomeEntry],
			paidTransactions: [],
		});

		render(<EventFinance eventDateId={42} entriesUrl="admin.php" />);

		await waitFor(() =>
			expect(screen.getByText('Sponsorship')).toBeInTheDocument()
		);

		expect(statValue('Total Income')).toBe('€30.00');
	});

	it('requests both fair-finance endpoints with unmatched=true', async () => {
		mockApiFetchByPath({});

		render(<EventFinance eventDateId={42} entriesUrl="admin.php" />);

		await waitFor(() => expect(apiFetch).toHaveBeenCalled());

		const calledPaths = apiFetch.mock.calls.map((call) => call[0].path);
		const totalsCall = calledPaths.find((p) =>
			p.startsWith('/fair-finance/v1/financial-entries/totals')
		);
		const entriesCall = calledPaths.find(
			(p) =>
				p.startsWith('/fair-finance/v1/financial-entries?') ||
				(p.startsWith('/fair-finance/v1/financial-entries') &&
					!p.includes('/totals'))
		);
		expect(totalsCall).toContain('unmatched=true');
		expect(entriesCall).toContain('unmatched=true');
	});

	it('still computes Total Net from paid-transaction fee data', async () => {
		mockApiFetchByPath({
			totals: { total_income: 0, total_cost: 0, balance: 0 },
			paidTransactions: [paidTransaction],
		});

		render(<EventFinance eventDateId={42} entriesUrl="admin.php" />);

		await waitFor(() =>
			expect(screen.getByText('Total Net')).toBeInTheDocument()
		);

		// 45 - 0.79 mollie fee - 0 application fee = 44.21
		expect(statValue('Total Net')).toBe('€44.21');
	});
});
