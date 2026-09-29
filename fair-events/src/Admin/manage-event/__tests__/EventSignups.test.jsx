/**
 * @jest-environment jsdom
 *
 * Component tests for the List tab (#1568 replaces the fixed-column CSV
 * download with the "Export" popup — see SignupExportModal.test.jsx for its
 * own coverage; #1683 narrows the table to confirmed registrations, hides
 * email and amount, and adds numbering and extra columns; #1708 lists one
 * row per ticket).
 *
 * Exercises:
 *   - Only confirmed registrations (paid or free) are listed and exported,
 *     one row per ticket.
 *   - Email and amount stay out of the table and the delete dialog, but are
 *     still exported.
 *   - Ticket rows are numbered from 1 after filtering.
 *   - Each configured extra gets a column with a selected / not selected /
 *     unavailable indicator per ticket; no extras means no extra columns.
 *   - Mailing opt-ins filter, empty states, and delete.
 *   - Move and Change ticket type, including the over-capacity reason step,
 *     and the over-capacity details (#1532).
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventSignups, { expandTicketRows } from '../EventSignups.js';

jest.mock( '@wordpress/api-fetch' );

/**
 * Ticket unit of a registration, as the get-tickets response lists it.
 *
 * @param {number} id        Ticket ID.
 * @param {number} position  Position within its purchase.
 * @param {Object} overrides Fields to override.
 * @return {Object} Ticket
 */
function ticket( id, position, overrides = {} ) {
	return {
		id,
		position,
		reference: `REF${ String( id ).padStart( 5, '0' ) }`,
		ticket_type_id: 3,
		ticket_type_name: 'General',
		status: 'confirmed',
		attended_at: null,
		activity_ids: [],
		confirmed_activity_ids: [],
		...overrides,
	};
}

const signups = [
	{
		id: 1,
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		ticket_type_id: 3,
		ticket_type_name: 'General',
		quantity: 1,
		amount: '20.00',
		status: 'confirmed',
		transaction_id: 501,
		participant_id: 11,
		mailing_opt_in: true,
		created_at: '2026-07-20 10:00:00',
		tickets: [ ticket( 101, 1 ) ],
	},
	{
		id: 2,
		name: 'Bob, Jr.',
		email: 'bob@example.com',
		ticket_type_id: 3,
		ticket_type_name: 'General',
		quantity: 2,
		amount: '40.00',
		status: 'confirmed',
		transaction_id: 502,
		participant_id: 12,
		mailing_opt_in: false,
		created_at: '2026-07-21 10:00:00',
		tickets: [ ticket( 201, 1 ), ticket( 202, 2 ) ],
	},
];

const signupWithMissingTicketType = {
	id: 3,
	name: 'Carol Danvers',
	email: 'carol@example.com',
	ticket_type_id: 99,
	ticket_type_name: null,
	quantity: 1,
	amount: '0.00',
	status: 'confirmed',
	transaction_id: null,
	participant_id: 13,
	mailing_opt_in: false,
	created_at: '2026-07-22 10:00:00',
	tickets: [
		ticket( 301, 1, { ticket_type_id: 99, ticket_type_name: null } ),
	],
};

const unsuccessfulSignups = [
	'pending_payment',
	'expired',
	'cancelled',
	'failed',
].map( ( status, index ) => ( {
	...signups[ 0 ],
	id: 20 + index,
	name: `Unsuccessful ${ status }`,
	email: `${ status }@example.com`,
	status,
} ) );

const options = [
	{ id: 7, name: 'Dinner buffet', short_name: 'Dinner' },
	{ id: 8, name: 'Afterparty', short_name: '' },
];

/**
 * Route apiFetch by path, the way the List tab calls it.
 *
 * @param {Object} config
 * @param {Array}  config.rows         get-tickets response.
 * @param {Array}  config.ticketOptions Options in the tickets response.
 * @param {*}      config.participants Audience roster, or an Error to reject.
 * @param {*}      config.deleteResult DELETE response, or an Error to reject.
 * @param {Object} config.targets      Targets endpoint response.
 * @param {Array}  config.putResults   PUT responses in call order; Errors reject.
 */
