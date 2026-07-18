/**
 * @jest-environment jsdom
 *
 * Component tests for the recurrence-scope selector in EventTickets (#663, #935).
 *
 * Exercises:
 *   - Scope column is visible only when isSeries={true}.
 *   - "+ Add Ticket Type" on a recurring event opens a scope-choice modal.
 *   - A new ticket type is seeded with the scope chosen in the modal.
 *   - Scope cell is read-only text when has_sales is true.
 *   - Scope cell is an editable SelectControl when has_sales is false.
 *   - Changing the selector updates the save payload's recurrence_scope.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
	within,
} from '@testing-library/react';
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
	const { container } = render(
		<EventTickets
			eventDateId={99}
			onSaveRef={onSaveRef}
			initialData={emptyInitialData}
			onDataRef={null}
			{...extraProps}
		/>
	);
	return { onSaveRef, container };
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
		expect(screen.getByText('Ticket Type')).toBeInTheDocument();
	});
});

describe('EventTickets — recurrence scope selector', () => {
	it('shows Scope column when isSeries is true', () => {
		renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});
		expect(screen.getByText('Scope')).toBeInTheDocument();
		// Acknowledge WordPress TextControl / SelectControl size deprecation
		// notices emitted the first time those component types render in the suite.
		expect(console).toHaveWarned();
	});

	it('does not show Scope column when isSeries is false', () => {
		renderTickets({
			isSeries: false,
			initialData: initialDataWithTicketType,
		});
		expect(screen.queryByText('Scope')).not.toBeInTheDocument();
	});

	it('does not show Scope column when isSeries is omitted', () => {
		renderTickets({ initialData: initialDataWithTicketType });
		expect(screen.queryByText('Scope')).not.toBeInTheDocument();
	});

	it('new ticket type is seeded with recurrence_scope single_instance', () => {
		renderTickets({
			isSeries: true,
			// Start with a ticket type so hasAdvancedTickets = true and the
			// "+ Add Ticket Type" button is visible in the table footer.
			initialData: initialDataWithTicketType,
		});

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
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

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
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

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

describe('EventTickets — multiple_instances scope (#930)', () => {
	it('offers multiple_instances as a scope option', () => {
		renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		const optionValues = Array.from(scopeSelect.options).map(
			(o) => o.value
		);
		expect(optionValues).toContain('multiple_instances');
		// Acknowledge the WordPress SelectControl size deprecation notice —
		// only fires the first time it renders in the suite (deduped globally),
		// so only assert when this test actually triggered it.
		if (console.warn.mock.calls.length > 0) {
			expect(console).toHaveWarned();
		}
	});

	it('shows a "Minimum instances" input once multiple_instances is selected', () => {
		renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);

		expect(
			screen.queryByLabelText(/Minimum instances/i)
		).not.toBeInTheDocument();

		fireEvent.change(scopeSelect, {
			target: { value: 'multiple_instances' },
		});

		expect(scopeSelect.value).toBe('multiple_instances');
		expect(screen.getByLabelText(/Minimum instances/i)).toBeInTheDocument();
	});

	it('save payload includes the entered minimum_instances', async () => {
		const { onSaveRef } = renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

		const selects = screen.getAllByRole('combobox');
		const scopeSelect = selects.find(
			(el) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		fireEvent.change(scopeSelect, {
			target: { value: 'multiple_instances' },
		});

		const minInstancesInput = screen.getByLabelText(/Minimum instances/i);
		fireEvent.change(minInstancesInput, { target: { value: '3' } });

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
		expect(savedType.recurrence_scope).toBe('multiple_instances');
		expect(savedType.minimum_instances).toBe(3);
	});
});

describe('EventTickets — scope-choice modal', () => {
	it('opens a modal when "+ Add Ticket Type" is clicked on a recurring event', () => {
		renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		expect(screen.getByText('Choose ticket scope')).toBeInTheDocument();
		expect(screen.getByLabelText(/This instance/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/Whole series/i)).toBeInTheDocument();
	});

	it('does not open a modal on a non-recurring event', () => {
		renderTickets({
			isSeries: false,
			initialData: initialDataWithTicketType,
		});

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		expect(
			screen.queryByText('Choose ticket scope')
		).not.toBeInTheDocument();
	});

	it('adds a whole_series ticket when that option is chosen in the modal', () => {
		renderTickets({
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

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
			isSeries: true,
			initialData: initialDataWithSoldTicketType,
		});

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
			isSeries: true,
			initialData: initialDataWithTicketType,
		});

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
		expect(
			screen.getByRole('button', { name: /Remove/i })
		).toBeInTheDocument();
	});

	it('shows toggle instead of Remove when has_sales is true', () => {
		renderTickets({ initialData: initialDataWithSoldTicketType });
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
		expect(
			screen.getByText('Disabled — no longer on sale')
		).toBeInTheDocument();
	});

	it('does not show disabled label when ticket type is enabled', () => {
		renderTickets({ initialData: initialDataWithSoldTicketType });
		expect(
			screen.queryByText('Disabled — no longer on sale')
		).not.toBeInTheDocument();
	});

	it('toggling disable updates the disabled field in the save payload', async () => {
		const { onSaveRef } = renderTickets({
			initialData: initialDataWithSoldTicketType,
		});
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

describe('EventTickets — save button and dirty tracking (#987)', () => {
	it('renders its own "Save tickets" button', () => {
		renderTickets({ initialData: emptyInitialData });
		expect(
			screen.getByRole('button', { name: 'Save tickets' })
		).toBeInTheDocument();
	});

	it('reports dirty once a field changes, and clean again after save', async () => {
		const onDirtyChange = jest.fn();
		renderTickets({
			initialData: initialDataWithTicketType,
			onDirtyChange,
		});

		expect(onDirtyChange).toHaveBeenLastCalledWith(false);

		const nameInput = screen.getByDisplayValue('General');
		fireEvent.change(nameInput, { target: { value: 'General (edited)' } });

		expect(onDirtyChange).toHaveBeenLastCalledWith(true);

		apiFetch.mockImplementation(({ method }) => {
			if (method === 'PUT') {
				return Promise.resolve({
					...initialDataWithTicketType,
					ticket_types: [
						{
							...initialDataWithTicketType.ticket_types[0],
							name: 'General (edited)',
						},
					],
				});
			}
			return new Promise(() => {});
		});

		fireEvent.click(screen.getByRole('button', { name: 'Save tickets' }));

		await waitFor(() =>
			expect(onDirtyChange).toHaveBeenLastCalledWith(false)
		);
	});
});

describe('EventTickets — payments-unavailable notice (#988, #1177)', () => {
	const originalFairPaymentsConnector = window.fairPaymentsConnector;

	// A ticket type carrying a price > 0 through the prices map, so
	// hasPurchasablePrice is true and the warning is relevant.
	const initialDataWithPaidTicket = {
		...emptyInitialData,
		ticket_types: [initialDataWithTicketType.ticket_types[0]],
		sale_periods: [
			{ id: 10, name: '', sale_start: '', sale_end: '', sort_order: 0 },
		],
		prices: [
			{
				ticket_type_id: 1,
				sale_period_id: 10,
				price: 15,
				capacity: null,
			},
		],
	};

	// Only an add-on carries a price; no ticket-type price at all.
	const initialDataWithPaidAddon = {
		...emptyInitialData,
		ticket_types: [initialDataWithTicketType.ticket_types[0]],
		options: [
			{
				name: 'Dinner',
				short_name: '',
				price: 20,
				discounted_price: null,
				capacity: null,
				collaborator_ids: [],
				period_prices: [],
				sort_order: 0,
			},
		],
	};

	const mollieRegex =
		/Paid tickets won't be sold until Mollie payments are configured/i;
	const missingPluginRegex =
		/Paid tickets need the Fair Payments Connector plugin/i;

	afterEach(() => {
		window.fairPaymentsConnector = originalFairPaymentsConnector;
	});

	it('shows the Mollie notice when the connector is active but unconfigured and a price > 0', () => {
		window.fairPaymentsConnector = {
			connectorActive: true,
			paymentConfigured: false,
			settingsUrl:
				'http://example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
		};
		const { container } = renderTickets({
			initialData: initialDataWithPaidTicket,
		});

		expect(within(container).getByText(mollieRegex)).toBeInTheDocument();
		const link = within(container).getByRole('link', {
			name: 'Set up Mollie',
		});
		expect(link).toHaveAttribute(
			'href',
			window.fairPaymentsConnector.settingsUrl
		);
	});

	it('shows the missing-plugin notice when the connector is inactive and a price > 0', () => {
		window.fairPaymentsConnector = { currency: 'EUR' };
		const { container } = renderTickets({
			initialData: initialDataWithPaidTicket,
		});

		expect(
			within(container).getByText(missingPluginRegex)
		).toBeInTheDocument();
		// No settings link when the plugin isn't installed.
		expect(
			within(container).queryByRole('link', { name: 'Set up Mollie' })
		).not.toBeInTheDocument();
	});

	it('shows the notice for add-on-only pricing', () => {
		window.fairPaymentsConnector = { currency: 'EUR' };
		const { container } = renderTickets({
			initialData: initialDataWithPaidAddon,
		});

		expect(
			within(container).getByText(missingPluginRegex)
		).toBeInTheDocument();
	});

	it('does not show any notice when every price is 0', () => {
		window.fairPaymentsConnector = { currency: 'EUR' };
		const { container } = renderTickets({
			initialData: initialDataWithTicketType,
		});

		expect(
			within(container).queryByText(mollieRegex)
		).not.toBeInTheDocument();
		expect(
			within(container).queryByText(missingPluginRegex)
		).not.toBeInTheDocument();
	});

	it('does not show any notice when there are no tickets yet', () => {
		window.fairPaymentsConnector = { connectorActive: false };
		const { container } = renderTickets({ initialData: emptyInitialData });

		expect(
			within(container).queryByText(mollieRegex)
		).not.toBeInTheDocument();
		expect(
			within(container).queryByText(missingPluginRegex)
		).not.toBeInTheDocument();
	});

	it('does not show any notice when payments are configured', () => {
		window.fairPaymentsConnector = {
			connectorActive: true,
			paymentConfigured: true,
			settingsUrl:
				'http://example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
		};
		const { container } = renderTickets({
			initialData: initialDataWithPaidTicket,
		});

		expect(
			within(container).queryByText(mollieRegex)
		).not.toBeInTheDocument();
		expect(
			within(container).queryByText(missingPluginRegex)
		).not.toBeInTheDocument();
	});
});

describe('EventTickets — Export/Import moved to the ⋯ menu (#988)', () => {
	it('does not show Export/Import as primary buttons', () => {
		renderTickets({ initialData: initialDataWithTicketType });

		expect(
			screen.queryByRole('button', { name: 'Export ticket settings' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Import ticket settings' })
		).not.toBeInTheDocument();
	});

	it('reaches Export/Import through the ⋯ menu', () => {
		renderTickets({ initialData: initialDataWithTicketType });

		fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

		expect(
			screen.getByRole('menuitem', { name: 'Export ticket settings' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('menuitem', { name: 'Import ticket settings' })
		).toBeInTheDocument();
	});
});

describe('EventTickets — editable table renders without expanding a panel (#988)', () => {
	it('shows the editable ticket type field directly', () => {
		renderTickets({ initialData: initialDataWithTicketType });

		expect(screen.getByDisplayValue('General')).toBeInTheDocument();
	});
});

describe('EventTickets — single pricing period by default (#1138)', () => {
	const originalManageEventData = window.fairEventsManageEventData;

	afterEach(() => {
		window.fairEventsManageEventData = originalManageEventData;
	});

	const initialDataWithOnePeriod = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 501,
				name: '',
				sale_start: '2026-01-01',
				sale_end: '2026-02-01',
			},
		],
		prices: [
			{
				ticket_type_id: 1,
				sale_period_id: 501,
				price: '12',
			},
		],
	};

	const initialDataWithTwoPeriods = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 601,
				name: 'Advance ticket',
				sale_start: '2026-01-01',
				sale_end: '2026-01-15',
			},
			{
				id: 602,
				name: 'Day of event',
				sale_start: '2026-01-15',
				sale_end: '2026-02-01',
			},
		],
		prices: [
			{ ticket_type_id: 1, sale_period_id: 601, price: '20' },
			{ ticket_type_id: 1, sale_period_id: 602, price: '5' },
		],
		settings: { multiple_pricing_periods: false },
	};

	it('adding the first ticket type seeds exactly one sale period and shows a single Price column with no Available checkbox', () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		renderTickets({
			initialData: emptyInitialData,
			startDatetime: '2026-08-01 10:00:00',
			endDatetime: '2026-08-01 12:00:00',
		});

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);

		expect(
			screen.getAllByRole('columnheader', { name: 'Price' })
		).toHaveLength(1);
		expect(screen.queryByText('Available')).not.toBeInTheDocument();
	});

	it('adding a ticket type leaves the sale window unset (#1189) — no concrete dates are seeded', () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		renderTickets({
			initialData: emptyInitialData,
			startDatetime: '2020-01-01 10:00:00',
			endDatetime: '2020-01-01 12:00:00',
		});

		fireEvent.click(
			screen.getByRole('button', { name: '+ Add Ticket Type' })
		);
		fireEvent.click(screen.getByRole('button', { name: /Sale Periods/i }));

		// Nothing is frozen into the "From" field — the window stays unset
		// until the organiser explicitly picks a date.
		expect(screen.getByLabelText('From').value).toBe('');
	});

	it('turning on "Multiple pricing periods" splits the window into Advance ticket / Day of event and migrates the price', () => {
		renderTickets({
			initialData: initialDataWithOnePeriod,
			startDatetime: '2026-01-10 10:00:00',
			endDatetime: '2026-02-01 12:00:00',
		});

		fireEvent.click(screen.getByRole('button', { name: /More options/i }));
		fireEvent.click(
			screen.getByRole('checkbox', {
				name: /Multiple pricing periods/i,
			})
		);

		expect(screen.getByText('Advance ticket')).toBeInTheDocument();
		expect(screen.getByText('Day of event')).toBeInTheDocument();
		expect(screen.getByDisplayValue('12')).toBeInTheDocument();
	});

	it('turning off "Multiple pricing periods" with several periods asks for confirmation before merging', () => {
		renderTickets({ initialData: initialDataWithTwoPeriods });

		fireEvent.click(screen.getByRole('button', { name: /More options/i }));
		fireEvent.click(
			screen.getByRole('checkbox', {
				name: /Multiple pricing periods/i,
			})
		);

		expect(
			screen.getByText(/Merge to one sale window/i)
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Merge periods' }));

		expect(screen.queryByText('Advance ticket')).not.toBeInTheDocument();
		expect(screen.queryByText('Day of event')).not.toBeInTheDocument();
		expect(screen.getByDisplayValue('20')).toBeInTheDocument();
	});

	it('an event loaded with two stored periods renders in multi-period mode regardless of the stored toggle', () => {
		renderTickets({ initialData: initialDataWithTwoPeriods });

		expect(screen.getByText('Advance ticket')).toBeInTheDocument();
		expect(screen.getByText('Day of event')).toBeInTheDocument();
	});
});

describe('EventTickets — unset sale window shows the resolved default (#1189)', () => {
	const initialDataWithUnsetPeriod = {
		...initialDataWithTicketType,
		sale_periods: [{ id: 701, name: '', sale_start: '', sale_end: '' }],
		prices: [{ ticket_type_id: 1, sale_period_id: 701, price: '12' }],
	};

	it('a single event with an unset window shows the day after the event as the default, marked as a default', () => {
		renderTickets({
			initialData: initialDataWithUnsetPeriod,
			startDatetime: '2026-08-01 10:00:00',
			endDatetime: '2026-08-01 12:00:00',
		});

		fireEvent.click(screen.getByRole('button', { name: /Sale Periods/i }));

		// formatSaleDateLabel() renders a locale-formatted weekday/day/month —
		// assert on the "(default)" marker and August, not an exact ISO string.
		expect(
			screen.getByText(/until .*August.*\(default\)/)
		).toBeInTheDocument();
	});

	it("a series with an unset window resolves the default from the last occurrence, not the master's own end", () => {
		renderTickets({
			initialData: initialDataWithUnsetPeriod,
			startDatetime: '2026-08-01 10:00:00',
			endDatetime: '2026-08-01 12:00:00',
			lastOccurrenceDatetime: '2026-08-22 12:00:00',
			isSeries: true,
		});

		fireEvent.click(screen.getByRole('button', { name: /Sale Periods/i }));

		expect(
			screen.getByText(/until .*August.*\(default\)/)
		).toBeInTheDocument();
	});

	it('an explicit sale_end suppresses the "(default)" marker', () => {
		renderTickets({
			initialData: {
				...initialDataWithTicketType,
				sale_periods: [
					{
						id: 702,
						name: '',
						sale_start: '2026-08-01',
						sale_end: '2026-09-01',
					},
				],
				prices: [
					{ ticket_type_id: 1, sale_period_id: 702, price: '12' },
				],
			},
			startDatetime: '2026-08-01 10:00:00',
			endDatetime: '2026-08-01 12:00:00',
			lastOccurrenceDatetime: '2026-08-22 12:00:00',
		});

		fireEvent.click(screen.getByRole('button', { name: /Sale Periods/i }));

		expect(screen.getByText(/until .*September/)).toBeInTheDocument();
		expect(screen.queryByText(/\(default\)/)).not.toBeInTheDocument();
	});
});

describe('EventTickets — pricing an event with no stored prices (#1175)', () => {
	// A ticket type + sale period saved without any price. In single-period
	// mode the pricing cell is seeded enabled:false and there is no "Available"
	// checkbox to flip it, so a typed price must still reach the save payload.
	const initialDataUnpriced = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 701,
				name: '',
				sale_start: '2026-01-01',
				sale_end: '2026-02-01',
			},
		],
		prices: [],
	};

	// Same data, but multiple-periods mode is on so the "Available" checkbox
	// renders and its unchecked state must still exclude the cell.
	const initialDataUnpricedMulti = {
		...initialDataUnpriced,
		settings: { multiple_pricing_periods: true },
	};

	// The per-cell Price input is the only spinbutton carrying step="0.01"
	// (Total capacity / ticket-type capacity inputs have no step).
	const getPriceInput = () =>
		screen
			.getAllByRole('spinbutton')
			.find((el) => el.getAttribute('step') === '0.01');

	async function saveAndCapturePayload(onSaveRef) {
		let savedPayload = null;
		apiFetch.mockImplementation(({ method, data }) => {
			if (method === 'PUT') {
				savedPayload = data;
				return Promise.resolve({
					...initialDataUnpriced,
					prices: [],
				});
			}
			return new Promise(() => {});
		});

		expect(onSaveRef.current).not.toBeNull();
		await act(async () => {
			await onSaveRef.current();
		});
		return savedPayload;
	}

	it('single-period mode: a typed price is included in the save payload', async () => {
		const { onSaveRef } = renderTickets({
			initialData: initialDataUnpriced,
		});

		// Single-period mode renders no "Available" checkbox.
		expect(screen.queryByText('Available')).not.toBeInTheDocument();

		const priceInput = getPriceInput();
		expect(priceInput).toBeTruthy();
		fireEvent.change(priceInput, { target: { value: '15' } });

		const savedPayload = await saveAndCapturePayload(onSaveRef);

		expect(savedPayload).not.toBeNull();
		expect(savedPayload.prices).toHaveLength(1);
		expect(savedPayload.prices[0]).toMatchObject({
			ticket_type_index: 0,
			sale_period_index: 0,
			price: 15,
		});
	});

	it('multiple-periods mode: an unchecked cell stays excluded from the save payload', async () => {
		const { onSaveRef } = renderTickets({
			initialData: initialDataUnpricedMulti,
		});

		// The checkbox renders unchecked and hides the price input.
		const available = screen.getByRole('checkbox', { name: 'Available' });
		expect(available).not.toBeChecked();
		expect(getPriceInput()).toBeUndefined();

		const savedPayload = await saveAndCapturePayload(onSaveRef);

		expect(savedPayload).not.toBeNull();
		expect(savedPayload.prices).toHaveLength(0);
	});

	it('multiple-periods mode: checking Available then typing a price includes the cell', async () => {
		const { onSaveRef } = renderTickets({
			initialData: initialDataUnpricedMulti,
		});

		fireEvent.click(screen.getByRole('checkbox', { name: 'Available' }));

		const priceInput = getPriceInput();
		expect(priceInput).toBeTruthy();
		fireEvent.change(priceInput, { target: { value: '9' } });

		const savedPayload = await saveAndCapturePayload(onSaveRef);

		expect(savedPayload).not.toBeNull();
		expect(savedPayload.prices).toHaveLength(1);
		expect(savedPayload.prices[0]).toMatchObject({
			ticket_type_index: 0,
			sale_period_index: 0,
			price: 9,
		});
	});
});
