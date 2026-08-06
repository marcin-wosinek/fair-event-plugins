/**
 * @jest-environment jsdom
 *
 * Wiring tests for DuplicateEventWizard (#1330): the Tickets step now
 * embeds fair-events' unified EventTickets component (imported cross-plugin)
 * instead of a second, drifted copy. Exercises:
 *   - The Tickets step is included only when enabledFeatures.ticketing is on.
 *   - isSeries (derived from the wizard's own recurrence state, not the
 *     source event's rrule) reaches EventTickets so series-only UI shows up.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import DuplicateEventWizard from '../DuplicateEventWizard.js';

jest.mock('@wordpress/api-fetch');

beforeEach(() => {
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	apiFetch.mockImplementation(({ path }) => {
		if (path?.includes('/tickets')) {
			return Promise.resolve({
				capacity: null,
				ticket_types: [],
				sale_periods: [],
				prices: [],
				settings: {},
				options: [],
			});
		}
		// venues, sources/categories, and anything else: empty list.
		return Promise.resolve([]);
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

// WP component size-deprecation notices (SelectControl/FormTokenField
// missing __next40pxDefaultSize, pre-existing and unrelated to this wizard)
// fire unpredictably across these tests depending on which step renders
// first — consume whatever fired rather than asserting an exact count.
function consumeExpectedWarnings() {
	console.warn.mockClear();
	console.error.mockClear();
}

const baseSourceEventDate = {
	title: 'Source Event',
	start_datetime: '2026-03-01 10:00:00',
	end_datetime: '2026-03-01 12:00:00',
	all_day: false,
	linked_posts: [
		{ id: 1, title: 'Linked Post', status: 'draft', is_primary: true },
	],
};

function renderWizard(props = {}) {
	return render(
		<DuplicateEventWizard
			sourceEventDate={baseSourceEventDate}
			sourceEventDateId={42}
			audienceUrl=""
			manageEventUrl="admin.php?page=fair-events-manage-event"
			onCancel={() => {}}
			enabledFeatures={{ ticketing: true }}
			{...props}
		/>
	);
}

describe('DuplicateEventWizard — Tickets step gating on enabledFeatures.ticketing (#1330)', () => {
	it('includes the Tickets step when ticketing is enabled', async () => {
		renderWizard({ enabledFeatures: { ticketing: true } });
		// event-details + links + tickets = 3 steps.
		expect(
			await screen.findByText(/Step 1 \/ 3: Event Details/)
		).toBeInTheDocument();
		consumeExpectedWarnings();
	});

	it('omits the Tickets step when ticketing is disabled', async () => {
		renderWizard({ enabledFeatures: { ticketing: false } });
		// event-details + links only = 2 steps.
		expect(
			await screen.findByText(/Step 1 \/ 2: Event Details/)
		).toBeInTheDocument();
		consumeExpectedWarnings();
	});

	it('omits the Tickets step when enabledFeatures is empty (fail-closed)', async () => {
		renderWizard({ enabledFeatures: {} });
		expect(
			await screen.findByText(/Step 1 \/ 2: Event Details/)
		).toBeInTheDocument();
		consumeExpectedWarnings();
	});
});

describe('DuplicateEventWizard — isSeries flows from wizard recurrence state (#1330)', () => {
	it('shows the ticket editor’s Scope column when the source event is recurring', async () => {
		renderWizard({
			sourceEventDate: {
				...baseSourceEventDate,
				rrule: 'FREQ=WEEKLY;COUNT=5',
			},
		});
		await screen.findByText(/Step 1 \/ 3: Event Details/);

		// Step 1 (Event Details) -> Step 2 (Links) -> Step 3 (Tickets).
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			await screen.findByText(/Step 3 \/ 3: Tickets/)
		).toBeInTheDocument();
		expect(await screen.findByText('Scope')).toBeInTheDocument();
		consumeExpectedWarnings();
	});

	it('hides the Scope column for a non-recurring source event', async () => {
		renderWizard();
		await screen.findByText(/Step 1 \/ 3: Event Details/);

		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));

		expect(
			await screen.findByText(/Step 3 \/ 3: Tickets/)
		).toBeInTheDocument();
		expect(screen.queryByText('Scope')).not.toBeInTheDocument();
		consumeExpectedWarnings();
	});
});