function mockApi( {
	rows = signups,
	ticketOptions = [],
	participants = [],
	deleteResult = { deleted: true },
	targets = { event_dates: [], ticket_types: [] },
	putResults = [],
} = {} ) {
	const puts = [ ...putResults ];
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( method === 'DELETE' ) {
			return deleteResult instanceof Error
				? Promise.reject( deleteResult )
				: Promise.resolve( deleteResult );
		}
		if ( method === 'PUT' ) {
			const result = puts.shift() ?? { signup: {} };
			return result instanceof Error
				? Promise.reject( result )
				: Promise.resolve( result );
		}
		if ( path.endsWith( '/targets' ) ) {
			return Promise.resolve( targets );
		}
		if ( path.includes( 'include_answers=true' ) ) {
			return Promise.resolve(
				rows.map( ( row ) => ( { ...row, answers: [] } ) )
			);
		}
		if ( path.startsWith( '/fair-events/v1/get-tickets' ) ) {
			return Promise.resolve( rows );
		}
		if ( path.endsWith( '/tickets' ) ) {
			return Promise.resolve( { options: ticketOptions } );
		}
		if ( path.startsWith( '/fair-audience/' ) ) {
			return participants instanceof Error
				? Promise.reject( participants )
				: Promise.resolve( participants );
		}
		return Promise.reject( new Error( `Unexpected path ${ path }` ) );
	} );
}

async function renderSignups( config = {} ) {
	mockApi( config );
	const rows = config.rows ?? signups;
	render( <EventSignups eventDateId={ 42 } /> );
	const firstConfirmed = rows.find( ( row ) => row.status === 'confirmed' );
	if ( firstConfirmed ) {
		await screen.findAllByText( firstConfirmed.name );
	} else {
		await screen.findByText( 'No confirmed registrations yet.' );
	}
}

function bodyRows() {
	return screen.getAllByRole( 'row' ).slice( 1 );
}

function columnHeaders() {
	return screen
		.getAllByRole( 'columnheader' )
		.map( ( header ) => header.textContent );
}

afterEach( () => {
	jest.clearAllMocks();
	delete window.fairPaymentsConnector;
	delete window.fairEventsManageEventData;
} );

describe( 'EventSignups — list and Export button (#1568)', () => {
	it( 'renders the List section heading', async () => {
		await renderSignups();
		expect(
			screen.getByRole( 'heading', { name: 'List' } )
		).toBeInTheDocument();
	} );

	it( 'opens the export popup', async () => {
		await renderSignups();

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );

		expect(
			await screen.findByRole( 'dialog', { name: 'Export' } )
		).toBeInTheDocument();
	} );

	it( 'displays the over-capacity warning for confirmed signups', async () => {
		await renderSignups( {
			rows: [ signups[ 0 ], { ...signups[ 1 ], over_capacity: 1 } ],
		} );
		expect( screen.getByText( 'Confirmed' ) ).toBeInTheDocument();
		// Over capacity is a registration-wide flag: shown on both tickets.
		expect(
			screen.getAllByText( 'Confirmed — over capacity' )
		).toHaveLength( 2 );
	} );

	it.each( [ false, 0, '0' ] )(
		'displays Confirmed for a cleared over-capacity flag (%p)',
		async ( overCapacity ) => {
			await renderSignups( {
				rows: [ { ...signups[ 0 ], over_capacity: overCapacity } ],
			} );

			expect( screen.getByText( 'Confirmed' ) ).toBeInTheDocument();
			expect(
				screen.queryByText( 'Confirmed — over capacity' )
			).not.toBeInTheDocument();
		}
	);

	it.each( [ true, 1, '1' ] )(
		'displays the warning for an enabled over-capacity flag (%p)',
		async ( overCapacity ) => {
			await renderSignups( {
				rows: [ { ...signups[ 0 ], over_capacity: overCapacity } ],
			} );

			expect(
				screen.getByText( 'Confirmed — over capacity' )
			).toBeInTheDocument();
		}
	);

	it( 'links transaction references only when the connector is active', async () => {
		window.fairPaymentsConnector = { connectorActive: true };
		await renderSignups( { rows: [ signups[ 0 ] ] } );
		expect( screen.getByRole( 'link', { name: '501' } ) ).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=501'
		);
	} );

	it( 'narrows the table to mailing opt-ins when the filter is on', async () => {
		await renderSignups();

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Bob, Jr.' ) ).not.toBeInTheDocument();
	} );

	it( 'disables the button and explains why when there are no signups at all', async () => {
		await renderSignups( { rows: [] } );

		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
		expect(
			screen.getByText( 'No confirmed registrations yet.' )
		).toBeInTheDocument();
	} );

	it( 'shows the ticket type name, not its id, in the table', async () => {
		await renderSignups();
		expect(
			bodyRows().map(
				( row ) => within( row ).getAllByRole( 'cell' )[ 3 ].textContent
			)
		).toEqual( [ 'General', 'General', 'General' ] );
	} );

	it( 'falls back to an em dash when the ticket type is missing or deleted', async () => {
		await renderSignups( { rows: [ signupWithMissingTicketType ] } );
		expect( screen.getAllByText( '—' ) ).not.toHaveLength( 0 );
	} );

	it( 'disables the button when the mailing filter matches nothing', async () => {
		await renderSignups( { rows: [ signups[ 1 ] ] } );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
		expect(
			screen.getByText(
				'Nothing to export — no registrations match the current filter.'
			)
		).toBeInTheDocument();
	} );
} );

