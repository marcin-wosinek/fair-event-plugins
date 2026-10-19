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
import EventTickets, {
	exclusiveEndToInclusiveDate,
	inclusiveEndToExclusiveDate,
	moveToTop,
	duplicateOption,
} from '../EventTickets.js';
import { salePeriodColor } from '../SalePeriodsCalendar.js';

jest.mock( '@wordpress/api-fetch' );

// Suppress WordPress component deprecation warnings (TextControl / SelectControl
// __next40pxDefaultSize) so they don't block assertions via @wordpress/jest-console.
beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	// Return never-resolving promises for background apiFetch calls (groups,
	// participants, group-pricing-rules) so they don't fire async state updates
	// outside act() after assertions complete.
	apiFetch.mockImplementation( () => new Promise( () => {} ) );
} );

/**
 * Opens the ⋯ menu and lets Floating UI position it inside act().
 */
async function openMoreActions() {
	await act( async () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'More actions' } )
		);
	} );
}

describe( 'sale-period calendar date conversion (#1500)', () => {
	it( 'crosses month, year, and DST boundaries without shifting', async () => {
		expect( exclusiveEndToInclusiveDate( '2026-09-01' ) ).toBe(
			'2026-08-31'
		);
		expect( inclusiveEndToExclusiveDate( '2026-12-31' ) ).toBe(
			'2027-01-01'
		);
		expect( inclusiveEndToExclusiveDate( '2026-03-29' ) ).toBe(
			'2026-03-30'
		);
	} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

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
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			sort_order: 0,
		},
	],
};

async function renderTickets( {
	initialData = emptyInitialData,
	payloadSaveRef,
	...extraProps
} = {} ) {
	const onSaveRef = payloadSaveRef || { current: null };
	apiFetch.mockImplementationOnce( () => Promise.resolve( initialData ) );
	let view;
	await act( async () => {
		view = render(
			<EventTickets
				eventDateId={ 99 }
				onSaveRef={ onSaveRef }
				{ ...extraProps }
			/>
		);
	} );
	return { onSaveRef, container: view.container };
}

function savePayload( ref ) {
	act( () => {
		ref.current();
	} );
	return apiFetch.mock.calls
		.filter( ( [ request ] ) => request.method === 'PUT' )
		.at( -1 )[ 0 ].data;
}

describe( 'EventTickets — extension selection rules (#1521)', () => {
	it( 'renders enabled, minimum, and maximum controls for every ticket type', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );
		expect(
			screen.getByRole( 'checkbox', { name: 'Enable extensions' } )
		).toBeChecked();
		expect( screen.getByLabelText( 'Minimum selections' ) ).toHaveValue(
			0
		);
		expect( screen.getByLabelText( 'Maximum selections' ) ).toHaveValue(
			null
		);
	} );

	it( 'retains values while disabling their inputs', async () => {
		await renderTickets( {
			initialData: {
				...initialDataWithTicketType,
				ticket_types: [
					{
						...initialDataWithTicketType.ticket_types[ 0 ],
						activities_enabled: true,
						minimum_activities: 1,
						maximum_activities: 2,
					},
				],
				options: [ { name: 'One' }, { name: 'Two' } ],
			},
		} );
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Enable extensions' } )
		);
		expect( screen.getByLabelText( 'Minimum selections' ) ).toBeDisabled();
		expect( screen.getByLabelText( 'Minimum selections' ) ).toHaveValue(
			1
		);
		expect( screen.getByLabelText( 'Maximum selections' ) ).toHaveValue(
			2
		);
	} );

	it( 'prevents saving a maximum below the minimum', async () => {
		await renderTickets( {
			initialData: {
				...initialDataWithTicketType,
				options: [ { name: 'One' }, { name: 'Two' } ],
			},
		} );
		fireEvent.change( screen.getByLabelText( 'Minimum selections' ), {
			target: { value: '2' },
		} );
		fireEvent.change( screen.getByLabelText( 'Maximum selections' ), {
			target: { value: '1' },
		} );
		expect(
			screen.getByText(
				'Maximum selections cannot be lower than minimum selections.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save tickets' } )
		).toBeDisabled();
	} );
} );

describe( 'EventTickets — empty state (no ticket types) (#1199)', () => {
	it( 'renders the Prices section heading', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		expect( screen.getByText( 'Prices' ).tagName ).toBe( 'STRONG' );
	} );

	it( 'renders the full editor with zero ticket types', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		expect( screen.getByText( 'Ticket Type' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( /No ticket types yet/i )
		).toBeInTheDocument();
	} );

	it( 'does not render a Signup price field', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		expect( screen.queryByText( /Signup price/i ) ).not.toBeInTheDocument();
	} );

	it( 'does not render a simple/advanced ticketing toggle', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		expect(
			screen.queryByRole( 'button', {
				name: /Switch to simple ticketing/i,
			} )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: /Switch to advanced ticketing/i,
			} )
		).not.toBeInTheDocument();
	} );

	it( 'clicking "+ Add Ticket Type" adds a ticket-type row without a scope modal (non-series)', async () => {
		await renderTickets( {
			initialData: emptyInitialData,
			isSeries: false,
		} );
		const addButton = screen.getByRole( 'button', {
			name: '+ Add Ticket Type',
		} );
		fireEvent.click( addButton );
		expect(
			screen.queryByText( 'Choose ticket scope' )
		).not.toBeInTheDocument();
		expect(
			screen.getByPlaceholderText( 'Type name' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( /No ticket types yet/i )
		).not.toBeInTheDocument();
	} );

	it( 'export/import is reachable through the ⋯ menu with zero ticket types', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		await openMoreActions();
		expect(
			screen.getByRole( 'menuitem', { name: 'Export ticket settings' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'menuitem', { name: 'Import ticket settings' } )
		).toBeInTheDocument();
	} );

	it( 'saving with zero ticket types persists no sale period', async () => {
		const { onSaveRef } = await renderTickets();
		expect( savePayload( onSaveRef ) ).toEqual(
			expect.objectContaining( { sale_periods: [] } )
		);
	} );
} );

describe( 'EventTickets — recurrence scope selector', () => {
	it( 'shows Scope column when isSeries is true', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );
		expect( screen.getByText( 'Scope' ) ).toBeInTheDocument();
	} );

	it( 'does not show Scope column when isSeries is false', async () => {
		await renderTickets( {
			isSeries: false,
			initialData: initialDataWithTicketType,
		} );
		expect( screen.queryByText( 'Scope' ) ).not.toBeInTheDocument();
	} );

	it( 'does not show Scope column when isSeries is omitted', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );
		expect( screen.queryByText( 'Scope' ) ).not.toBeInTheDocument();
	} );

	it( 'new ticket type is seeded with recurrence_scope single_instance', async () => {
		await renderTickets( {
			isSeries: true,
			// Start with a ticket type so hasAdvancedTickets = true and the
			// "+ Add Ticket Type" button is visible in the table footer.
			initialData: initialDataWithTicketType,
		} );

		const addButton = screen.getByRole( 'button', {
			name: '+ Add Ticket Type',
		} );
		fireEvent.click( addButton );

		// On a recurring event the button opens the scope-choice modal.
		const confirmButton = screen.getByRole( 'button', {
			name: /add ticket type/i,
		} );
		fireEvent.click( confirmButton );

		// A second Scope combobox should appear (one per ticket type row).
		const scopeSelects = screen
			.getAllByRole( 'combobox' )
			.filter(
				( el ) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		// Both rows (original + new) should be single_instance.
		expect( scopeSelects.length ).toBeGreaterThanOrEqual( 2 );
		scopeSelects.forEach( ( el ) =>
			expect( el.value ).toBe( 'single_instance' )
		);
	} );

	it( 'changing scope selector to whole_series updates the combobox value', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		const selects = screen.getAllByRole( 'combobox' );
		const scopeSelect = selects.find(
			( el ) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		expect( scopeSelect ).toBeTruthy();
		expect( scopeSelect.value ).toBe( 'single_instance' );

		fireEvent.change( scopeSelect, { target: { value: 'whole_series' } } );
		expect( scopeSelect.value ).toBe( 'whole_series' );
	} );

	it( 'save payload includes updated recurrence_scope', async () => {
		const { onSaveRef } = await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		// Change scope to whole_series.
		const selects = screen.getAllByRole( 'combobox' );
		const scopeSelect = selects.find(
			( el ) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		fireEvent.change( scopeSelect, { target: { value: 'whole_series' } } );

		// Capture the PUT payload on save.
		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( {
					...initialDataWithTicketType,
					ticket_types: [],
				} );
			}
			return new Promise( () => {} );
		} );

		expect( onSaveRef.current ).not.toBeNull();
		await act( async () => {
			await onSaveRef.current();
		} );

		expect( savedPayload ).not.toBeNull();
		const savedType = savedPayload.ticket_types?.[ 0 ];
		expect( savedType ).toBeTruthy();
		expect( savedType.recurrence_scope ).toBe( 'whole_series' );
	} );
} );

describe( 'EventTickets — multiple_instances scope (#930)', () => {
	it( 'offers multiple_instances as a scope option', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		const selects = screen.getAllByRole( 'combobox' );
		const scopeSelect = selects.find(
			( el ) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		const optionValues = Array.from( scopeSelect.options ).map(
			( o ) => o.value
		);
		expect( optionValues ).toContain( 'multiple_instances' );
		// Acknowledge the WordPress SelectControl size deprecation notice —
		// only fires the first time it renders in the suite (deduped globally),
		// so only assert when this test actually triggered it.
		if ( console.warn.mock.calls.length > 0 ) {
			expect( console ).toHaveWarned();
		}
	} );

	it( 'shows a "Minimum instances" input once multiple_instances is selected', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		const selects = screen.getAllByRole( 'combobox' );
		const scopeSelect = selects.find(
			( el ) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);

		expect(
			screen.queryByLabelText( /Minimum instances/i )
		).not.toBeInTheDocument();

		fireEvent.change( scopeSelect, {
			target: { value: 'multiple_instances' },
		} );

		expect( scopeSelect.value ).toBe( 'multiple_instances' );
		expect(
			screen.getByLabelText( /Minimum instances/i )
		).toBeInTheDocument();
	} );

	it( 'save payload includes the entered minimum_instances', async () => {
		const { onSaveRef } = await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		const selects = screen.getAllByRole( 'combobox' );
		const scopeSelect = selects.find(
			( el ) =>
				el.value === 'single_instance' || el.value === 'whole_series'
		);
		fireEvent.change( scopeSelect, {
			target: { value: 'multiple_instances' },
		} );

		const minInstancesInput = screen.getByLabelText( /Minimum instances/i );
		fireEvent.change( minInstancesInput, { target: { value: '3' } } );

		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( {
					...initialDataWithTicketType,
					ticket_types: [],
				} );
			}
			return new Promise( () => {} );
		} );

		expect( onSaveRef.current ).not.toBeNull();
		await act( async () => {
			await onSaveRef.current();
		} );

		expect( savedPayload ).not.toBeNull();
		const savedType = savedPayload.ticket_types?.[ 0 ];
		expect( savedType ).toBeTruthy();
		expect( savedType.recurrence_scope ).toBe( 'multiple_instances' );
		expect( savedType.minimum_instances ).toBe( 3 );
	} );
} );

