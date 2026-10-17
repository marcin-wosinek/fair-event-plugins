/**
 * @jest-environment jsdom
 *
 * Component tests for the ticket-import and merge-periods confirmations in
 * EventTickets (#1772): target identity, consequences, cancellation, single
 * submission, pending controls, contextual errors, retry and the explicit
 * save a merge still needs.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventTickets from '../EventTickets.js';

jest.mock( '@wordpress/api-fetch' );

const IMPORT_PATH = '/fair-events/v1/event-dates/99/tickets/import';

const ticketType = {
	id: 1,
	name: 'General',
	capacity: null,
	minimum_activities: 0,
	disable_at: null,
	recurrence_scope: 'single_instance',
	sort_order: 0,
};

const emptyData = {
	capacity: null,
	ticket_types: [],
	sale_periods: [],
	prices: [],
	settings: {},
	options: [],
};

const twoPeriods = {
	...emptyData,
	ticket_types: [ ticketType ],
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
	settings: { multiple_pricing_periods: true },
};

const importedData = {
	...emptyData,
	ticket_types: [ { ...ticketType, id: 7, name: 'Imported pass' } ],
};

let confirmSpy;

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	confirmSpy = jest.spyOn( window, 'confirm' );
	apiFetch.mockImplementation( () => new Promise( () => {} ) );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

const renderTickets = async ( { initialData = emptyData, ...props } = {} ) => {
	apiFetch.mockImplementationOnce( () => Promise.resolve( initialData ) );
	let view;
	await act( async () => {
		view = render(
			<EventTickets
				eventDateId={ 99 }
				onSaveRef={ { current: null } }
				eventTitle="Summer Jam"
				eventDateLabel="July 1, 2026 6:00 pm"
				{ ...props }
			/>
		);
	} );
	return view;
};

const exportFile = ( content = { type: 'fair-events-tickets' } ) => {
	const text =
		typeof content === 'string' ? content : JSON.stringify( content );
	const file = new File( [ text ], 'summer-tickets.json', {
		type: 'application/json',
	} );
	file.text = () => Promise.resolve( text );
	return file;
};

const chooseFile = ( container, file = exportFile() ) => {
	fireEvent.change( container.querySelector( 'input[type="file"]' ), {
		target: { files: [ file ] },
	} );
	return screen.findByRole( 'dialog', { name: 'Import ticket settings?' } );
};

const importCalls = () =>
	apiFetch.mock.calls.filter( ( [ o ] ) => o.path === IMPORT_PATH );

const mockImport = ( handler ) =>
	apiFetch.mockImplementation( ( options ) =>
		options.path === IMPORT_PATH
			? handler( options )
			: new Promise( () => {} )
	);

const importButton = () =>
	screen.getByRole( 'button', { name: 'Import and replace' } );

describe( 'EventTickets — ticket import confirmation (#1772)', () => {
	it( 'names the event and the file, and explains what the import replaces', async () => {
		const { container } = await renderTickets();

		const dialog = await chooseFile( container );

		expect( confirmSpy ).not.toHaveBeenCalled();
		expect( dialog ).toHaveTextContent(
			'Import summer-tickets.json into Summer Jam on July 1, 2026 6:00 pm?'
		);
		expect( dialog ).toHaveTextContent(
			"The import is saved immediately. It replaces all of this event's ticket types, sale periods, prices, and add-ons, and applies the total capacity and ticket options set in the file."
		);
		expect( dialog ).toHaveTextContent( 'This cannot be undone.' );
		expect( dialog ).not.toHaveTextContent( 'unsaved ticket changes' );
		expect( importButton() ).toHaveClass( 'is-destructive' );
		expect( importCalls() ).toHaveLength( 0 );
	} );

	it( 'warns that unsaved ticket changes are replaced too', async () => {
		const { container } = await renderTickets( {
			initialData: { ...emptyData, ticket_types: [ ticketType ] },
		} );
		fireEvent.change( screen.getByDisplayValue( 'General' ), {
			target: { value: 'General (edited)' },
		} );

		const dialog = await chooseFile( container );

		expect( dialog ).toHaveTextContent(
			'Your unsaved ticket changes on this screen are replaced too.'
		);
	} );

	it( 'cancelling imports nothing and keeps unsaved edits', async () => {
		const onDirtyChange = jest.fn();
		const { container } = await renderTickets( {
			initialData: { ...emptyData, ticket_types: [ ticketType ] },
			onDirtyChange,
		} );
		fireEvent.change( screen.getByDisplayValue( 'General' ), {
			target: { value: 'General (edited)' },
		} );

		await chooseFile( container );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( importCalls() ).toHaveLength( 0 );
		expect(
			screen.getByDisplayValue( 'General (edited)' )
		).toBeInTheDocument();
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );

		// The same file can be chosen again straight away.
		expect( await chooseFile( container ) ).toBeInTheDocument();
	} );

	it( 'confirming imports once, shows progress and loads the result', async () => {
		let finishImport;
		mockImport(
			() =>
				new Promise( ( resolve ) => {
					finishImport = resolve;
				} )
		);
		const { container } = await renderTickets();

		await chooseFile( container );
		const confirm = importButton();
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		const busy = await screen.findByRole( 'button', {
			name: 'Importing…',
		} );
		expect( busy ).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( importCalls() ).toHaveLength( 1 );
		expect( importCalls()[ 0 ][ 0 ] ).toMatchObject( {
			method: 'POST',
			data: { type: 'fair-events-tickets' },
		} );

		await act( async () => finishImport( importedData ) );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect(
			screen.getByDisplayValue( 'Imported pass' )
		).toBeInTheDocument();
		expect(
			document.querySelector( '.components-notice.is-success' )
		).toHaveTextContent(
			'Ticket settings imported from summer-tickets.json.'
		);
		expect( importCalls() ).toHaveLength( 1 );
	} );

	it( 'a rejected import explains that nothing changed and can be retried with the same file', async () => {
		const handler = jest
			.fn()
			.mockRejectedValueOnce( {
				message: 'Sale periods overlap.',
				data: { status: 400 },
			} )
			.mockResolvedValueOnce( importedData );
		mockImport( handler );
		const { container } = await renderTickets();

		const dialog = await chooseFile( container );
		fireEvent.click( importButton() );

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Nothing was imported: Sale periods overlap. The saved ticket settings are unchanged.'
			)
		);
		expect( dialog ).toHaveTextContent( 'Import summer-tickets.json' );
		expect( importButton() ).not.toBeDisabled();

		fireEvent.click( importButton() );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( handler ).toHaveBeenCalledTimes( 2 );
		expect(
			screen.getByDisplayValue( 'Imported pass' )
		).toBeInTheDocument();
	} );

	it( 'withholds another attempt when an import broke off part-way', async () => {
		mockImport( () =>
			Promise.reject( { message: 'Server error', data: { status: 500 } } )
		);
		const { container } = await renderTickets();

		const dialog = await chooseFile( container );
		fireEvent.click( importButton() );

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'The import did not finish, and the saved ticket settings may be partly replaced. Reload the page to see what is saved before importing again.'
			)
		);
		expect( importButton() ).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Cancel' } )
		).not.toBeDisabled();
	} );

	it( 'rejects a file that is not a ticket export without sending it', async () => {
		const { container } = await renderTickets();

		const dialog = await chooseFile(
			container,
			exportFile( { type: 'something-else' } )
		);
		fireEvent.click( importButton() );

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Nothing was imported: summer-tickets.json is not a ticket settings export.'
			)
		);
		expect( importCalls() ).toHaveLength( 0 );
	} );
} );

describe( 'EventTickets — merge sale periods confirmation (#1772)', () => {
	const openMergeDialog = async ( props = {} ) => {
		const view = await renderTickets( {
			initialData: twoPeriods,
			...props,
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: /More options/i } )
		);
		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: /Multiple pricing periods/i,
			} )
		);
		return {
			...view,
			dialog: screen.getByRole( 'dialog', {
				name: 'Merge sale periods?',
			} ),
		};
	};

	it( 'names the event and says which prices are kept and that a save is still needed', async () => {
		const { dialog } = await openMergeDialog();

		expect( dialog ).toHaveTextContent(
			'Merge the 2 sale periods of Summer Jam into one sale window?'
		);
		expect( dialog ).toHaveTextContent(
			'Ticket prices from the first period, Advance ticket, are kept. Ticket prices from the 1 other period are discarded.'
		);
		expect( dialog ).toHaveTextContent(
			'The merged window starts when the first period starts and ends when the last period ends.'
		);
		expect( dialog ).toHaveTextContent(
			'Nothing is saved until you select Save tickets.'
		);
		expect( dialog ).not.toHaveTextContent( 'Add-on prices' );
		expect(
			screen.getByRole( 'button', { name: 'Merge periods' } )
		).toHaveClass( 'is-destructive' );
	} );

	it( 'mentions add-on prices only when add-ons are priced per sale period', async () => {
		const { dialog } = await openMergeDialog( {
			initialData: {
				...twoPeriods,
				settings: {
					multiple_pricing_periods: true,
					activity_period_pricing: true,
				},
				options: [
					{
						id: 5,
						name: 'Workshop',
						price: 10,
						derive_price_from_sale_period: true,
						period_prices: [
							{ sale_period_id: 601, price: 8 },
							{ sale_period_id: 602, price: 12 },
						],
					},
				],
			},
		} );

		expect( dialog ).toHaveTextContent(
			'Add-on prices set per sale period are not merged. Check the price of each add-on before saving.'
		);
	} );

	it( 'cancelling keeps every period and price and leaves the form clean', async () => {
		const onDirtyChange = jest.fn();
		await openMergeDialog( { onDirtyChange } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Advance ticket' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Day of event' ) ).toBeInTheDocument();
		expect( screen.getByDisplayValue( '5' ) ).toBeInTheDocument();
		expect( onDirtyChange ).toHaveBeenLastCalledWith( false );
	} );

	it( 'confirming merges locally, marks the form dirty and saves nothing', async () => {
		const onDirtyChange = jest.fn();
		await openMergeDialog( { onDirtyChange } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Merge periods' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Day of event' ) ).not.toBeInTheDocument();
		expect( screen.getByDisplayValue( '20' ) ).toBeInTheDocument();
		expect( onDirtyChange ).toHaveBeenLastCalledWith( true );
		expect(
			apiFetch.mock.calls.filter( ( [ o ] ) => o.method === 'PUT' )
		).toHaveLength( 0 );
	} );
} );