describe( 'EventSignups — confirmed registrations only (#1683)', () => {
	it( 'lists paid and free confirmed registrations and hides unsuccessful ones', async () => {
		await renderSignups( {
			rows: [
				signups[ 0 ],
				...unsuccessfulSignups,
				signupWithMissingTicketType,
			],
		} );

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Carol Danvers' ) ).toBeInTheDocument();
		unsuccessfulSignups.forEach( ( row ) =>
			expect( screen.queryByText( row.name ) ).not.toBeInTheDocument()
		);
		expect( bodyRows() ).toHaveLength( 2 );
	} );

	it( 'shows the empty state when every signup is unsuccessful', async () => {
		await renderSignups( { rows: unsuccessfulSignups } );

		expect(
			screen.getByText( 'No confirmed registrations yet.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
	} );

	it( 'numbers visible rows consecutively from 1, after filtering', async () => {
		const rows = [
			{ ...signups[ 0 ], id: 31, name: 'First in', mailing_opt_in: 1 },
			{ ...unsuccessfulSignups[ 0 ], id: 32 },
			{ ...signups[ 1 ], id: 33, name: 'Opted out' },
			{ ...signups[ 0 ], id: 34, name: 'Second in', mailing_opt_in: 1 },
		];
		await renderSignups( { rows } );

		expect( columnHeaders()[ 0 ] ).toBe( '#' );
		// "Opted out" holds two tickets, so four ticket rows are numbered.
		expect(
			bodyRows().map( ( row ) => [
				within( row ).getAllByRole( 'cell' )[ 0 ].textContent,
				within( row ).getAllByRole( 'cell' )[ 1 ].textContent,
			] )
		).toEqual( [
			[ '1', 'First in' ],
			[ '2', 'Opted out' ],
			[ '3', 'Opted out' ],
			[ '4', 'Second in' ],
		] );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect(
			bodyRows().map( ( row ) => [
				within( row ).getAllByRole( 'cell' )[ 0 ].textContent,
				within( row ).getAllByRole( 'cell' )[ 1 ].textContent,
			] )
		).toEqual( [
			[ '1', 'First in' ],
			[ '2', 'Second in' ],
		] );
	} );

	it( 'hides email addresses and amounts from the table', async () => {
		await renderSignups();

		expect( columnHeaders() ).not.toContain( 'Email' );
		expect( columnHeaders() ).not.toContain( 'Amount' );
		expect(
			screen.queryByText( 'ada@example.com' )
		).not.toBeInTheDocument();
		expect( screen.queryByText( '20.00' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( '40.00' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps email and amount in the export of the displayed registrations', async () => {
		const writeText = jest.fn().mockResolvedValue();
		Object.assign( navigator, { clipboard: { writeText } } );
		await renderSignups( {
			rows: [ signups[ 0 ], ...unsuccessfulSignups ],
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );
		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const lines = writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' );
		expect( lines[ 0 ] ).toContain( 'Email' );
		expect( lines[ 0 ] ).toContain(
			'Purchase total (once per registration)'
		);
		expect( lines[ 1 ] ).toContain( 'ada@example.com' );
		expect( lines[ 1 ] ).toContain( '20.00' );
		expect( lines.filter( Boolean ) ).toHaveLength( 2 );
		delete navigator.clipboard;
	} );
} );

describe( 'EventSignups — extras (#1683)', () => {
	beforeEach( () => {
		window.fairEventsManageEventData = {
			audienceUrl: 'admin.php?page=fair-audience-event-participants',
		};
	} );

	it( 'shows no extra columns when none are configured', async () => {
		await renderSignups( { ticketOptions: [] } );

		expect( columnHeaders() ).toEqual( [
			'#',
			'Name',
			'Ticket',
			'Ticket Type',
			'Status',
			'Transaction',
			'Mailing',
			'Date',
			'Actions',
		] );
		expect(
			screen.queryByRole( 'img', { name: /selected|unavailable/i } )
		).not.toBeInTheDocument();
	} );

	it( 'adds one column per extra, using short names and Audience order', async () => {
		await renderSignups( { ticketOptions: options } );

		await waitFor( () =>
			expect( columnHeaders() ).toEqual( [
				'#',
				'Name',
				'Ticket',
				'Ticket Type',
				'Dinner',
				'Afterparty',
				'Status',
				'Transaction',
				'Mailing',
				'Date',
				'Actions',
			] )
		);
	} );

	it( 'checks only extras each ticket holds as confirmed, per ticket', async () => {
		await renderSignups( {
			ticketOptions: options,
			rows: [
				{
					...signups[ 0 ],
					tickets: [
						ticket( 101, 1, {
							// 8 is still held for an unpaid add-on.
							activity_ids: [ 7, 8 ],
							confirmed_activity_ids: [ 7 ],
						} ),
					],
				},
				{
					...signups[ 1 ],
					tickets: [
						ticket( 201, 1, { confirmed_activity_ids: [ 8 ] } ),
						ticket( 202, 2 ),
					],
				},
			],
		} );

		const indicators = ( row ) =>
			within( row )
				.getAllByRole( 'img' )
				.map( ( img ) => img.getAttribute( 'aria-label' ) );
		const [ ada, bobFirst, bobSecond ] = bodyRows();
		expect( indicators( ada ) ).toEqual( [ 'Selected', 'Not selected' ] );
		expect( indicators( bobFirst ) ).toEqual( [
			'Not selected',
			'Selected',
		] );
		expect( indicators( bobSecond ) ).toEqual( [
			'Not selected',
			'Not selected',
		] );
	} );

	it( 'shows a check for selected extras and leaves unselected cells empty', async () => {
		await renderSignups( {
			ticketOptions: options,
			rows: [
				{
					...signups[ 0 ],
					tickets: [
						ticket( 101, 1, { confirmed_activity_ids: [ 7 ] } ),
					],
				},
			],
		} );

		const selected = await screen.findByRole( 'img', {
			name: 'Selected',
		} );
		expect( selected ).toHaveTextContent( '✓' );
		expect( selected ).toHaveAttribute( 'title', 'Selected' );

		const notSelected = within( bodyRows()[ 0 ] ).getByRole( 'img', {
			name: 'Not selected',
		} );
		expect( notSelected ).toBeEmptyDOMElement();
		expect( notSelected ).toHaveAttribute( 'title', 'Not selected' );
		expect( notSelected.closest( 'td' ) ).toHaveTextContent( /^$/ );

		expect( document.body ).not.toHaveTextContent( /[☑☐]/ );
	} );

	it( 'shows ticket extras without Fair Audience and never asks it', async () => {
		delete window.fairEventsManageEventData;
		await renderSignups( {
			ticketOptions: options,
			rows: [
				{
					...signups[ 0 ],
					tickets: [
						ticket( 101, 1, { confirmed_activity_ids: [ 8 ] } ),
					],
				},
			],
		} );

		await waitFor( () => expect( columnHeaders() ).toContain( 'Dinner' ) );
		expect(
			within( bodyRows()[ 0 ] ).getByRole( 'img', { name: 'Selected' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'img', { name: 'Selection unavailable' } )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( '/fair-audience/' ),
			} )
		);
	} );
} );

describe( 'EventSignups — registrations without tickets yet (#1708)', () => {
	it( 'keeps one flagged row, without a made-up reference, and explains why', async () => {
		await renderSignups( {
			ticketOptions: options,
			rows: [ signups[ 0 ], { ...signups[ 1 ], tickets: [] } ],
		} );

		const rows = bodyRows();
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 1 ] ).toHaveTextContent( 'Bob, Jr.' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Ticket not created yet' );
		expect( rows[ 1 ] ).toHaveTextContent( 'General' );
		expect(
			within( rows[ 1 ] ).getAllByRole( 'img', {
				name: 'Selection unavailable',
			} )
		).toHaveLength( 2 );
		expect(
			document.querySelector( '.components-notice__content' )
		).toHaveTextContent(
			'Some older registrations are still being split into individual tickets.'
		);
	} );
} );

describe( 'expandTicketRows', () => {
	it( 'expands each registration into its tickets, in order', () => {
		const rows = expandTicketRows( [
			signups[ 1 ],
			{ ...signups[ 0 ], tickets: undefined },
		] );

		expect(
			rows.map( ( row ) => [
				row.signup.id,
				row.ticket?.id ?? null,
				row.isFirstTicket,
			] )
		).toEqual( [
			[ 2, 201, true ],
			[ 2, 202, false ],
			[ 1, null, true ],
		] );
	} );
} );

describe( 'EventSignups — mailing consent normalization (#1492)', () => {
	const consentCases = [
		{ value: false, label: 'boolean false', optedIn: false },
		{ value: 0, label: 'numeric zero', optedIn: false },
		{ value: '0', label: 'database zero', optedIn: false },
		{ value: true, label: 'boolean true', optedIn: true },
		{ value: 1, label: 'numeric one', optedIn: true },
		{ value: '1', label: 'database one', optedIn: true },
	];

	it.each( consentCases )(
		'displays $label explicitly',
		async ( { value, optedIn } ) => {
			await renderSignups( {
				rows: [ { ...signups[ 0 ], mailing_opt_in: value } ],
			} );
			expect(
				screen.getByText( optedIn ? 'Yes' : 'No' )
			).toBeInTheDocument();
		}
	);

	it( 'filters explicit opt-ins among confirmed registrations', async () => {
		const rows = consentCases.map( ( consent, index ) => ( {
			...signups[ index % signups.length ],
			id: index + 10,
			name: `${ consent.optedIn ? 'Opted in' : 'Opted out' } ${ index }`,
			email: `consent-${ index }@example.com`,
			mailing_opt_in: consent.value,
		} ) );
		await renderSignups( { rows } );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		consentCases.forEach( ( consent, index ) => {
			const name = `${
				consent.optedIn ? 'Opted in' : 'Opted out'
			} ${ index }`;
			if ( consent.optedIn ) {
				expect( screen.getAllByText( name ).length ).toBeGreaterThan(
					0
				);
			} else {
				expect( screen.queryByText( name ) ).not.toBeInTheDocument();
			}
		} );
	} );
} );

describe( 'EventSignups — delete signup (#1464)', () => {
	it( 'opens the confirmation dialog for the selected row without its email', async () => {
		await renderSignups();

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 1 ]
		);

		const dialog = screen.getByRole( 'dialog' );
		expect( dialog ).toHaveTextContent( 'Bob, Jr.' );
		expect( dialog ).not.toHaveTextContent( 'bob@example.com' );
		expect( dialog ).not.toHaveTextContent( '40.00' );
		expect( dialog ).toHaveTextContent( 'confirmed' );
		expect( dialog ).toHaveTextContent(
			'Delete the registration for Bob, Jr., with all 2 of its tickets?'
		);
		expect( dialog ).toHaveTextContent( 'This deletion is permanent.' );
		expect( dialog ).toHaveTextContent(
			'does not refund or cancel any payment-provider transaction'
		);
	} );

	it( 'cancels without deleting or changing the list', async () => {
		await renderSignups();
		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( { method: 'DELETE' } )
		);
	} );

	it( 'deletes the exact signup and renumbers the remaining rows', async () => {
		await renderSignups();

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete registration' } )
		);

		await waitFor( () =>
			expect(
				screen.queryByText( 'Ada Lovelace' )
			).not.toBeInTheDocument()
		);
		expect(
			bodyRows().map(
				( row ) => within( row ).getAllByRole( 'cell' )[ 0 ].textContent
			)
		).toEqual( [ '1', '2' ] );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/get-tickets/1',
			method: 'DELETE',
		} );
	} );

	it( 'preserves the row and shows a persistent error when deletion fails', async () => {
		await renderSignups( {
			deleteResult: new Error( 'Database refused deletion.' ),
		} );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete registration' } )
		);

		await waitFor( () =>
			expect(
				document.querySelector( '.components-notice__content' )
			).toHaveTextContent( 'Database refused deletion.' )
		);
		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			document.querySelector( '.components-notice' )
		).not.toHaveClass( 'is-dismissible' );
	} );
} );