describe( 'EventTickets — scope-choice modal', () => {
	it( 'opens a modal when "+ Add Ticket Type" is clicked on a recurring event', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);

		expect( screen.getByText( 'Choose ticket scope' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( /This instance/i ) ).toBeInTheDocument();
		expect( screen.getByLabelText( /Whole series/i ) ).toBeInTheDocument();
	} );

	it( 'does not open a modal on a non-recurring event', async () => {
		await renderTickets( {
			isSeries: false,
			initialData: initialDataWithTicketType,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);

		expect(
			screen.queryByText( 'Choose ticket scope' )
		).not.toBeInTheDocument();
	} );

	it( 'adds a whole_series ticket when that option is chosen in the modal', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);

		fireEvent.click( screen.getByLabelText( /Whole series/i ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: /add ticket type/i } )
		);

		const scopeSelects = screen
			.getAllByRole( 'combobox' )
			.filter(
				( el ) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		const newRow = scopeSelects[ scopeSelects.length - 1 ];
		expect( newRow.value ).toBe( 'whole_series' );
	} );
} );

const initialDataWithSoldTicketType = {
	...emptyInitialData,
	ticket_types: [
		{
			id: 1,
			name: 'General',
			capacity: null,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'whole_series',
			sort_order: 0,
			has_sales: true,
		},
	],
};

describe( 'EventTickets — scope lock when has_sales', () => {
	it( 'renders scope as read-only text when has_sales is true', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithSoldTicketType,
		} );

		expect( screen.getByText( 'Whole series' ) ).toBeInTheDocument();
		const scopeSelects = screen
			.queryAllByRole( 'combobox' )
			.filter(
				( el ) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		expect( scopeSelects.length ).toBe( 0 );
	} );

	it( 'renders scope as SelectControl when has_sales is false', async () => {
		await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );

		const scopeSelects = screen
			.getAllByRole( 'combobox' )
			.filter(
				( el ) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		expect( scopeSelects.length ).toBeGreaterThanOrEqual( 1 );
	} );
} );

describe( 'EventTickets — disable/enable when has_sales', () => {
	it( 'shows Remove button when has_sales is false', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );
		expect(
			screen.getByRole( 'button', { name: /Remove/i } )
		).toBeInTheDocument();
	} );

	it( 'shows toggle instead of Remove when has_sales is true', async () => {
		await renderTickets( { initialData: initialDataWithSoldTicketType } );
		expect(
			screen.queryByRole( 'button', { name: /Remove/i } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', { name: 'Enabled' } )
		).toBeInTheDocument();
	} );

	it( 'shows disabled label when ticket type is disabled', async () => {
		const disabledData = {
			...emptyInitialData,
			ticket_types: [
				{
					...initialDataWithSoldTicketType.ticket_types[ 0 ],
					disabled: true,
				},
			],
		};
		await renderTickets( { initialData: disabledData } );
		expect(
			screen.getByText( 'Disabled — no longer on sale' )
		).toBeInTheDocument();
	} );

	it( 'does not show disabled label when ticket type is enabled', async () => {
		await renderTickets( { initialData: initialDataWithSoldTicketType } );
		expect(
			screen.queryByText( 'Disabled — no longer on sale' )
		).not.toBeInTheDocument();
	} );

	it( 'toggling disable updates the disabled field in the save payload', async () => {
		const { onSaveRef } = await renderTickets( {
			initialData: initialDataWithSoldTicketType,
		} );
		const toggle = screen.getByRole( 'checkbox', { name: 'Enabled' } );
		fireEvent.click( toggle );

		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( {
					...initialDataWithSoldTicketType,
					ticket_types: [],
				} );
			}
			return new Promise( () => {} );
		} );

		await act( async () => {
			await onSaveRef.current();
		} );

		expect( savedPayload?.ticket_types?.[ 0 ]?.disabled ).toBe( true );
	} );
} );

describe( 'EventTickets — save button and dirty tracking (#987)', () => {
	it( 'renders its own "Save tickets" button', async () => {
		await renderTickets( { initialData: emptyInitialData } );
		expect(
			screen.getByRole( 'button', { name: 'Save tickets' } )
		).toBeInTheDocument();
	} );

	it( 'reports dirty once a field changes, and clean again after save', async () => {
		const onDirtyChange = jest.fn();
		await renderTickets( {
			initialData: initialDataWithTicketType,
			onDirtyChange,
		} );

		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		const nameInput = screen.getByDisplayValue( 'General' );
		fireEvent.change( nameInput, {
			target: { value: 'General (edited)' },
		} );

		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );

		apiFetch.mockImplementation( ( { method } ) => {
			if ( method === 'PUT' ) {
				return Promise.resolve( {
					...initialDataWithTicketType,
					ticket_types: [
						{
							...initialDataWithTicketType.ticket_types[ 0 ],
							name: 'General (edited)',
						},
					],
				} );
			}
			return new Promise( () => {} );
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save tickets' } )
		);

		await waitFor( () =>
			expect( onDirtyChange ).toHaveBeenLastCalledWith( false )
		);
	} );
} );

