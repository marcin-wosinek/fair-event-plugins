/**
 * @jest-environment jsdom
 *
 * Component tests for the recurrence-scope selector in EventTickets (#663).
 *
 * Exercises:
 *   - Scope column is visible only when isRecurring={true}.
 *   - A new ticket type is seeded with recurrence_scope 'single_instance'.
 *   - Changing the selector updates the save payload's recurrence_scope.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventTickets from '../EventTickets.js';

jest.mock('@wordpress/api-fetch');

// Suppress WordPress component deprecation warnings (TextControl / SelectControl
// __next40pxDefaultSize) so they don't block assertions via @wordpress/jest-console.
beforeEach(() => {
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	// Return never-resolving promises for background apiFetch calls (groups,
	// participants, group-pricing-rules) so they don't fire async state updates
	// outside act() after assertions complete.
	apiFetch.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

const emptyInitialData = {
	capacity: null,
	signup_price: null,
	ticket_types: [],
	sale_periods: [],
	prices: [],
	settings: {},
	options: [],
};

const initialDataWithTicketType = {
	...emptyInitialData,
	ticket_types: [
		{
			id: 1,
			name: 'General',
			capacity: null,
			seats_per_ticket: 1,
			invitation_only: false,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			sort_order: 0,
		},
	],
};

function renderTickets(extraProps = {}) {
	const onSaveRef = { current: null };
	render(
		<EventTickets
			eventDateId={99}
			onSaveRef={onSaveRef}
			initialData={emptyInitialData}
			onDataRef={null}
			{...extraProps}
		/>
	);
	return { onSaveRef };
}

function openEditTicketsPanel() {
	const panelButton = screen.getByRole('button', {
		name: /Edit tickets/i,
	});
	fireEvent.click(panelButton);
}

describe('EventTickets — recurrence scope selector', () => {
	it('shows Scope column when isRecurring is true', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();
		expect(screen.getByText('Scope')).toBeInTheDocument();
		// Acknowledge WordPress TextControl / SelectControl size deprecation
		// notices emitted the first time those component types render in the suite.
		expect(console).toHaveWarned();
	});

	it('does not show Scope column when isRecurring is false', () => {
		renderTickets({
			isRecurring: false,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();
		expect(screen.queryByText('Scope')).not.toBeInTheDocument();
	});

	it('does not show Scope column when isRecurring is omitted', () => {
		renderTickets({ initialData: initialDataWithTicketType });
		openEditTicketsPanel();
		expect(screen.queryByText('Scope')).not.toBeInTheDocument();
	});

	it('new ticket type is seeded with recurrence_scope single_instance', () => {
		renderTickets({
			isRecurring: true,
			// Start with a ticket type so hasAdvancedTickets = true and the
			// "+ Add Ticket Type" button is visible in the table footer.
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		const addButton = screen.getByRole('button', {
			name: '+ Add Ticket Type',
		});
		fireEvent.click(addButton);

		// A second Scope combobox should appear (one per ticket type row).
		const scopeSelects = screen.getAllByRole('combobox').filter(
			(el) => el.value === 'single_instance' || el.value === 'whole_series'
		);
		// Both rows (original + new) should be single_instance.
		expect(scopeSelects.length).toBeGreaterThanOrEqual(2);
		scopeSelects.forEach((el) =>
			expect(el.value).toBe('single_instance')
		);
	});

	it('changing scope selector to whole_series updates the combobox value', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) => el.value === 'single_instance' || el.value === 'whole_series'
		);
		expect(scopeSelect).toBeTruthy();
		expect(scopeSelect.value).toBe('single_instance');

		fireEvent.change(scopeSelect, { target: { value: 'whole_series' } });
		expect(scopeSelect.value).toBe('whole_series');
	});

	it('save payload includes updated recurrence_scope', async () => {
		const { onSaveRef } = renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		// Change scope to whole_series.
		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) => el.value === 'single_instance' || el.value === 'whole_series'
		);
		fireEvent.change(scopeSelect, { target: { value: 'whole_series' } });

		// Capture the PUT payload on save.
		let savedPayload = null;
		apiFetch.mockImplementation(({ method, data }) => {
			if (method === 'PUT') {
				savedPayload = data;
				return Promise.resolve({
					...initialDataWithTicketType,
					ticket_types: [],
				});
			}
			return new Promise(() => {});
		});

		expect(onSaveRef.current).not.toBeNull();
		await act(async () => {
			await onSaveRef.current();
		});

		expect(savedPayload).not.toBeNull();
		const savedType = savedPayload.ticket_types?.[0];
		expect(savedType).toBeTruthy();
		expect(savedType.recurrence_scope).toBe('whole_series');
	});
});