describe( 'EventSignups — move and change ticket type (#1532)', () => {
	const movable = {
		...signups[ 0 ],
		can_move: true,
		recurrence_scope: 'single_instance',
	};
	const wholeSeries = {
		...signups[ 1 ],
		can_move: false,
		recurrence_scope: 'whole_series',
	};
	const noType = {
		...signupWithMissingTicketType,
		id: 4,
		name: 'Dora Free',
		ticket_type_id: null,
		can_move: true,
	};
	const targets = {
		event_dates: [
			{ id: 51, label: 'Tue 7 Oct', capacity: 20, remaining: 0 },
			{ id: 52, label: 'Tue 14 Oct', capacity: 20, remaining: 3 },
			{ id: 53, label: 'Tue 21 Oct', capacity: null, remaining: null },
		],
		ticket_types: [
			{ id: 61, label: 'Reduced', capacity: 5, remaining: 1 },
		],
	};

	function capacityError() {
		const error = new Error(
			'Tue 7 Oct would have 21 of 20 places taken.'
		);
		error.code = 'capacity_exceeded';
		error.data = {
			status: 409,
			projection: {
				scope: 'event_date',
				id: 51,
				label: 'Tue 7 Oct',
				taken: 20,
				capacity: 20,
				after: 21,
			},
		};
		return error;
	}

	function actionsOf( name ) {
		const row = bodyRows().find( ( r ) => within( r ).queryByText( name ) );
		return within( row )
			.getAllByRole( 'button' )
			.map( ( button ) => button.textContent );
	}

	it( 'offers Move only on series rows that are not whole-series passes, and a type change only with a ticket type', async () => {
		await renderSignups( { rows: [ movable, wholeSeries, noType ] } );

		expect( actionsOf( 'Ada Lovelace' ) ).toEqual( [
			'Move',
			'Change ticket type',
			'Delete',
		] );
		expect( actionsOf( 'Bob, Jr.' ) ).toEqual( [
			'Change ticket type',
			'Delete',
		] );
		expect( actionsOf( 'Dora Free' ) ).toEqual( [ 'Move', 'Delete' ] );
	} );

	it( 'labels each target with the places it has left', async () => {
		await renderSignups( { rows: [ movable ], targets } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Move' } ) );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Move Ada Lovelace to another date',
		} );
		const select = await within( dialog ).findByLabelText( 'New date' );

		expect(
			within( select )
				.getAllByRole( 'option' )
				.map( ( option ) => option.textContent )
		).toEqual( [
			'Choose…',
			'Tue 7 Oct — Full',
			'Tue 14 Oct — 3 places left',
			'Tue 21 Oct',
		] );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Move signup' } )
		).toBeDisabled();
		expect( within( dialog ).getByText( 'Choose a date.' ) ).toBeVisible();
	} );

	it( 'moves the signup and reloads the list', async () => {
		await renderSignups( { rows: [ movable ], targets } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Move' } ) );
		const dialog = await screen.findByRole( 'dialog' );
		fireEvent.change(
			await within( dialog ).findByLabelText( 'New date' ),
			{
				target: { value: '52' },
			}
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Move signup' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets/1',
			method: 'PUT',
			data: { event_date_id: 52 },
		} );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/get-tickets?event_date=42',
		} );
	} );

	it( 'asks for a reason when the target is full and sends it with the override', async () => {
		await renderSignups( {
			rows: [ movable ],
			targets,
			putResults: [ capacityError(), { signup: {} } ],
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Move' } ) );
		const dialog = await screen.findByRole( 'dialog' );
		fireEvent.change(
			await within( dialog ).findByLabelText( 'New date' ),
			{
				target: { value: '51' },
			}
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Move signup' } )
		);

		expect(
			await within( dialog ).findByText(
				'Tue 7 Oct would have 21 of 20 places taken.'
			)
		).toBeInTheDocument();
		const exceed = within( dialog ).getByRole( 'button', {
			name: 'Exceed capacity',
		} );
		expect( exceed ).toBeDisabled();
		expect( exceed ).toHaveClass( 'is-destructive' );
		expect(
			within( dialog ).getByText( 'Enter a reason to go over capacity.' )
		).toBeVisible();

		fireEvent.change( within( dialog ).getByLabelText( 'Reason' ), {
			target: { value: '   ' },
		} );
		expect( exceed ).toBeDisabled();

		fireEvent.change( within( dialog ).getByLabelText( 'Reason' ), {
			target: { value: 'Friend of the organizer' },
		} );
		expect( exceed ).toBeEnabled();
		fireEvent.click( exceed );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets/1',
			method: 'PUT',
			data: {
				event_date_id: 51,
				override_reason: 'Friend of the organizer',
			},
		} );
	} );

	it( 'changes the ticket type and shows other errors in the modal', async () => {
		await renderSignups( {
			rows: [ movable ],
			targets,
			putResults: [
				new Error(
					'The chosen ticket type is not available for this signup.'
				),
			],
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Change ticket type' } )
		);
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Change ticket type for Ada Lovelace',
		} );
		fireEvent.change(
			await within( dialog ).findByLabelText( 'New ticket type' ),
			{ target: { value: '61' } }
		);
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Change ticket type',
			} )
		);

		expect(
			await within( dialog ).findByText(
				'The chosen ticket type is not available for this signup.'
			)
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets/1',
			method: 'PUT',
			data: { ticket_type_id: 61 },
		} );
	} );

	it( 'shows every override behind an over-capacity signup', async () => {
		await renderSignups( {
			rows: [
				{
					...movable,
					over_capacity: true,
					overrides: [
						{
							action: 'move',
							reason: 'Friend of the organizer',
							user_display_name: 'Admin',
							created_at: '2026-09-27 10:00:00',
						},
						{
							action: 'change_type',
							reason: 'Upgrade promised',
							user_display_name: 'Admin',
							created_at: '2026-09-27 11:00:00',
						},
					],
				},
			],
		} );

		const toggle = screen.getByRole( 'button', { name: 'Details' } );
		expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		fireEvent.click( toggle );

		expect(
			screen.getByText(
				'Moved by Admin on 2026-09-27 10:00:00: Friend of the organizer'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Ticket type changed by Admin on 2026-09-27 11:00:00: Upgrade promised'
			)
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Hide details' } )
		).toHaveAttribute( 'aria-expanded', 'true' );
	} );

	it( 'explains a late-payment flag that has no override', async () => {
		await renderSignups( {
			rows: [ { ...movable, over_capacity: 1, overrides: [] } ],
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Details' } ) );

		expect(
			screen.getByText( 'Paid after its hold expired' )
		).toBeInTheDocument();
	} );
} );

