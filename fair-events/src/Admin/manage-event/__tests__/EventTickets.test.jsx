/**
 * @jest-environment jsdom
 *
 * Component tests for the recurrence-scope selector in EventTickets (#663, #935).
 *
 * Exercises:
 *   - Scope column is visible only when isRecurring={true}.
 *   - "+ Add Ticket Type" on a recurring event opens a scope-choice modal.
 *   - A new ticket type is seeded with the scope chosen in the modal.
 *   - Scope cell is read-only text when has_sales is true.
 *   - Scope cell is an editable SelectControl when has_sales is false.
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

describe('EventTickets — empty state (no advanced tickets)', () => {
	it('renders the empty state with a "+ Add Ticket Type" button', () => {
		renderTickets({ initialData: emptyInitialData });
		expect(
			screen.getByText(/No ticket types configured yet/i)
		).toBeInTheDocument();
		// The empty-state card and the (collapsed) Edit tickets table footer
		// both expose a "+ Add Ticket Type" affordance.
		expect(
			screen.getAllByRole('button', { name: '+ Add Ticket Type' }).length
		).toBeGreaterThanOrEqual(1);
	});

	it('does not render a Signup price field', () => {
		renderTickets({ initialData: emptyInitialData });
		expect(screen.queryByText(/Signup price/i)).not.toBeInTheDocument();
	});

	it('does not render a simple/advanced ticketing toggle', () => {
		renderTickets({ initialData: emptyInitialData });
		expect(
			screen.queryByRole('button', {
				name: /Switch to simple ticketing/i,
			})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {
				name: /Switch to advanced ticketing/i,
			})
		).not.toBeInTheDocument();
	});

	it('opens the advanced editor when "+ Add Ticket Type" is clicked from the empty state', () => {
		renderTickets({ initialData: emptyInitialData });
		const addButton = screen.getByRole('button', {
			name: '+ Add Ticket Type',
		});
		fireEvent.click(addButton);
		// Adding a ticket type flips hasAdvancedTickets true: the empty-state
		// message is gone and the pricing grid header appears.
		expect(
			screen.queryByText(/No ticket types configured yet/i)
		).not.toBeInTheDocument();
		expect(screen.getByText('Ticket Prices')).toBeInTheDocument();
	});
});

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

		// On a recurring event the button opens the scope-choice modal.
		const confirmButton = screen.getByRole('button', {
			name: /add ticket type/i,
		});
		fireEvent.click(confirmButton);

		// A second Scope combobox should appear (one per ticket type row).
		const scopeSelects = screen
			.getAllByRole('combobox')
			.filter(
				(el) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		// Both rows (original + new) should be single_instance.
		expect(scopeSelects.length).toBeGreaterThanOrEqual(2);
		scopeSelects.forEach((el) => expect(el.value).toBe('single_instance'));
	});

	it('changing scope selector to whole_series updates the combobox value', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) =>
				el.value === 'single_instance' || el.value === 'whole_series'
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
			(el) =>
				el.value === 'single_instance' || el.value === 'whole_series'
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

describe('EventTickets — scope-choice modal', () => {
	it('opens a modal when "+ Add Ticket Type" is clicked on a recurring event', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		expect(screen.getByText('Choose ticket scope')).toBeInTheDocument();
		expect(screen.getByLabelText(/This instance/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/Whole series/i)).toBeInTheDocument();
	});

	it('does not open a modal on a non-recurring event', () => {
		renderTickets({
			isRecurring: false,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		expect(
			screen.queryByText('Choose ticket scope')
		).not.toBeInTheDocument();
	});

	it('adds a whole_series ticket when that option is chosen in the modal', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		fireEvent.click(screen.getByLabelText(/Whole series/i));
		fireEvent.click(
			screen.getByRole('button', { name: /add ticket type/i })
		);

		const scopeSelects = screen
			.getAllByRole('combobox')
			.filter(
				(el) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		const newRow = scopeSelects[scopeSelects.length - 1];
		expect(newRow.value).toBe('whole_series');
	});
});

const initialDataWithSoldTicketType = {
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
			recurrence_scope: 'whole_series',
			sort_order: 0,
			has_sales: true,
		},
	],
};

describe('EventTickets — scope lock when has_sales', () => {
	it('renders scope as read-only text when has_sales is true', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithSoldTicketType,
		});
		openEditTicketsPanel();

		expect(screen.getByText('Whole series')).toBeInTheDocument();
		const scopeSelects = screen
			.queryAllByRole('combobox')
			.filter(
				(el) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		expect(scopeSelects.length).toBe(0);
	});

	it('renders scope as SelectControl when has_sales is false', () => {
		renderTickets({
			isRecurring: true,
			initialData: initialDataWithTicketType,
		});
		openEditTicketsPanel();

		const scopeSelects = screen
			.getAllByRole('combobox')
			.filter(
				(el) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		expect(scopeSelects.length).toBeGreaterThanOrEqual(1);
	});
});

describe('EventTickets — disable/enable when has_sales', () => {
	it('shows Remove button when has_sales is false', () => {
		renderTickets({ initialData: initialDataWithTicketType });
		openEditTicketsPanel();
		expect(
			screen.getByRole('button', { name: /Remove/i })
		).toBeInTheDocument();
	});

	it('shows toggle instead of Remove when has_sales is true', () => {
		renderTickets({ initialData: initialDataWithSoldTicketType });
		openEditTicketsPanel();
		expect(
			screen.queryByRole('button', { name: /Remove/i })
		).not.toBeInTheDocument();
		expect(screen.getByRole('checkbox')).toBeInTheDocument();
	});

	it('shows disabled label when ticket type is disabled', () => {
		const disabledData = {
			...emptyInitialData,
			ticket_types: [
				{
					...initialDataWithSoldTicketType.ticket_types[0],
					disabled: true,
				},
			],
		};
		renderTickets({ initialData: disabledData });
		openEditTicketsPanel();
		expect(
			screen.getByText('Disabled — no longer on sale')
		).toBeInTheDocument();
	});

	it('does not show disabled label when ticket type is enabled', () => {
		renderTickets({ initialData: initialDataWithSoldTicketType });
		openEditTicketsPanel();
		expect(
			screen.queryByText('Disabled — no longer on sale')
		).not.toBeInTheDocument();
	});

	it('toggling disable updates the disabled field in the save payload', async () => {
		const { onSaveRef } = renderTickets({
			initialData: initialDataWithSoldTicketType,
		});
		openEditTicketsPanel();
		const toggle = screen.getByRole('checkbox');
		fireEvent.click(toggle);

		let savedPayload = null;
		apiFetch.mockImplementation(({ method, data }) => {
			if (method === 'PUT') {
				savedPayload = data;
				return Promise.resolve({
					...initialDataWithSoldTicketType,
					ticket_types: [],
				});
			}
			return new Promise(() => {});
		});

		await act(async () => {
			await onSaveRef.current();
		});

		expect(savedPayload?.ticket_types?.[0]?.disabled).toBe(true);
	});
});
