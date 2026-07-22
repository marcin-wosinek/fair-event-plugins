/**
 * @jest-environment jsdom
 *
 * Component tests for the signups-tab CSV export (#1171).
 *
 * Exercises:
 *   - Download CSV button renders and produces a CSV matching what's shown.
 *   - Mailing opt-ins filter narrows the table rows and the exported CSV.
 *   - Comma-containing values are quoted per RFC 4180.
 *   - Empty state (no signups, or a filter matching nothing) disables the
 *     button instead of allowing a header-only download.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventSignups from '../EventSignups.js';

jest.mock('@wordpress/api-fetch');

const signups = [
	{
		id: 1,
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		ticket_type_id: 'General',
		quantity: 1,
		amount: '20.00',
		status: 'paid',
		mailing_opt_in: true,
		created_at: '2026-07-20 10:00:00',
	},
	{
		id: 2,
		name: 'Bob, Jr.',
		email: 'bob@example.com',
		ticket_type_id: 'General',
		quantity: 2,
		amount: '40.00',
		status: 'paid',
		mailing_opt_in: false,
		created_at: '2026-07-21 10:00:00',
	},
];

function mockObjectUrlAndClick() {
	let clickedFilename = null;
	let capturedText = null;
	const OriginalBlob = global.Blob;
	global.Blob = jest.fn(function (parts, options) {
		capturedText = parts.join('');
		return new OriginalBlob(parts, options);
	});
	global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
	global.URL.revokeObjectURL = jest.fn();
	const originalClick = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = jest.fn(function () {
		clickedFilename = this.download;
	});
	return {
		getFilename: () => clickedFilename,
		getText: () => capturedText,
		restore: () => {
			HTMLAnchorElement.prototype.click = originalClick;
			global.Blob = OriginalBlob;
		},
	};
}

async function renderSignups(data = signups) {
	apiFetch.mockResolvedValue(data);
	render(<EventSignups eventDateId={42} />);
	if (data.length > 0) {
		await waitFor(() =>
			expect(screen.getByText(data[0].name)).toBeInTheDocument()
		);
	} else {
		await waitFor(() =>
			expect(screen.getByText('No signups yet.')).toBeInTheDocument()
		);
	}
}

afterEach(() => {
	jest.clearAllMocks();
});

describe('EventSignups — CSV export (#1171)', () => {
	it('renders a Download CSV button', async () => {
		await renderSignups();
		expect(
			screen.getByRole('button', { name: 'Download CSV' })
		).toBeInTheDocument();
	});

	it('downloads a CSV with a header row and one row per displayed signup', async () => {
		await renderSignups();
		const mock = mockObjectUrlAndClick();

		fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

		const text = mock.getText();
		const lines = text.split('\r\n');
		expect(lines[0]).toBe(
			'email,name,ticket_type,quantity,amount,status,mailing_opt_in,date'
		);
		expect(lines).toHaveLength(3);
		expect(lines[1]).toBe(
			'ada@example.com,Ada Lovelace,General,1,20.00,paid,yes,2026-07-20 10:00:00'
		);
		expect(mock.getFilename()).toBe('signups-event-42.csv');

		mock.restore();
	});

	it('quotes a name containing a comma', async () => {
		await renderSignups();
		const mock = mockObjectUrlAndClick();

		fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

		const text = mock.getText();
		expect(text).toContain('"Bob, Jr."');

		mock.restore();
	});

	it('narrows the table and the export to mailing opt-ins when the filter is on', async () => {
		await renderSignups();
		const mock = mockObjectUrlAndClick();

		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Mailing opt-ins only' })
		);

		expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
		expect(screen.queryByText('Bob, Jr.')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));

		const text = mock.getText();
		const lines = text.split('\r\n');
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('ada@example.com');

		mock.restore();
	});

	it('disables the button and explains why when there are no signups at all', async () => {
		await renderSignups([]);

		const button = screen.getByRole('button', { name: 'Download CSV' });
		expect(button).toBeDisabled();
		expect(screen.getByText('No signups yet.')).toBeInTheDocument();
	});

	it('disables the button when the mailing filter matches nothing', async () => {
		await renderSignups([signups[1]]);

		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Mailing opt-ins only' })
		);

		const button = screen.getByRole('button', { name: 'Download CSV' });
		expect(button).toBeDisabled();
		expect(
			screen.getByText(
				'Nothing to export — no signups match the current filter.'
			)
		).toBeInTheDocument();
	});
});