describe( 'EventSignups — edit individual tickets (#1709)', () => {
	const purchase = {
		...signups[ 1 ],
		tickets: [
			{
				id: 301,
				position: 1,
				reference: 'AAAA1111',
				ticket_type_id: 3,
				ticket_type_name: 'General',
				status: 'confirmed',
				attended_at: null,
				activity_ids: [ 7 ],
				confirmed_activity_ids: [ 7 ],
			},
			{
				id: 302,
				position: 2,
				reference: 'AE2671B5',
				ticket_type_id: 61,
				ticket_type_name: 'Reduced',
				status: 'confirmed',
				attended_at: null,
				activity_ids: [],
				confirmed_activity_ids: [],
			},
		],
	};

	function ticketRow( id ) {
		return document.querySelector( `tr[data-ticket-id="${ id }"]` );
	}

	it( 'lists each ticket of a purchase as its own row with its own type and activities', async () => {
		await renderSignups( {
			rows: [ purchase ],
			ticketOptions: options,
		} );

		expect( bodyRows() ).toHaveLength( 2 );
		expect( ticketRow( 301 ) ).toHaveTextContent( 'Ticket 1 (AAAA1111)' );
		expect( ticketRow( 301 ) ).toHaveTextContent( 'General' );
		expect(
			within( ticketRow( 301 ) ).getByRole( 'img', { name: 'Selected' } )
		).toBeInTheDocument();
		expect( ticketRow( 302 ) ).toHaveTextContent( 'Ticket 2 (AE2671B5)' );
		expect( ticketRow( 302 ) ).toHaveTextContent( 'Reduced' );
		expect(
			within( ticketRow( 302 ) ).queryByRole( 'img', {
				name: 'Selected',
			} )
		).not.toBeInTheDocument();
		// Both rows name the purchaser.
		expect( ticketRow( 302 ) ).toHaveTextContent( 'Bob, Jr.' );
	} );

	it( 'puts registration-wide actions on the first ticket row only, labelled as such', async () => {
		await renderSignups( { rows: [ { ...purchase, can_move: true } ] } );

		const first = ticketRow( 301 );
		expect( first ).toHaveTextContent( 'Registration (2 tickets):' );
		expect(
			within( first ).getByRole( 'button', { name: 'Move' } )
		).toBeInTheDocument();
		expect(
			within( first ).getByRole( 'button', { name: 'Delete' } )
		).toBeInTheDocument();
		expect(
			within( ticketRow( 302 ) ).queryAllByRole( 'button' )
		).toHaveLength( 0 );

		fireEvent.click(
			within( first ).getByRole( 'button', { name: 'Move' } )
		);
		expect(
			await screen.findByText(
				'This moves the whole registration, with all 2 of its tickets.'
			)
		).toBeInTheDocument();
	} );

	it( 'opens the shared ticket editor for the chosen ticket and reloads after saving', async () => {
		window.fairEventsManageEventData = { audienceUrl: '/audience' };
		mockApi( { rows: [ purchase ] } );
		const listImpl = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( args ) => {
			if (
				args.path === '/fair-audience/v1/event-dates/42/tickets/302'
			) {
				if ( args.method === 'PUT' ) {
					return Promise.resolve( { id: 302 } );
				}
				return Promise.resolve( {
					ticket: {
						...purchase.tickets[ 1 ],
						participant_name: 'Bob, Jr.',
						editable: true,
						over_capacity_activity_ids: [],
					},
					ticket_types: [
						{
							id: 61,
							label: 'Reduced',
							current: true,
							remaining: 1,
							activities_enabled: true,
							minimum_activities: 0,
							maximum_activities: null,
						},
					],
					activities: [],
				} );
			}
			return listImpl( args );
		} );
		render( <EventSignups eventDateId={ 42 } /> );
		await screen.findAllByText( 'Bob, Jr.' );

		fireEvent.click(
			within( ticketRow( 302 ) ).getByRole( 'button', {
				name: 'Edit Ticket 2 (AE2671B5)',
			} )
		);
		const modal = await screen.findByRole( 'dialog', {
			name: 'Edit ticket — Bob, Jr.',
		} );
		expect(
			await within( modal ).findByText( 'Ticket 2 (AE2671B5)' )
		).toBeInTheDocument();

		fireEvent.click(
			within( modal ).getByRole( 'checkbox', { name: 'Checked in' } )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/event-dates/42/tickets/302',
			method: 'PUT',
			data: { attended: true },
		} );
		const listLoads = apiFetch.mock.calls.filter(
			( [ args ] ) =>
				args.path === '/fair-events/v1/get-tickets?event_date=42'
		);
		expect( listLoads ).toHaveLength( 2 );
	} );

	it( 'keeps the registration-wide type change and ticket rows, without the editor, without Fair Audience', async () => {
		delete window.fairEventsManageEventData;
		await renderSignups( { rows: [ purchase ] } );

		expect(
			within( ticketRow( 301 ) ).getByRole( 'button', {
				name: 'Change ticket type',
			} )
		).toBeInTheDocument();
		expect( ticketRow( 302 ) ).toHaveTextContent( 'Ticket 2 (AE2671B5)' );
		expect(
			screen.queryByRole( 'button', { name: /^Edit Ticket/ } )
		).not.toBeInTheDocument();
	} );
} );