describe( 'EventTickets — payments-unavailable notice (#988, #1177)', () => {
	const originalFairPaymentsConnector = window.fairPaymentsConnector;

	// A ticket type carrying a price > 0 through the prices map, so
	// hasPurchasablePrice is true and the warning is relevant.
	const initialDataWithPaidTicket = {
		...emptyInitialData,
		ticket_types: [ initialDataWithTicketType.ticket_types[ 0 ] ],
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
		ticket_types: [ initialDataWithTicketType.ticket_types[ 0 ] ],
		options: [
			{
				name: 'Dinner',
				short_name: '',
				price: 20,
				capacity: null,
				period_prices: [],
				sort_order: 0,
			},
		],
	};

	const mollieRegex =
		/Paid tickets won't be sold until Mollie payments are configured/i;
	const missingPluginRegex =
		/Paid tickets need the Fair Payments Connector plugin/i;

	afterEach( () => {
		window.fairPaymentsConnector = originalFairPaymentsConnector;
	} );

	it( 'shows the Mollie notice when the connector is active but unconfigured and a price > 0', async () => {
		// wp_localize_script delivers booleans as strings ("1"/"") — feed
		// that stringified transport form, not real booleans.
		window.fairPaymentsConnector = {
			connectorActive: '1',
			paymentConfigured: '',
			settingsUrl:
				'http://example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
		};
		const { container } = await renderTickets( {
			initialData: initialDataWithPaidTicket,
		} );

		expect(
			within( container ).getByText( mollieRegex )
		).toBeInTheDocument();
		const link = within( container ).getByRole( 'link', {
			name: 'Set up Mollie',
		} );
		expect( link ).toHaveAttribute(
			'href',
			window.fairPaymentsConnector.settingsUrl
		);
	} );

	it( 'shows the missing-plugin notice when the connector is inactive and a price > 0', async () => {
		window.fairPaymentsConnector = { connectorActive: '', currency: 'EUR' };
		const { container } = await renderTickets( {
			initialData: initialDataWithPaidTicket,
		} );

		expect(
			within( container ).getByText( missingPluginRegex )
		).toBeInTheDocument();
		// No settings link when the plugin isn't installed.
		expect(
			within( container ).queryByRole( 'link', { name: 'Set up Mollie' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the notice for add-on-only pricing', async () => {
		window.fairPaymentsConnector = { connectorActive: '', currency: 'EUR' };
		const { container } = await renderTickets( {
			initialData: initialDataWithPaidAddon,
		} );

		expect(
			within( container ).getByText( missingPluginRegex )
		).toBeInTheDocument();
	} );

	it.each( [
		[ 'missing/inactive', { connectorActive: '', currency: 'EUR' } ],
		[
			'active but unconfigured',
			{ connectorActive: '1', paymentConfigured: '', settingsUrl: 'x' },
		],
		[
			'active and configured',
			{ connectorActive: '1', paymentConfigured: '1', settingsUrl: 'x' },
		],
	] )(
		'does not show any notice when every price is 0 (%s)',
		async ( _label, connectorState ) => {
			window.fairPaymentsConnector = connectorState;
			const { container } = await renderTickets( {
				initialData: initialDataWithTicketType,
			} );

			expect(
				within( container ).queryByText( mollieRegex )
			).not.toBeInTheDocument();
			expect(
				within( container ).queryByText( missingPluginRegex )
			).not.toBeInTheDocument();
		}
	);

	it( 'does not show any notice when there are no tickets yet', async () => {
		window.fairPaymentsConnector = { connectorActive: '' };
		const { container } = await renderTickets( {
			initialData: emptyInitialData,
		} );

		expect(
			within( container ).queryByText( mollieRegex )
		).not.toBeInTheDocument();
		expect(
			within( container ).queryByText( missingPluginRegex )
		).not.toBeInTheDocument();
	} );

	it( 'does not show any notice when payments are configured', async () => {
		// wp_localize_script delivers booleans as strings ("1"/"") — feed
		// that stringified transport form, not real booleans. This is the
		// green-path state the notice must correctly suppress.
		window.fairPaymentsConnector = {
			connectorActive: '1',
			paymentConfigured: '1',
			settingsUrl:
				'http://example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
		};
		const { container } = await renderTickets( {
			initialData: initialDataWithPaidTicket,
		} );

		expect(
			within( container ).queryByText( mollieRegex )
		).not.toBeInTheDocument();
		expect(
			within( container ).queryByText( missingPluginRegex )
		).not.toBeInTheDocument();
	} );
} );

describe( 'EventTickets — Export/Import moved to the ⋯ menu (#988)', () => {
	it( 'does not show Export/Import as primary buttons', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );

		expect(
			screen.queryByRole( 'button', { name: 'Export ticket settings' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Import ticket settings' } )
		).not.toBeInTheDocument();
	} );

	it( 'reaches Export/Import through the ⋯ menu', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );

		await openMoreActions();

		expect(
			screen.getByRole( 'menuitem', { name: 'Export ticket settings' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'menuitem', { name: 'Import ticket settings' } )
		).toBeInTheDocument();
	} );
} );

describe( 'EventTickets — editable table renders without expanding a panel (#988)', () => {
	it( 'shows the editable ticket type field directly', async () => {
		await renderTickets( { initialData: initialDataWithTicketType } );

		expect( screen.getByDisplayValue( 'General' ) ).toBeInTheDocument();
	} );
} );

describe( 'EventTickets — single pricing period by default (#1138)', () => {
	const originalManageEventData = window.fairEventsManageEventData;

	afterEach( () => {
		window.fairEventsManageEventData = originalManageEventData;
	} );

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

	it( 'adding the first ticket type seeds exactly one sale period and shows a single Price column with no Available checkbox', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( {
			initialData: emptyInitialData,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);

		expect(
			screen.getAllByRole( 'columnheader', { name: 'Price' } )
		).toHaveLength( 1 );
		expect( screen.queryByText( 'Available' ) ).not.toBeInTheDocument();
	} );

	it( 'adding a ticket type leaves the sale window unset (#1189) — no concrete dates are seeded', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( {
			initialData: emptyInitialData,
			startDate: '2020-01-01',
			endDate: '2020-01-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		// Nothing is frozen into the "From" field — the window stays unset
		// until the organiser explicitly picks a date.
		expect( screen.getByLabelText( 'From' ).value ).toBe( '' );
	} );

	it( 'turning on "Multiple pricing periods" splits the window into Advance ticket / Day of event and migrates the price', async () => {
		await renderTickets( {
			initialData: initialDataWithOnePeriod,
			startDate: '2026-01-10',
			endDate: '2026-02-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		expect( screen.getByText( 'Advance ticket' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Day of event' ) ).toBeInTheDocument();
		expect( screen.getByDisplayValue( '12' ) ).toBeInTheDocument();
	} );

	it( 'turning off "Multiple pricing periods" with several periods asks for confirmation before merging', async () => {
		await renderTickets( { initialData: initialDataWithTwoPeriods } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		expect(
			screen.getByRole( 'dialog', { name: 'Merge sale periods?' } )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Merge periods' } )
		);

		expect(
			screen.queryByText( 'Advance ticket' )
		).not.toBeInTheDocument();
		expect( screen.queryByText( 'Day of event' ) ).not.toBeInTheDocument();
		expect( screen.getByDisplayValue( '20' ) ).toBeInTheDocument();
	} );

	it( 'an event loaded with two stored periods renders in multi-period mode regardless of the stored toggle', async () => {
		await renderTickets( { initialData: initialDataWithTwoPeriods } );

		expect( screen.getByText( 'Advance ticket' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Day of event' ) ).toBeInTheDocument();
	} );
} );

describe( 'EventTickets — unset sale window shows the resolved default (#1189)', () => {
	const initialDataWithUnsetPeriod = {
		...initialDataWithTicketType,
		sale_periods: [ { id: 701, name: '', sale_start: '', sale_end: '' } ],
		prices: [ { ticket_type_id: 1, sale_period_id: 701, price: '12' } ],
	};

	it( 'a single event with an unset window shows the day after the event as the default, marked as a default', async () => {
		await renderTickets( {
			initialData: initialDataWithUnsetPeriod,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		// formatSaleDateLabel() renders a locale-formatted weekday/day/month —
		// assert on the "(default)" marker and August, not an exact ISO string.
		expect(
			screen.getByText( /until .*August.*\(default\)/ )
		).toBeInTheDocument();
	} );

	it( "a series with an unset window resolves the default from the last occurrence, not the master's own end", async () => {
		await renderTickets( {
			initialData: initialDataWithUnsetPeriod,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			lastOccurrenceDate: '2026-08-22',
			isSeries: true,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect(
			screen.getByText( /until .*August.*\(default\)/ )
		).toBeInTheDocument();
	} );

	it( 'an explicit sale_end suppresses the "(default)" marker', async () => {
		await renderTickets( {
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
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			lastOccurrenceDate: '2026-08-22',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( screen.getByText( /until .*August/ ) ).toBeInTheDocument();
		expect( screen.queryByText( /\(default\)/ ) ).not.toBeInTheDocument();
	} );
} );

describe( 'EventTickets — sale end tracks the series across conversion (#1203)', () => {
	const initialDataWithUnsetSinglePeriod = {
		...initialDataWithTicketType,
		sale_periods: [ { id: 801, name: '', sale_start: '', sale_end: '' } ],
		prices: [ { ticket_type_id: 1, sale_period_id: 801, price: '12' } ],
	};

	const initialDataWithSetSinglePeriod = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 802,
				name: '',
				sale_start: '2026-07-01',
				sale_end: '2026-08-02',
			},
		],
		prices: [ { ticket_type_id: 1, sale_period_id: 802, price: '12' } ],
	};

	const initialDataWithTwoPeriodsUnsetEnd = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 601,
				name: 'Advance ticket',
				sale_start: '2026-07-01',
				sale_end: '2026-08-01',
			},
			{
				id: 602,
				name: 'Day of event',
				sale_start: '2026-08-01',
				sale_end: '',
			},
		],
		prices: [
			{ ticket_type_id: 1, sale_period_id: 601, price: '20' },
			{ ticket_type_id: 1, sale_period_id: 602, price: '5' },
		],
		settings: { multiple_pricing_periods: true },
	};

	it( 'turning on "Multiple pricing periods" with an unset window leaves the last period\'s end unset', async () => {
		const payloadSaveRef = { current: null };
		await renderTickets( {
			initialData: initialDataWithUnsetSinglePeriod,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			payloadSaveRef,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		const payload = savePayload( payloadSaveRef );
		expect( payload.sale_periods ).toHaveLength( 2 );
		// Only the split boundary is stored — the trailing end stays unset.
		expect( payload.sale_periods[ 0 ].sale_start ).toBe( '' );
		expect( payload.sale_periods[ 0 ].sale_end ).toBe(
			'2026-08-01 00:00:00'
		);
		expect( payload.sale_periods[ 1 ].sale_start ).toBe(
			'2026-08-01 00:00:00'
		);
		expect( payload.sale_periods[ 1 ].sale_end ).toBe( '' );
	} );

	it( 'the last period\'s "Until" field shows the resolved default as a placeholder, not a frozen value', async () => {
		const { container } = await renderTickets( {
			initialData: initialDataWithUnsetSinglePeriod,
			startDate: '2026-08-01',
			endDate: '2026-08-01',
			lastOccurrenceDate: '2026-08-22',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		const dateInputs = container.querySelectorAll( 'input[type="date"]' );
		const lastUntilInput = dateInputs[ dateInputs.length - 1 ];
		expect( lastUntilInput.value ).toBe( '' );
		// The inclusive placeholder is the series' final occurrence day, not
		// the following exclusive boundary or the master's own day.
		expect( lastUntilInput.placeholder ).toBe( '2026-08-22' );
	} );

	it( 'merging periods restores an unset (automatic) end', async () => {
		const payloadSaveRef = { current: null };
		await renderTickets( {
			initialData: initialDataWithTwoPeriodsUnsetEnd,
			payloadSaveRef,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Merge periods' } )
		);

		const payload = savePayload( payloadSaveRef );
		expect( payload.sale_periods ).toHaveLength( 1 );
		expect( payload.sale_periods[ 0 ].sale_end ).toBe( '' );
	} );

	it( 'a "Reset to automatic" control clears an explicit end back to unset', async () => {
		const payloadSaveRef = { current: null };
		await renderTickets( {
			initialData: initialDataWithSetSinglePeriod,
			startDate: '2026-07-01',
			endDate: '2026-08-01',
			payloadSaveRef,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Reset to automatic' } )
		);

		const payload = savePayload( payloadSaveRef );
		expect( payload.sale_periods[ 0 ].sale_end ).toBe( '' );
	} );

	it( 'an organiser-typed sale end survives turning multiple pricing periods on', async () => {
		const payloadSaveRef = { current: null };
		await renderTickets( {
			initialData: initialDataWithSetSinglePeriod,
			startDate: '2026-07-01',
			endDate: '2026-08-01',
			payloadSaveRef,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		const payload = savePayload( payloadSaveRef );
		expect( payload.sale_periods[ 1 ].sale_end ).toBe(
			'2026-08-02 00:00:00'
		);
	} );
} );

describe( 'EventTickets — pricing an event with no stored prices (#1175)', () => {
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
			.getAllByRole( 'spinbutton' )
			.find( ( el ) => el.getAttribute( 'step' ) === '0.01' );

	async function saveAndCapturePayload( onSaveRef ) {
		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( {
					...initialDataUnpriced,
					prices: [],
				} );
			}
			return new Promise( () => {} );
		} );

		expect( onSaveRef.current ).not.toBeNull();
		await act( async () => {
			await onSaveRef.current();
		} );
		return savedPayload;
	}

	it( 'single-period mode: a typed price is included in the save payload', async () => {
		const { onSaveRef } = await renderTickets( {
			initialData: initialDataUnpriced,
		} );

		// Single-period mode renders no "Available" checkbox.
		expect( screen.queryByText( 'Available' ) ).not.toBeInTheDocument();

		const priceInput = getPriceInput();
		expect( priceInput ).toBeTruthy();
		fireEvent.change( priceInput, { target: { value: '15' } } );

		const savedPayload = await saveAndCapturePayload( onSaveRef );

		expect( savedPayload ).not.toBeNull();
		expect( savedPayload.prices ).toHaveLength( 1 );
		expect( savedPayload.prices[ 0 ] ).toMatchObject( {
			ticket_type_index: 0,
			sale_period_index: 0,
			price: 15,
		} );
	} );

	it( 'multiple-periods mode: an unchecked cell stays excluded from the save payload', async () => {
		const { onSaveRef } = await renderTickets( {
			initialData: initialDataUnpricedMulti,
		} );

		// The checkbox renders unchecked and hides the price input.
		const available = screen.getByRole( 'checkbox', { name: 'Available' } );
		expect( available ).not.toBeChecked();
		expect( getPriceInput() ).toBeUndefined();

		const savedPayload = await saveAndCapturePayload( onSaveRef );

		expect( savedPayload ).not.toBeNull();
		expect( savedPayload.prices ).toHaveLength( 0 );
	} );

	it( 'multiple-periods mode: checking Available then typing a price includes the cell', async () => {
		const { onSaveRef } = await renderTickets( {
			initialData: initialDataUnpricedMulti,
		} );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Available' } )
		);

		const priceInput = getPriceInput();
		expect( priceInput ).toBeTruthy();
		fireEvent.change( priceInput, { target: { value: '9' } } );

		const savedPayload = await saveAndCapturePayload( onSaveRef );

		expect( savedPayload ).not.toBeNull();
		expect( savedPayload.prices ).toHaveLength( 1 );
		expect( savedPayload.prices[ 0 ] ).toMatchObject( {
			ticket_type_index: 0,
			sale_period_index: 0,
			price: 9,
		} );
	} );
} );

describe( 'EventTickets — Add-on collaborator discount removed (#1139)', () => {
	const initialDataWithOption = {
		...initialDataWithTicketType,
		options: [
			{
				id: 5,
				name: 'Dinner',
				short_name: '',
				price: 20,
				capacity: null,
				period_prices: [],
				sort_order: 0,
			},
		],
	};

	it( 'does not render the checkbox or the Discounted price column, even for a stored discount', async () => {
		await renderTickets( {
			initialData: {
				...initialDataWithOption,
				settings: { activity_collaborator_discount: true },
			},
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		expect(
			screen.queryByRole( 'checkbox', {
				name: /Add-on collaborator discount/i,
			} )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( /Discounted price/i )
		).not.toBeInTheDocument();
	} );
} );

describe( 'EventTickets — SalePeriodsCalendar wiring (#1197)', () => {
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
	};

	// jsdom normalizes inline hex colors to rgb() on the CSSOM.
	function hexToRgb( hex ) {
		const r = parseInt( hex.slice( 1, 3 ), 16 );
		const g = parseInt( hex.slice( 3, 5 ), 16 );
		const b = parseInt( hex.slice( 5, 7 ), 16 );
		return `rgb(${ r }, ${ g }, ${ b })`;
	}

	it( 'renders a swatch per Sale Periods table row matching the calendar palette', async () => {
		await renderTickets( {
			initialData: initialDataWithTwoPeriods,
			startDate: '2026-01-25',
			endDate: '2026-02-01',
		} );

		const toggle = screen.getByRole( 'button', { name: /Sale Periods/i } );
		fireEvent.click( toggle );

		const panelBody = toggle.closest( '.components-panel__body' );
		const rows = panelBody
			.querySelector( 'table' )
			.querySelectorAll( 'tbody tr' );
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 0 ].querySelector( 'td span' ).style.background ).toBe(
			hexToRgb( salePeriodColor( 0 ) )
		);
		expect( rows[ 1 ].querySelector( 'td span' ).style.background ).toBe(
			hexToRgb( salePeriodColor( 1 ) )
		);
	} );

	it( 'hides the calendar when Multiple pricing periods is off, with a single stored period', async () => {
		await renderTickets( {
			initialData: initialDataWithOnePeriod,
			startDate: '2026-01-10',
			endDate: '2026-02-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( screen.queryByText( /Event day/i ) ).not.toBeInTheDocument();
	} );

	it( 'shows the calendar when Multiple pricing periods is on, with two stored periods', async () => {
		await renderTickets( {
			initialData: initialDataWithTwoPeriods,
			startDate: '2026-01-25',
			endDate: '2026-02-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( screen.getByText( /Event day/i ) ).toBeInTheDocument();
	} );

	it( 'shows the calendar after turning on Multiple pricing periods from a single period', async () => {
		await renderTickets( {
			initialData: initialDataWithOnePeriod,
			startDate: '2026-01-10',
			endDate: '2026-02-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);
		expect( screen.queryByText( /Event day/i ) ).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		expect( screen.getByText( /Event day/i ) ).toBeInTheDocument();
	} );

	it( 'hides the calendar again after confirming the merge back to a single period', async () => {
		await renderTickets( {
			initialData: initialDataWithTwoPeriods,
			startDate: '2026-01-25',
			endDate: '2026-02-01',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);
		expect( screen.getByText( /Event day/i ) ).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Merge periods' } )
		);

		expect( screen.queryByText( /Event day/i ) ).not.toBeInTheDocument();
	} );
} );

describe( 'EventTickets — persisted editing', () => {
	it( 'exposes recurrence_scope on the save payload when isSeries is true', async () => {
		const { onSaveRef: payloadSaveRef } = await renderTickets( {
			isSeries: true,
			initialData: initialDataWithTicketType,
		} );
		const scopeSelect = screen
			.getAllByRole( 'combobox' )
			.find(
				( el ) =>
					el.value === 'single_instance' ||
					el.value === 'whole_series'
			);
		expect( scopeSelect ).toBeTruthy();
		fireEvent.change( scopeSelect, { target: { value: 'whole_series' } } );
		expect( savePayload( payloadSaveRef ) ).toEqual(
			expect.objectContaining( {
				ticket_types: [
					expect.objectContaining( {
						recurrence_scope: 'whole_series',
					} ),
				],
			} )
		);
	} );

	it( 'reads currency from window.fairPaymentsConnector rather than hardcoding EUR', async () => {
		window.fairPaymentsConnector = { currency: 'PLN' };
		await renderTickets( {
			initialData: {
				...initialDataWithTicketType,
				options: [
					{
						name: 'Add-on',
						short_name: 'A',
						price: 5,
						capacity: null,
						derive_price_from_sale_period: false,
						period_prices: [],
					},
				],
			},
		} );
		fireEvent.click( screen.getByRole( 'button', { name: /Add-ons/i } ) );
		expect( screen.getByText( 'Price (PLN)' ) ).toBeInTheDocument();
		delete window.fairPaymentsConnector;
	} );

	it( 'uses a lazily-resolved default sale end from lastOccurrenceDate rather than a fixed value', async () => {
		await renderTickets( {
			initialData: {
				...initialDataWithTicketType,
				sale_periods: [
					{
						id: 1,
						name: '',
						sale_start: '2026-01-01',
						sale_end: '',
						sort_order: 0,
					},
				],
			},
			startDate: '2026-01-10',
			lastOccurrenceDate: '2026-01-10',
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		// The day after lastOccurrenceDate (2026-01-11), not endDate
		// (unset here) — formatSaleDateLabel() renders a locale-formatted
		// weekday/day/month, so assert on the marker and month.
		expect(
			screen.getByText( /until .*January.*\(default\)/ )
		).toBeInTheDocument();
	} );
} );

describe( 'EventTickets — automatic first start from site-local today (#1582)', () => {
	const originalManageEventData = window.fairEventsManageEventData;

	afterEach( () => {
		window.fairEventsManageEventData = originalManageEventData;
	} );

	const initialDataWithUnsetStart = {
		...initialDataWithTicketType,
		sale_periods: [
			{ id: 901, name: '', sale_start: '', sale_end: '2026-08-01' },
		],
		prices: [ { ticket_type_id: 1, sale_period_id: 901, price: '10' } ],
	};

	it( "shows the first period's missing start as today while today precedes its end", async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( { initialData: initialDataWithUnsetStart } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect(
			screen.getByText( /From .*July.*\(default\)/ )
		).toBeInTheDocument();
	} );

	it( 'shows "—" once today reaches the period\'s end — an expired period never reactivates', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-08-01' };
		await renderTickets( { initialData: initialDataWithUnsetStart } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( screen.getByText( '—' ) ).toBeInTheDocument();
	} );

	it( 'shows the resolved date as the "From" field placeholder without freezing a value', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( { initialData: initialDataWithUnsetStart } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		const fromInput = screen.getByLabelText( 'From' );
		expect( fromInput.value ).toBe( '' );
		expect( fromInput.placeholder ).toBe( '2026-07-15' );
	} );

	it( "shows the event's creation day as the missing start when it precedes today (#1841)", async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( {
			initialData: {
				...initialDataWithUnsetStart,
				created_date: '2026-06-01',
			},
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect(
			screen.getByText( /From .*\b(1 June|June 1)\b.*\(default\)/ )
		).toBeInTheDocument();
		const fromInput = screen.getByLabelText( 'From' );
		expect( fromInput.value ).toBe( '' );
		expect( fromInput.placeholder ).toBe( '2026-06-01' );
		expect(
			screen.getByText(
				'Starts automatically on the day this event was created.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps showing the creation-day start after the period has ended', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-08-10' };
		await renderTickets( {
			initialData: {
				...initialDataWithUnsetStart,
				created_date: '2026-06-01',
			},
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect(
			screen.getByText( /From .*\b(1 June|June 1)\b.*\(default\)/ )
		).toBeInTheDocument();
	} );

	it( 'falls back to today when the creation day is later than today', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		await renderTickets( {
			initialData: {
				...initialDataWithUnsetStart,
				created_date: '2026-07-20',
			},
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( screen.getByLabelText( 'From' ).placeholder ).toBe(
			'2026-07-15'
		);
	} );

	it( 'never saves the inferred creation-day start', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-07-15' };
		const payloadSaveRef = { current: null };
		apiFetch.mockImplementation( () => new Promise( () => {} ) );
		await renderTickets( {
			initialData: {
				...initialDataWithUnsetStart,
				created_date: '2026-06-01',
			},
			payloadSaveRef,
		} );

		const payload = savePayload( payloadSaveRef );

		expect( payload.sale_periods[ 0 ].sale_start ).toBeFalsy();
		expect( payload ).not.toHaveProperty( 'created_date' );
	} );

	it( 'warns when the event has no usable schedule to resolve an automatic end', async () => {
		const { container } = await renderTickets( {
			initialData: {
				...initialDataWithTicketType,
				sale_periods: [
					{
						id: 902,
						name: '',
						sale_start: '2026-01-01',
						sale_end: '',
					},
				],
				prices: [
					{ ticket_type_id: 1, sale_period_id: 902, price: '10' },
				],
			},
			// No startDate/endDate/lastOccurrenceDate supplied —
			// nothing to anchor a default end to.
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect(
			within( container ).getByText( /no usable schedule/i )
		).toBeInTheDocument();
	} );
} );

describe( 'EventTickets — move an activity to the top (#1728)', () => {
	const activity = ( id, name, sortOrder ) => ( {
		id,
		name,
		short_name: '',
		price: 0,
		capacity: null,
		period_prices: [],
		sort_order: sortOrder,
	} );

	const initialDataWithActivities = {
		...initialDataWithTicketType,
		options: [
			activity( 11, 'Yoga', 0 ),
			activity( 12, 'Dinner', 1 ),
			activity( 13, 'Hike', 2 ),
		],
	};

	// The Add-ons panel starts collapsed.
	const renderActivities = async ( extraProps = {} ) => {
		const result = await renderTickets( {
			initialData: initialDataWithActivities,
			...extraProps,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add-ons' } ) );
		return result;
	};

	const activityNames = ( container ) =>
		Array.from(
			container.querySelectorAll( 'input[placeholder="Add-on name"]' )
		).map( ( input ) => input.value );

	it( 'moveToTop keeps the other items in their relative order', async () => {
		expect( moveToTop( [ 'a', 'b', 'c', 'd' ], 2 ) ).toEqual( [
			'c',
			'a',
			'b',
			'd',
		] );
		const items = [ 'a', 'b' ];
		expect( moveToTop( items, 0 ) ).toBe( items );
	} );

	it( 'offers "Move to top" on every activity except the first', async () => {
		const { container } = await renderActivities();

		const rows = Array.from(
			container.querySelectorAll( 'input[placeholder="Add-on name"]' )
		).map( ( input ) => input.closest( 'tr' ) );

		expect(
			within( rows[ 0 ] ).queryByRole( 'button', {
				name: 'Move to top',
			} )
		).not.toBeInTheDocument();
		expect(
			within( rows[ 1 ] ).getByRole( 'button', { name: 'Move to top' } )
		).toBeInTheDocument();
		expect(
			within( rows[ 2 ] ).getByRole( 'button', { name: 'Move to top' } )
		).toBeInTheDocument();
	} );

	it( 'moves the activity first immediately, keeping unsaved edits attached', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderActivities( { onDirtyChange } );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		// An unsaved edit on the row being moved must travel with it.
		const hikeInput = screen.getByDisplayValue( 'Hike' );
		fireEvent.change( hikeInput, { target: { value: 'Hike (long)' } } );

		const hikeRow = hikeInput.closest( 'tr' );
		fireEvent.click(
			within( hikeRow ).getByRole( 'button', { name: 'Move to top' } )
		);

		expect( activityNames( container ) ).toEqual( [
			'Hike (long)',
			'Yoga',
			'Dinner',
		] );
		// Same DOM input stays bound to the same activity after reordering.
		expect( hikeInput ).toHaveValue( 'Hike (long)' );
		expect( hikeRow.parentElement.firstElementChild ).toBe( hikeRow );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'marks the editor dirty for a reorder alone', async () => {
		const onDirtyChange = jest.fn();
		await renderActivities( { onDirtyChange } );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		const dinnerRow = screen.getByDisplayValue( 'Dinner' ).closest( 'tr' );
		fireEvent.click(
			within( dinnerRow ).getByRole( 'button', { name: 'Move to top' } )
		);

		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'saves the new order with unchanged activity IDs', async () => {
		const { onSaveRef } = await renderActivities();

		const hikeRow = screen.getByDisplayValue( 'Hike' ).closest( 'tr' );
		fireEvent.click(
			within( hikeRow ).getByRole( 'button', { name: 'Move to top' } )
		);

		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( initialDataWithActivities );
			}
			return new Promise( () => {} );
		} );

		await act( async () => {
			await onSaveRef.current();
		} );

		expect(
			savedPayload.options.map( ( { id, name, sort_order: order } ) => ( {
				id,
				name,
				order,
			} ) )
		).toEqual( [
			{ id: 13, name: 'Hike', order: 0 },
			{ id: 11, name: 'Yoga', order: 1 },
			{ id: 12, name: 'Dinner', order: 2 },
		] );
		// The client-only row key never reaches the server.
		savedPayload.options.forEach( ( option ) =>
			expect( option ).not.toHaveProperty( 'client_key' )
		);
	} );
} );

describe( 'EventTickets — move a ticket type to the top (#1757)', () => {
	const ticketType = ( id, name, sortOrder, extra = {} ) => ( {
		id,
		name,
		capacity: null,
		minimum_activities: 0,
		maximum_activities: null,
		activities_enabled: true,
		disable_at: null,
		recurrence_scope: 'single_instance',
		group_ids: [],
		sort_order: sortOrder,
		...extra,
	} );

	const initialDataWithTypes = {
		...emptyInitialData,
		ticket_types: [
			ticketType( 21, 'Standard', 0 ),
			ticketType( 22, 'Student', 1, { has_sales: true } ),
			ticketType( 23, 'Supporter', 2, { capacity: 5 } ),
		],
		sale_periods: [
			{
				id: 801,
				name: '',
				sale_start: '2026-01-01',
				sale_end: '2026-02-01',
			},
		],
		prices: [
			{ ticket_type_id: 21, sale_period_id: 801, price: 20 },
			{ ticket_type_id: 22, sale_period_id: 801, price: 12 },
			{ ticket_type_id: 23, sale_period_id: 801, price: 35 },
		],
	};

	const typeRows = ( container ) =>
		Array.from(
			container.querySelectorAll( 'input[placeholder="Type name"]' )
		).map( ( input ) => input.closest( 'tr' ) );

	const rowName = ( row ) =>
		row.querySelector( 'input[placeholder="Type name"]' ).value;

	// The per-cell Price input is the only spinbutton carrying step="0.01".
	const rowPriceInput = ( row ) => row.querySelector( 'input[step="0.01"]' );

	const rowSummary = ( container ) =>
		typeRows( container ).map( ( row ) => [
			rowName( row ),
			rowPriceInput( row ).value,
		] );

	const moveToTopButton = ( row ) =>
		within( row ).queryByRole( 'button', { name: 'Move to top' } );

	async function saveAndCapturePayload( onSaveRef ) {
		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( initialDataWithTypes );
			}
			return new Promise( () => {} );
		} );
		await act( async () => {
			await onSaveRef.current();
		} );
		return savedPayload;
	}

	it( 'offers "Move to top" on every ticket type except the first', async () => {
		const { container } = await renderTickets( {
			initialData: initialDataWithTypes,
		} );
		const rows = typeRows( container );

		expect( moveToTopButton( rows[ 0 ] ) ).not.toBeInTheDocument();
		expect( moveToTopButton( rows[ 1 ] ) ).toBeInTheDocument();
		expect( moveToTopButton( rows[ 2 ] ) ).toBeInTheDocument();
		// The action sits beside the row's existing Enabled / Remove control.
		expect(
			within( rows[ 1 ] ).getByRole( 'checkbox', { name: 'Enabled' } )
		).toBeInTheDocument();
		expect(
			within( rows[ 2 ] ).getByRole( 'button', { name: 'Remove' } )
		).toBeInTheDocument();
	} );

	it( 'moves the type first immediately, keeping the others in order and marking the editor dirty', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderTickets( {
			initialData: initialDataWithTypes,
			onDirtyChange,
		} );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		const supporterRow = typeRows( container )[ 2 ];
		fireEvent.click( moveToTopButton( supporterRow ) );

		expect( rowSummary( container ) ).toEqual( [
			[ 'Supporter', '35' ],
			[ 'Standard', '20' ],
			[ 'Student', '12' ],
		] );
		// The same DOM row moved; it was not re-created.
		expect( typeRows( container )[ 0 ] ).toBe( supporterRow );
		expect( moveToTopButton( supporterRow ) ).not.toBeInTheDocument();
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
	} );

	it( 'saves the new order with unchanged IDs, configuration, and prices', async () => {
		const { container, onSaveRef } = await renderTickets( {
			initialData: initialDataWithTypes,
		} );

		fireEvent.click( moveToTopButton( typeRows( container )[ 2 ] ) );
		const savedPayload = await saveAndCapturePayload( onSaveRef );

		expect(
			savedPayload.ticket_types.map(
				( { id, name, capacity, sort_order: order } ) => ( {
					id,
					name,
					capacity,
					order,
				} )
			)
		).toEqual( [
			{ id: 23, name: 'Supporter', capacity: 5, order: 0 },
			{ id: 21, name: 'Standard', capacity: null, order: 1 },
			{ id: 22, name: 'Student', capacity: null, order: 2 },
		] );
		expect(
			savedPayload.prices.map(
				( { ticket_type_index: index, price } ) => [ index, price ]
			)
		).toEqual( [
			[ 0, 35 ],
			[ 1, 20 ],
			[ 2, 12 ],
		] );
	} );

	it( 'keeps unsaved ticket types attached to their own fields and prices', async () => {
		const { container, onSaveRef } = await renderTickets( {
			initialData: initialDataWithTypes,
		} );

		// Two unsaved types, each with its own name and price.
		const addUnsavedType = ( name, price ) => {
			fireEvent.click(
				screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
			);
			const row = typeRows( container ).pop();
			fireEvent.change(
				row.querySelector( 'input[placeholder="Type name"]' ),
				{ target: { value: name } }
			);
			fireEvent.change( rowPriceInput( row ), {
				target: { value: price },
			} );
		};
		addUnsavedType( 'Kids', '5' );
		addUnsavedType( 'Patron', '80' );

		const patronRow = typeRows( container )[ 4 ];
		fireEvent.click( moveToTopButton( patronRow ) );
		// Moving the other unsaved type shifts every row's index again.
		const kidsRow = typeRows( container )[ 4 ];
		expect( rowName( kidsRow ) ).toBe( 'Kids' );
		fireEvent.click( moveToTopButton( kidsRow ) );

		expect( rowSummary( container ) ).toEqual( [
			[ 'Kids', '5' ],
			[ 'Patron', '80' ],
			[ 'Standard', '20' ],
			[ 'Student', '12' ],
			[ 'Supporter', '35' ],
		] );
		expect( typeRows( container ).slice( 0, 2 ) ).toEqual( [
			kidsRow,
			patronRow,
		] );

		// A price typed after the move still lands on the moved type.
		fireEvent.change( rowPriceInput( patronRow ), {
			target: { value: '90' },
		} );

		const savedPayload = await saveAndCapturePayload( onSaveRef );

		expect(
			savedPayload.ticket_types.map( ( { id, name } ) => [ id, name ] )
		).toEqual( [
			[ undefined, 'Kids' ],
			[ undefined, 'Patron' ],
			[ 21, 'Standard' ],
			[ 22, 'Student' ],
			[ 23, 'Supporter' ],
		] );
		expect(
			savedPayload.prices.map(
				( { ticket_type_index: index, price } ) => [ index, price ]
			)
		).toEqual( [
			[ 0, 5 ],
			[ 1, 90 ],
			[ 2, 20 ],
			[ 3, 12 ],
			[ 4, 35 ],
		] );
		// The client-only row identity never reaches the server.
		savedPayload.ticket_types.forEach( ( type ) =>
			expect( type ).not.toHaveProperty( 'client_key' )
		);
	} );
} );

describe( 'EventTickets — reorder add-ons in a popup (#1765)', () => {
	const salePeriod = {
		id: 801,
		name: '',
		sale_start: '2026-01-01',
		sale_end: '2026-02-01',
	};

	const addon = ( id, name, sortOrder, extra = {} ) => ( {
		id,
		name,
		short_name: '',
		price: 0,
		capacity: null,
		period_prices: [],
		sort_order: sortOrder,
		...extra,
	} );

	const initialDataWithAddons = {
		...initialDataWithTicketType,
		sale_periods: [ salePeriod ],
		settings: { activity_period_pricing: true },
		options: [
			// collaborator_ids: a legacy field older responses still carry.
			addon( 11, 'Yoga', 0, {
				short_name: 'YG',
				capacity: 12,
				collaborator_ids: [ 501, 502 ],
				period_prices: [ { sale_period_id: 801, price: 7.5 } ],
			} ),
			addon( 12, 'Dinner', 1, {
				capacity: 40,
				period_prices: [ { sale_period_id: 801, price: 25 } ],
			} ),
			addon( 13, 'Hike', 2, { collaborator_ids: [ 503 ] } ),
		],
	};

	// The Add-ons panel starts collapsed.
	const renderAddons = async ( extraProps = {} ) => {
		const result = await renderTickets( {
			initialData: initialDataWithAddons,
			...extraProps,
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add-ons' } ) );
		return result;
	};

	const editorNames = ( container ) =>
		Array.from(
			container.querySelectorAll( 'input[placeholder="Add-on name"]' )
		).map( ( input ) => input.value );

	const openPopup = () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Reorder add-ons' } )
		);
		return screen.getByRole( 'dialog', { name: 'Reorder add-ons' } );
	};

	const closePopup = async () => {
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Reorder add-ons' } )
			).not.toBeInTheDocument()
		);
	};

	const savePayload = async ( onSaveRef ) => {
		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( initialDataWithAddons );
			}
			return new Promise( () => {} );
		} );
		await act( async () => {
			await onSaveRef.current();
		} );
		return savedPayload;
	};

	const writeCalls = () =>
		apiFetch.mock.calls.filter(
			( [ request ] ) => request.method && request.method !== 'GET'
		);

	it( 'offers the popup only when there are at least two add-ons', async () => {
		await renderTickets( {
			initialData: {
				...initialDataWithAddons,
				options: [ initialDataWithAddons.options[ 0 ] ],
			},
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add-ons' } ) );
		expect(
			screen.queryByRole( 'button', { name: 'Reorder add-ons' } )
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Option' } )
		);
		expect(
			screen.getByRole( 'button', { name: 'Reorder add-ons' } )
		).toBeInTheDocument();
	} );

	it( 'opens and closes without saving or touching other edits', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderAddons( { onDirtyChange } );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		const dialog = openPopup();
		expect(
			within( dialog )
				.getAllByRole( 'listitem' )
				.map( ( row ) => row.textContent )
		).toEqual( [ 'Yoga', 'Dinner', 'Hike' ] );
		await closePopup();

		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );
		expect( writeCalls() ).toEqual( [] );

		// An unsaved edit elsewhere in Prices survives a visit to the popup,
		// and the popup lists the edited name.
		fireEvent.change( screen.getByDisplayValue( 'Dinner' ), {
			target: { value: 'Gala dinner' },
		} );
		fireEvent.change( screen.getByPlaceholderText( 'Type name' ), {
			target: { value: 'General admission' },
		} );
		expect(
			within( openPopup() ).getByText( 'Gala dinner' )
		).toBeInTheDocument();
		await closePopup();

		expect( editorNames( container ) ).toEqual( [
			'Yoga',
			'Gala dinner',
			'Hike',
		] );
		expect( screen.getByPlaceholderText( 'Type name' ) ).toHaveValue(
			'General admission'
		);
		expect( writeCalls() ).toEqual( [] );
	} );

	it( 'applies each move to the editor at once and marks Prices unsaved', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderAddons( { onDirtyChange } );

		openPopup();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Hike up' } )
		);
		expect( editorNames( container ) ).toEqual( [
			'Yoga',
			'Hike',
			'Dinner',
		] );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );

		// Closing keeps the reordered draft and still saves nothing.
		await closePopup();
		expect( editorNames( container ) ).toEqual( [
			'Yoga',
			'Hike',
			'Dinner',
		] );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
		expect( writeCalls() ).toEqual( [] );
	} );

	it( 'is clean again once the add-ons are back in their saved order', async () => {
		const onDirtyChange = jest.fn();
		await renderAddons( { onDirtyChange } );

		openPopup();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Yoga down' } )
		);
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Yoga up' } )
		);
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );
	} );

	it( 'keeps "Move to top" working alongside the popup', async () => {
		const { container } = await renderAddons();

		openPopup();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move Yoga down' } )
		);
		await closePopup();

		const hikeRow = screen.getByDisplayValue( 'Hike' ).closest( 'tr' );
		fireEvent.click(
			within( hikeRow ).getByRole( 'button', { name: 'Move to top' } )
		);
		expect( editorNames( container ) ).toEqual( [
			'Hike',
			'Dinner',
			'Yoga',
		] );
	} );

	it( 'saves the new order with every add-on’s own details', async () => {
		const { onSaveRef } = await renderAddons();

		// An add-on that has never been saved takes part too.
		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Option' } )
		);
		const newRow = screen
			.getAllByPlaceholderText( 'Add-on name' )
			.pop()
			.closest( 'tr' );
		fireEvent.change(
			within( newRow ).getByPlaceholderText( 'Add-on name' ),
			{
				target: { value: 'Sauna' },
			}
		);
		fireEvent.change(
			within( newRow ).getByPlaceholderText( 'Unlimited' ),
			{
				target: { value: '6' },
			}
		);

		openPopup();
		// Sauna: last → first. Yoga: second → last.
		[ 1, 2, 3 ].forEach( () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Move Sauna up' } )
			)
		);
		[ 1, 2 ].forEach( () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Move Yoga down' } )
			)
		);
		await closePopup();

		const savedPayload = await savePayload( onSaveRef );

		expect(
			savedPayload.options.map( ( option ) => ( {
				id: option.id,
				name: option.name,
				short_name: option.short_name,
				order: option.sort_order,
				capacity: option.capacity,
				period_prices: option.period_prices.map(
					( { sale_period_id: periodId, price } ) => [
						periodId,
						price,
					]
				),
			} ) )
		).toEqual( [
			{
				id: undefined,
				name: 'Sauna',
				short_name: '',
				order: 0,
				capacity: 6,
				period_prices: [],
			},
			{
				id: 12,
				name: 'Dinner',
				short_name: '',
				order: 1,
				capacity: 40,
				period_prices: [ [ 801, 25 ] ],
			},
			{
				id: 13,
				name: 'Hike',
				short_name: '',
				order: 2,
				capacity: null,
				period_prices: [],
			},
			{
				id: 11,
				name: 'Yoga',
				short_name: 'YG',
				order: 3,
				capacity: 12,
				period_prices: [ [ 801, 7.5 ] ],
			},
		] );
		// The client-only row key never reaches the server, and neither do
		// the legacy add-on collaborator assignments the fixture carries.
		savedPayload.options.forEach( ( option ) => {
			expect( option ).not.toHaveProperty( 'client_key' );
			expect( option ).not.toHaveProperty( 'collaborator_ids' );
		} );
	} );
} );

describe( 'EventTickets — add-on collaborator assignments removed (#1793)', () => {
	// A response from before the removal: every add-on still names
	// participants.
	const legacyData = {
		...initialDataWithTicketType,
		options: [
			{
				id: 21,
				name: 'Yoga',
				short_name: 'YG',
				price: 7,
				capacity: 12,
				collaborator_ids: [ 501, 502 ],
				period_prices: [],
				sort_order: 0,
			},
			{
				id: 22,
				name: 'Dinner',
				short_name: '',
				price: 25,
				capacity: null,
				collaborator_ids: [ 503 ],
				period_prices: [],
				sort_order: 1,
			},
		],
	};

	const openAddons = () =>
		fireEvent.click( screen.getByRole( 'button', { name: 'Add-ons' } ) );

	it( 'shows add-ons without a collaborator column or participant selector', async () => {
		const { container } = await renderTickets( {
			initialData: legacyData,
		} );
		openAddons();

		expect(
			Array.from(
				container.querySelectorAll( 'input[placeholder="Add-on name"]' )
			).map( ( input ) => input.value )
		).toEqual( [ 'Yoga', 'Dinner' ] );
		expect(
			screen.queryByText( 'Collaborator(s)' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByPlaceholderText( 'Add participants' )
		).not.toBeInTheDocument();
		expect( screen.queryByText( '#501' ) ).not.toBeInTheDocument();
	} );

	it( 'does not request the participant list', async () => {
		await renderTickets( { initialData: legacyData } );
		openAddons();

		const paths = apiFetch.mock.calls.map(
			( [ request ] ) => request.path
		);
		expect( paths ).toContain( '/fair-audience/v1/groups' );
		expect(
			paths.filter( ( path ) => path.includes( '/participants' ) )
		).toEqual( [] );
	} );

	it( 'saves legacy and new add-ons without assignments', async () => {
		const { onSaveRef } = await renderTickets( {
			initialData: legacyData,
		} );
		openAddons();
		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Option' } )
		);
		const nameInputs = screen.getAllByPlaceholderText( 'Add-on name' );
		fireEvent.change( nameInputs[ nameInputs.length - 1 ], {
			target: { value: 'Sauna' },
		} );

		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( legacyData );
			}
			return new Promise( () => {} );
		} );
		await act( async () => {
			await onSaveRef.current();
		} );

		expect( savedPayload.options.map( ( option ) => option.name ) ).toEqual(
			[ 'Yoga', 'Dinner', 'Sauna' ]
		);
		expect( savedPayload.options[ 0 ] ).toMatchObject( {
			id: 21,
			short_name: 'YG',
			price: 7,
			capacity: 12,
			sort_order: 0,
		} );
		savedPayload.options.forEach( ( option ) =>
			expect( option ).not.toHaveProperty( 'collaborator_ids' )
		);
	} );

	it( 'exports add-ons without assignments', async () => {
		const blobParts = [];
		jest.spyOn( global, 'Blob' ).mockImplementation( ( parts ) => {
			blobParts.push( parts );
			return {};
		} );
		const originalCreate = URL.createObjectURL;
		const originalRevoke = URL.revokeObjectURL;
		URL.createObjectURL = jest.fn( () => 'blob:tickets' );
		URL.revokeObjectURL = jest.fn();
		// jsdom would queue a navigation to the blob URL that fails in a
		// later test.
		const download = jest
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => {} );

		try {
			await renderTickets( { initialData: legacyData } );
			fireEvent.click(
				screen.getByRole( 'button', { name: 'More actions' } )
			);
			fireEvent.click(
				screen.getByRole( 'menuitem', {
					name: 'Export ticket settings',
				} )
			);
		} finally {
			URL.createObjectURL = originalCreate;
			URL.revokeObjectURL = originalRevoke;
		}

		expect( download ).toHaveBeenCalledTimes( 1 );
		expect( blobParts ).toHaveLength( 1 );
		const exported = JSON.parse( blobParts[ 0 ][ 0 ] );
		expect( exported.options.map( ( option ) => option.name ) ).toEqual( [
			'Yoga',
			'Dinner',
		] );
		expect( exported.options[ 0 ] ).toMatchObject( {
			short_name: 'YG',
			price: 7,
			capacity: 12,
		} );
		exported.options.forEach( ( option ) =>
			expect( option ).not.toHaveProperty( 'collaborator_ids' )
		);
	} );
} );

describe( 'EventTickets — workshop schedule setting (#1767)', () => {
	const originalManageEventData = window.fairEventsManageEventData;

	afterEach( () => {
		window.fairEventsManageEventData = originalManageEventData;
	} );

	it( 'is not offered when no plugin provides the Schedule tab', async () => {
		window.fairEventsManageEventData = { enabledFeatures: {} };
		await renderTickets( { initialData: initialDataWithTicketType } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);

		expect(
			screen.queryByRole( 'checkbox', { name: /Workshop schedule/i } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the saved state and can be switched on', async () => {
		window.fairEventsManageEventData = {
			enabledFeatures: { schedule: true },
		};
		await renderTickets( { initialData: initialDataWithTicketType } );

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		const checkbox = screen.getByRole( 'checkbox', {
			name: /Workshop schedule/i,
		} );
		expect( checkbox ).not.toBeChecked();

		fireEvent.click( checkbox );

		expect( checkbox ).toBeChecked();
	} );
} );

describe( 'EventTickets — duplicate an add-on (#1785)', () => {
	const addon = ( id, name, sortOrder, extra = {} ) => ( {
		id,
		name,
		short_name: '',
		price: 0,
		capacity: null,
		period_prices: [],
		sort_order: sortOrder,
		...extra,
	} );

	const flatData = {
		...initialDataWithTicketType,
		options: [
			// collaborator_ids: a legacy field older responses still carry.
			addon( 31, 'Yoga', 0, {
				short_name: 'YG',
				price: 7,
				capacity: 12,
				collaborator_ids: [ 501, 502 ],
			} ),
			addon( 32, 'Dinner', 1 ),
		],
	};

	// One saved sale period and one that has no ID yet.
	const periodData = {
		...initialDataWithTicketType,
		sale_periods: [
			{
				id: 801,
				name: 'Early',
				sale_start: '2026-01-01',
				sale_end: '2026-02-01',
			},
			{ name: 'Late', sale_start: '2026-02-01', sale_end: '2026-03-01' },
		],
		settings: {
			activity_period_pricing: true,
			multiple_pricing_periods: true,
		},
		options: [
			addon( 41, 'Yoga', 0, {
				period_prices: [ { sale_period_id: 801, price: 7.5 } ],
			} ),
			addon( 42, 'Dinner', 1 ),
		],
	};

	// The Add-ons panel starts collapsed.
	const renderAddons = async ( initialData, extraProps = {} ) => {
		const result = await renderTickets( { initialData, ...extraProps } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add-ons' } ) );
		return result;
	};

	const rows = ( container ) =>
		Array.from(
			container.querySelectorAll( 'input[placeholder="Add-on name"]' )
		).map( ( input ) => input.closest( 'tr' ) );

	const editorNames = ( container ) =>
		Array.from(
			container.querySelectorAll( 'input[placeholder="Add-on name"]' )
		).map( ( input ) => input.value );

	const duplicate = ( row ) =>
		fireEvent.click(
			within( row ).getByRole( 'button', { name: 'Duplicate' } )
		);

	const savePayload = async ( onSaveRef, response ) => {
		let savedPayload = null;
		apiFetch.mockImplementation( ( { method, data } ) => {
			if ( method === 'PUT' ) {
				savedPayload = data;
				return Promise.resolve( response );
			}
			return new Promise( () => {} );
		} );
		await act( async () => {
			await onSaveRef.current();
		} );
		return savedPayload;
	};

	const writeCalls = () =>
		apiFetch.mock.calls.filter(
			( [ request ] ) => request.method && request.method !== 'GET'
		);

	it( 'duplicateOption inserts a configuration-only copy after the source', async () => {
		const source = {
			id: 5,
			name: 'Yoga',
			short_name: 'YG',
			price: 7,
			capacity: 12,
			derive_price_from_sale_period: true,
			period_prices_map: { 801: '7.5', 'new-1': '' },
			collaborator_ids: [ 501 ],
			event_date_id: 99,
			sort_order: 0,
			client_key: 'option-source',
		};
		const other = { id: 6, name: 'Dinner', client_key: 'option-other' };
		const items = [ source, other ];

		const result = duplicateOption( items, 0 );

		expect( result ).toHaveLength( 3 );
		expect( result[ 0 ] ).toBe( source );
		expect( result[ 2 ] ).toBe( other );
		const { client_key: copyKey, ...copy } = result[ 1 ];
		expect( copy ).toEqual( {
			name: 'Yoga Copy',
			short_name: 'YG',
			price: 7,
			capacity: 12,
			derive_price_from_sale_period: true,
			period_prices_map: { 801: '7.5', 'new-1': '' },
		} );
		expect( copyKey ).toBeTruthy();
		expect( copyKey ).not.toBe( source.client_key );
		expect( result[ 1 ].period_prices_map ).not.toBe(
			source.period_prices_map
		);
		// The input array and the source are left untouched.
		expect( items ).toEqual( [ source, other ] );
		expect( duplicateOption( items, 7 ) ).toBe( items );
	} );

	it( 'keeps a blank name blank instead of naming the copy "Copy"', async () => {
		const [ , copy ] = duplicateOption( [ { name: '', price: 0 } ], 0 );
		expect( copy.name ).toBe( '' );
		expect( copy.capacity ).toBeNull();
	} );

	it( 'offers "Duplicate" as a button on every add-on row', async () => {
		const { container } = await renderAddons( flatData );
		const addonRows = rows( container );
		expect( addonRows ).toHaveLength( 2 );
		addonRows.forEach( ( row ) =>
			expect(
				within( row ).getByRole( 'button', { name: 'Duplicate' } )
			).toBeEnabled()
		);
	} );

	it( 'copies unsaved edits right after the source without saving', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderAddons( flatData, { onDirtyChange } );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );

		const yogaRow = rows( container )[ 0 ];
		fireEvent.change( within( yogaRow ).getByDisplayValue( 'Yoga' ), {
			target: { value: 'Yoga flow' },
		} );
		fireEvent.change( within( yogaRow ).getByDisplayValue( 'YG' ), {
			target: { value: 'YF' },
		} );
		const [ price, capacity ] =
			within( yogaRow ).getAllByRole( 'spinbutton' );
		fireEvent.change( price, { target: { value: '9.5' } } );
		fireEvent.change( capacity, { target: { value: '15' } } );

		duplicate( yogaRow );

		expect( editorNames( container ) ).toEqual( [
			'Yoga flow',
			'Yoga flow Copy',
			'Dinner',
		] );
		const copyRow = rows( container )[ 1 ];
		expect(
			within( copyRow ).getByPlaceholderText( 'Short name' )
		).toHaveValue( 'YF' );
		const [ copyPrice, copyCapacity ] =
			within( copyRow ).getAllByRole( 'spinbutton' );
		expect( copyPrice ).toHaveValue( 9.5 );
		expect( copyCapacity ).toHaveValue( 15 );
		// The source row keeps its own DOM row and values.
		expect( rows( container )[ 0 ] ).toBe( yogaRow );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
		expect( writeCalls() ).toEqual( [] );
	} );

	it( 'saves the copy as a new add-on and keeps the source ID', async () => {
		const { container, onSaveRef } = await renderAddons( flatData );

		// Dinner: unlimited capacity and a zero price.
		duplicate( rows( container )[ 1 ] );
		duplicate( rows( container )[ 0 ] );

		const payload = await savePayload( onSaveRef, flatData );

		expect(
			payload.options.map(
				( {
					id,
					name,
					short_name: shortName,
					price,
					capacity,
					sort_order: order,
				} ) => ( { id, name, shortName, price, capacity, order } )
			)
		).toEqual( [
			{
				id: 31,
				name: 'Yoga',
				shortName: 'YG',
				price: 7,
				capacity: 12,
				order: 0,
			},
			{
				id: undefined,
				name: 'Yoga Copy',
				shortName: 'YG',
				price: 7,
				capacity: 12,
				order: 1,
			},
			{
				id: 32,
				name: 'Dinner',
				shortName: '',
				price: 0,
				capacity: null,
				order: 2,
			},
			{
				id: undefined,
				name: 'Dinner Copy',
				shortName: '',
				price: 0,
				capacity: null,
				order: 3,
			},
		] );
		payload.options.forEach( ( option ) => {
			expect( option ).not.toHaveProperty( 'collaborator_ids' );
			expect( option ).not.toHaveProperty( 'client_key' );
		} );
		expect( payload.options[ 1 ] ).not.toHaveProperty( 'id' );
		expect( payload.options[ 3 ] ).not.toHaveProperty( 'id' );
	} );

	it( 'lets the source and the copy be edited and removed independently', async () => {
		const { container } = await renderAddons( flatData );
		duplicate( rows( container )[ 0 ] );

		const [ sourceRow, copyRow ] = rows( container );
		fireEvent.change( within( copyRow ).getByDisplayValue( 'Yoga Copy' ), {
			target: { value: 'Evening yoga' },
		} );
		fireEvent.change( within( copyRow ).getAllByRole( 'spinbutton' )[ 1 ], {
			target: { value: '' },
		} );
		fireEvent.change(
			within( sourceRow ).getAllByRole( 'spinbutton' )[ 0 ],
			{
				target: { value: '11' },
			}
		);

		expect( editorNames( container ) ).toEqual( [
			'Yoga',
			'Evening yoga',
			'Dinner',
		] );
		expect(
			within( sourceRow ).getAllByRole( 'spinbutton' )[ 1 ]
		).toHaveValue( 12 );
		expect(
			within( copyRow ).getAllByRole( 'spinbutton' )[ 0 ]
		).toHaveValue( 7 );
		expect(
			within( copyRow ).getAllByRole( 'spinbutton' )[ 1 ]
		).toHaveValue( null );

		// Removing the source leaves the copy, and the other way round.
		fireEvent.click(
			within( sourceRow ).getByRole( 'button', { name: 'Remove' } )
		);
		expect( editorNames( container ) ).toEqual( [
			'Evening yoga',
			'Dinner',
		] );
		duplicate( rows( container )[ 1 ] );
		fireEvent.click(
			within( rows( container )[ 2 ] ).getByRole( 'button', {
				name: 'Remove',
			} )
		);
		expect( editorNames( container ) ).toEqual( [
			'Evening yoga',
			'Dinner',
		] );
	} );

	it( 'duplicates a newly added add-on, repeatedly', async () => {
		const { container, onSaveRef } = await renderAddons( flatData );
		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Option' } )
		);
		const newRow = rows( container )[ 2 ];
		fireEvent.change(
			within( newRow ).getByPlaceholderText( 'Add-on name' ),
			{
				target: { value: 'Sauna' },
			}
		);

		duplicate( newRow );
		// A second copy of the source lands between it and the first copy.
		duplicate( newRow );
		fireEvent.change(
			within( rows( container )[ 3 ] ).getByPlaceholderText(
				'Add-on name'
			),
			{ target: { value: 'Sauna late' } }
		);
		// A copy can be duplicated too.
		duplicate( rows( container )[ 4 ] );

		expect( editorNames( container ) ).toEqual( [
			'Yoga',
			'Dinner',
			'Sauna',
			'Sauna late',
			'Sauna Copy',
			'Sauna Copy Copy',
		] );

		const payload = await savePayload( onSaveRef, flatData );
		expect(
			payload.options.map( ( { id, name } ) => [ id, name ] )
		).toEqual( [
			[ 31, 'Yoga' ],
			[ 32, 'Dinner' ],
			[ undefined, 'Sauna' ],
			[ undefined, 'Sauna late' ],
			[ undefined, 'Sauna Copy' ],
			[ undefined, 'Sauna Copy Copy' ],
		] );
	} );

	it( 'copies sale-period prices, including blank ones and unsaved periods', async () => {
		const { container, onSaveRef } = await renderAddons( periodData );
		const yogaRow = rows( container )[ 0 ];
		expect( within( yogaRow ).getByLabelText( 'Early' ) ).toHaveValue(
			7.5
		);
		// An unsaved price for the sale period that has no ID yet.
		fireEvent.change( within( yogaRow ).getByLabelText( 'Late' ), {
			target: { value: '9' },
		} );

		duplicate( yogaRow );
		// Dinner has no period prices at all.
		duplicate( rows( container )[ 2 ] );

		const copyRow = rows( container )[ 1 ];
		expect( within( copyRow ).getByLabelText( 'Early' ) ).toHaveValue(
			7.5
		);
		expect( within( copyRow ).getByLabelText( 'Late' ) ).toHaveValue( 9 );

		// Period prices are independent after the copy.
		fireEvent.change( within( copyRow ).getByLabelText( 'Early' ), {
			target: { value: '5' },
		} );
		fireEvent.change( within( yogaRow ).getByLabelText( 'Late' ), {
			target: { value: '' },
		} );
		expect( within( yogaRow ).getByLabelText( 'Early' ) ).toHaveValue(
			7.5
		);
		expect( within( copyRow ).getByLabelText( 'Late' ) ).toHaveValue( 9 );

		const payload = await savePayload( onSaveRef, periodData );
		expect(
			payload.options.map(
				( { id, name, period_prices: periodPrices } ) => ( {
					id,
					name,
					periodPrices,
				} )
			)
		).toEqual( [
			{
				id: 41,
				name: 'Yoga',
				periodPrices: [
					{ sale_period_index: 0, price: 7.5, sale_period_id: 801 },
				],
			},
			{
				id: undefined,
				name: 'Yoga Copy',
				periodPrices: [
					{ sale_period_index: 0, price: 5, sale_period_id: 801 },
					{ sale_period_index: 1, price: 9 },
				],
			},
			{ id: 42, name: 'Dinner', periodPrices: [] },
			{ id: undefined, name: 'Dinner Copy', periodPrices: [] },
		] );
		payload.options.forEach( ( option ) =>
			expect( option.derive_price_from_sale_period ).toBe( true )
		);
	} );
} );

describe( 'EventTickets — sale periods with no tickets on sale (#1840)', () => {
	const originalManageEventData = window.fairEventsManageEventData;

	afterEach( () => {
		window.fairEventsManageEventData = originalManageEventData;
	} );

	const twoPeriods = [
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
	];
	const bothPrices = [
		{ ticket_type_id: 1, sale_period_id: 601, price: '20' },
		{ ticket_type_id: 1, sale_period_id: 602, price: '5' },
	];
	const gapData = ( overrides = {} ) => ( {
		...initialDataWithTicketType,
		sale_periods: twoPeriods,
		prices: [ bothPrices[ 0 ] ],
		settings: { show_ticket_type_end_date: true },
		...overrides,
	} );
	const withTicketType = ( fields, prices = bothPrices ) =>
		gapData( {
			ticket_types: [
				{ ...initialDataWithTicketType.ticket_types[ 0 ], ...fields },
			],
			prices,
		} );

	const renderGaps = async ( initialData, extraProps = {} ) => {
		const result = await renderTickets( {
			initialData,
			startDate: '2026-01-31',
			endDate: '2026-01-31',
			...extraProps,
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);
		return result;
	};

	const warning = ( periodName ) =>
		screen.queryByText(
			new RegExp( `^${ periodName }: no tickets on sale ` )
		);
	// The legend entry is present exactly while something is flagged. (The
	// warning text itself also lingers in the a11y speak region.)
	const legendEntry = () => screen.queryByText( 'No tickets on sale' );
	// The struck-through day number is the calendar's non-colour marking.
	const isMarked = ( day ) =>
		within( screen.getByText( 'January 2026' ).parentElement ).getByText(
			String( day ),
			{ exact: true }
		).style.textDecoration === 'line-through';
	const priceInputIn = ( checkbox ) =>
		checkbox.closest( 'td' ).querySelector( 'input[type="number"]' );

	it( 'names a period without a price and marks its dates', async () => {
		await renderGaps( gapData() );

		expect( warning( 'Day of event' ) ).toHaveTextContent(
			/from .*15.* to .*31.*\.$/
		);
		expect( warning( 'Advance ticket' ) ).not.toBeInTheDocument();
		expect( legendEntry() ).toBeInTheDocument();
		expect( isMarked( 14 ) ).toBe( false );
		expect( isMarked( 15 ) ).toBe( true );
		expect( isMarked( 31 ) ).toBe( true );
	} );

	it( 'shows no warning when every period has a ticket, including a free one', async () => {
		await renderGaps(
			gapData( {
				prices: [
					bothPrices[ 0 ],
					{ ticket_type_id: 1, sale_period_id: 602, price: '0' },
				],
			} )
		);

		expect( legendEntry() ).not.toBeInTheDocument();
		expect( isMarked( 20 ) ).toBe( false );
	} );

	it( 'removes the warning and the marking as soon as a price is added, without saving', async () => {
		const onDirtyChange = jest.fn();
		await renderGaps( gapData(), { onDirtyChange } );

		const available = screen.getAllByRole( 'checkbox', {
			name: 'Available',
		} )[ 1 ];
		fireEvent.click( available );
		// Ticked but still wholly empty: nothing would be saved for it.
		expect( warning( 'Day of event' ) ).toBeInTheDocument();

		fireEvent.change( priceInputIn( available ), {
			target: { value: '0' },
		} );

		expect( warning( 'Day of event' ) ).not.toBeInTheDocument();
		expect( legendEntry() ).not.toBeInTheDocument();
		expect( isMarked( 20 ) ).toBe( false );
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( { method: 'PUT' } )
		);
	} );

	it( 'warns again when a priced cell is marked unavailable', async () => {
		await renderGaps( gapData( { prices: bothPrices } ) );
		expect( warning( 'Day of event' ) ).not.toBeInTheDocument();

		fireEvent.click(
			screen.getAllByRole( 'checkbox', { name: 'Available' } )[ 1 ]
		);

		expect( warning( 'Day of event' ) ).toBeInTheDocument();
	} );

	it( 'flags every period of a manually disabled ticket until it is enabled again', async () => {
		await renderGaps(
			withTicketType( { has_sales: true, disabled: true } )
		);

		expect( warning( 'Advance ticket' ) ).toBeInTheDocument();
		expect( warning( 'Day of event' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Disabled' } ) );

		expect( legendEntry() ).not.toBeInTheDocument();
	} );

	it( 'marks only the dates after a scheduled cutoff, and the cutoff date itself at midnight', async () => {
		const { container } = await renderGaps(
			withTicketType( { disable_at: '2026-01-20 15:00:00' } )
		);

		expect( warning( 'Advance ticket' ) ).not.toBeInTheDocument();
		expect( warning( 'Day of event' ) ).toHaveTextContent(
			/from .*21.* to .*31.*\.$/
		);
		expect( isMarked( 20 ) ).toBe( false );
		expect( isMarked( 21 ) ).toBe( true );

		fireEvent.change(
			container.querySelector( 'input[type="datetime-local"]' ),
			{ target: { value: '2026-01-20T00:00' } }
		);

		expect( isMarked( 19 ) ).toBe( false );
		expect( isMarked( 20 ) ).toBe( true );
	} );

	it( 'counts a ticket type that has not been saved yet', async () => {
		await renderGaps( gapData() );

		fireEvent.click(
			screen.getByRole( 'button', { name: '+ Add Ticket Type' } )
		);
		expect( warning( 'Day of event' ) ).toBeInTheDocument();

		// Second row, second period.
		const available = screen.getAllByRole( 'checkbox', {
			name: 'Available',
		} )[ 3 ];
		fireEvent.change( priceInputIn( available ), {
			target: { value: '8' },
		} );

		expect( warning( 'Day of event' ) ).not.toBeInTheDocument();
	} );

	it( 'follows periods that have not been saved yet, and their removal', async () => {
		window.fairEventsManageEventData = { siteToday: '2026-01-05' };
		await renderGaps(
			gapData( {
				sale_periods: [
					{ id: 501, name: '', sale_start: '', sale_end: '' },
				],
				prices: [
					{ ticket_type_id: 1, sale_period_id: 501, price: '12' },
				],
			} )
		);
		// One period: no calendar, so no warning either.
		expect( legendEntry() ).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);

		// The price moved to "Advance ticket"; the new "Day of event" period
		// (the event day, with an automatic end) has none.
		expect( warning( 'Advance ticket' ) ).not.toBeInTheDocument();
		expect( warning( 'Day of event' ) ).toHaveTextContent(
			/on sale on .*31.*\.$/
		);

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Remove' } )[ 1 ]
		);

		expect( legendEntry() ).not.toBeInTheDocument();
	} );

	it( 'shows no warning while a boundary is unresolved', async () => {
		// No schedule to anchor the automatic end: the calendar stays hidden.
		await renderTickets( {
			initialData: gapData( {
				sale_periods: [
					twoPeriods[ 0 ],
					{ ...twoPeriods[ 1 ], sale_end: '' },
				],
			} ),
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: /Sale Periods/i } )
		);

		expect( legendEntry() ).not.toBeInTheDocument();
	} );
} );
