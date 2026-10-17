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
 *   - "Print list" prints the complete, unfiltered List in its own window
 *     (#1842).
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
import { splitColumnSections } from '../signup-print.js';
import { scopeNotes } from '../SignupEditModal.js';

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

	it( 'leaves the transaction and the registration date out of the table', async () => {
		window.fairPaymentsConnector = { connectorActive: true };
		await renderSignups( { rows: [ signups[ 0 ] ] } );
		const row = bodyRows()[ 0 ];

		expect( columnHeaders() ).not.toContain( 'Transaction' );
		expect( columnHeaders() ).not.toContain( 'Date' );
		expect( within( row ).queryByRole( 'link' ) ).not.toBeInTheDocument();
		expect( row ).not.toHaveTextContent( '501' );
		expect( row ).not.toHaveTextContent( '2026-07-20 10:00:00' );
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
			'Mailing',
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
				'Mailing',
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

describe( 'EventSignups — confirmed tickets only (#1754)', () => {
	const mixedPurchase = {
		...signups[ 1 ],
		quantity: 3,
		tickets: [
			ticket( 201, 1, { status: 'cancelled' } ),
			ticket( 202, 2 ),
			ticket( 203, 3 ),
		],
	};

	it( 'lists only the confirmed tickets of a confirmed registration', () => {
		const rows = expandTicketRows( [
			{
				...signups[ 1 ],
				quantity: 5,
				tickets: [
					ticket( 201, 1, { status: 'pending_payment' } ),
					ticket( 202, 2, { status: 'failed' } ),
					ticket( 203, 3 ),
					ticket( 204, 4, { status: 'expired' } ),
					ticket( 205, 5, { status: 'refunded' } ),
				],
			},
		] );

		expect(
			rows.map( ( row ) => [
				row.ticket.id,
				row.isFirstTicket,
				row.ticketCount,
			] )
		).toEqual( [ [ 203, true, 1 ] ] );
	} );

	it( 'gives no row, and no fallback row, to a registration whose tickets all stopped admitting', () => {
		expect(
			expandTicketRows( [
				{
					...signups[ 0 ],
					tickets: [ ticket( 101, 1, { status: 'cancelled' } ) ],
				},
			] )
		).toEqual( [] );
	} );

	it( 'counts and labels a registration by its listed tickets', async () => {
		await renderSignups( { rows: [ signups[ 0 ], mixedPurchase ] } );

		const rows = bodyRows();
		expect( rows ).toHaveLength( 3 );
		expect( rows[ 1 ] ).toHaveTextContent( 'REF00202' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Entire purchase — 2 tickets' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Delete' );
		expect( rows[ 2 ] ).toHaveTextContent( 'REF00203' );
		expect( screen.queryByText( 'Cancelled' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the empty state when no confirmed registration has a ticket left', async () => {
		mockApi( {
			rows: [
				{
					...signups[ 0 ],
					tickets: [ ticket( 101, 1, { status: 'cancelled' } ) ],
				},
			],
		} );
		render( <EventSignups eventDateId={ 42 } /> );

		expect(
			await screen.findByText( 'No confirmed registrations yet.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
	} );

	it( 'exports the same tickets the List shows', async () => {
		const writeText = jest.fn().mockResolvedValue();
		Object.assign( navigator, { clipboard: { writeText } } );
		await renderSignups( { rows: [ signups[ 0 ], mixedPurchase ] } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );
		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const text = writeText.mock.calls[ 0 ][ 0 ];
		expect( text ).toContain( 'REF00202' );
		expect( text ).toContain( 'REF00203' );
		expect( text ).not.toContain( 'REF00201' );
		expect( text ).not.toContain( 'cancelled' );
		expect( text.split( '\r\n' ).filter( Boolean ) ).toHaveLength( 4 );
		delete navigator.clipboard;
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
		// The closing dialog keeps the table aria-hidden for a moment after
		// the row is gone, so role queries need to wait for it to clear.
		await waitFor( () =>
			expect(
				bodyRows().map(
					( row ) =>
						within( row ).getAllByRole( 'cell' )[ 0 ].textContent
				)
			).toEqual( [ '1', '2' ] )
		);
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
		expect( ticketRow( 301 ) ).toHaveTextContent( 'AAAA1111' );
		expect( ticketRow( 301 ) ).not.toHaveTextContent( 'Ticket 1 (' );
		expect( ticketRow( 301 ) ).toHaveTextContent( 'General' );
		expect(
			within( ticketRow( 301 ) ).getByRole( 'img', { name: 'Selected' } )
		).toBeInTheDocument();
		expect(
			ticketRow( 302 ).querySelectorAll( 'td' )[ 2 ]
		).toHaveTextContent( /^AE2671B5$/ );
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
		expect( first ).toHaveTextContent( 'Entire purchase — 2 tickets' );
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
		expect( ticketRow( 302 ) ).toHaveTextContent( 'AE2671B5' );
		expect(
			screen.queryByRole( 'button', { name: /^Edit Ticket/ } )
		).not.toBeInTheDocument();
	} );
} );

describe( 'EventSignups — tickets listed under their own date (#1791)', () => {
	// The List of date 42. Paula bought tickets 901 and 902 for date 42 and
	// 902 was moved to date 43; Quinn bought 911 and 912 for date 43 and 912
	// was moved here.
	const stayed = {
		...signups[ 1 ],
		id: 9,
		name: 'Paula Purchaser',
		event_date_id: 42,
		event_date_label: '10 June',
		can_move: true,
		tickets: [
			ticket( 901, 1, { event_date_id: 42 } ),
			ticket( 902, 2, { event_date_id: 43 } ),
		],
		listed_ticket_ids: [ 901 ],
		accounting_anchor_ticket_id: 901,
		ticket_counts: {
			confirmed: 2,
			on_this_date: 1,
			on_other_dates: 1,
			on_registration_date: 1,
			inactive: 0,
		},
	};
	const movedIn = {
		...signups[ 1 ],
		id: 10,
		name: 'Quinn Guest',
		event_date_id: 43,
		event_date_label: '17 June',
		can_move: true,
		mailing_opt_in: true,
		tickets: [
			ticket( 911, 1, { event_date_id: 43 } ),
			ticket( 912, 2, {
				event_date_id: 42,
				ticket_type_name: 'Reduced',
				confirmed_activity_ids: [ 7 ],
				attended_at: '2026-06-10 19:05:00',
			} ),
		],
		listed_ticket_ids: [ 912 ],
		accounting_anchor_ticket_id: 911,
		ticket_counts: {
			confirmed: 2,
			on_this_date: 1,
			on_other_dates: 1,
			on_registration_date: 1,
			inactive: 0,
		},
	};
	const allMovedAway = {
		...stayed,
		id: 11,
		name: 'Rae Away',
		tickets: [
			ticket( 921, 1, { event_date_id: 43 } ),
			ticket( 922, 2, { event_date_id: 43 } ),
		],
		listed_ticket_ids: [],
		accounting_anchor_ticket_id: 921,
		ticket_counts: {
			confirmed: 2,
			on_this_date: 0,
			on_other_dates: 2,
			on_registration_date: 0,
			inactive: 0,
		},
	};

	function ticketRow( id ) {
		return document.querySelector( `tr[data-ticket-id="${ id }"]` );
	}

	it( 'lists only the tickets on this date, wherever their purchase is registered', async () => {
		await renderSignups( {
			rows: [ stayed, movedIn, allMovedAway ],
			ticketOptions: options,
		} );

		expect(
			bodyRows().map( ( row ) => row.getAttribute( 'data-ticket-id' ) )
		).toEqual( [ '901', '912' ] );
		expect( screen.queryByText( 'Rae Away' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Ticket not created yet' )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the moved ticket’s reference, position, type and extras, with its purchase details', async () => {
		window.fairPaymentsConnector = { connectorActive: true };
		await renderSignups( { rows: [ movedIn ], ticketOptions: options } );

		const row = ticketRow( 912 );
		expect( row ).toHaveTextContent( 'Quinn Guest' );
		expect( row ).toHaveTextContent( 'REF00912' );
		expect( row ).toHaveTextContent( 'Reduced' );
		expect(
			within( row ).getByRole( 'img', { name: 'Selected' } )
		).toBeInTheDocument();
		expect( within( row ).getByText( 'Yes' ) ).toBeInTheDocument();
	} );

	it( 'says which date a purchase is registered for only when it is another date', async () => {
		await renderSignups( { rows: [ stayed, movedIn ] } );

		expect( ticketRow( 912 ) ).toHaveTextContent(
			'Purchase registered for 17 June'
		);
		expect( ticketRow( 901 ) ).not.toHaveTextContent(
			'Purchase registered for'
		);
	} );

	it( 'offers the purchase-wide actions once, on both dates, with the purchase’s ticket counts', async () => {
		await renderSignups( { rows: [ stayed, movedIn ] } );

		[ 901, 912 ].forEach( ( id ) => {
			const row = ticketRow( id );
			expect( row ).toHaveTextContent( 'Entire purchase — 2 tickets' );
			expect( row ).toHaveTextContent(
				'1 ticket on this date; 1 on another date'
			);
			expect(
				within( row ).getAllByRole( 'button', { name: 'Move' } )
			).toHaveLength( 1 );
			expect(
				within( row ).getAllByRole( 'button', { name: 'Delete' } )
			).toHaveLength( 1 );
		} );
	} );

	it( 'shows no distribution for a purchase whose tickets are all on this date', async () => {
		await renderSignups( { rows: [ signups[ 1 ] ] } );

		expect( bodyRows()[ 0 ] ).toHaveTextContent(
			'Entire purchase — 2 tickets'
		);
		expect( bodyRows()[ 0 ] ).not.toHaveTextContent( 'on this date' );
	} );

	it( 'explains before a move that individually moved tickets stay, using the registration’s own date', async () => {
		await renderSignups( { rows: [ movedIn ] } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Move' } ) );
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Move Quinn Guest to another date',
		} );

		expect( dialog ).toHaveTextContent(
			'This moves the purchase and the 1 ticket still on the date it is registered for (17 June).'
		);
		expect( dialog ).toHaveTextContent(
			'1 ticket was moved on its own to another date and stays where it is'
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets/10/targets',
		} );
	} );

	it( 'explains that a type change reaches the tickets on other dates', async () => {
		await renderSignups( { rows: [ stayed ] } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Change ticket type' } )
		);
		const dialog = await screen.findByRole( 'dialog' );

		expect( dialog ).toHaveTextContent(
			'This changes the type of the whole registration, with all 2 of its tickets.'
		);
		expect( dialog ).toHaveTextContent(
			'That includes 1 ticket on another date.'
		);
	} );

	it( 'explains that deleting removes the purchase on every date, and its inactive tickets', async () => {
		await renderSignups( {
			rows: [
				{
					...stayed,
					quantity: 3,
					tickets: [
						...stayed.tickets,
						ticket( 903, 3, {
							event_date_id: 42,
							status: 'cancelled',
						} ),
					],
					ticket_counts: { ...stayed.ticket_counts, inactive: 1 },
				},
			],
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Delete' } ) );
		const dialog = screen.getByRole( 'dialog' );

		expect( dialog ).toHaveTextContent(
			'Delete the registration for Paula Purchaser, with all 2 of its tickets?'
		);
		expect( dialog ).toHaveTextContent(
			'This deletes the entire purchase on every date: 1 on this date and 1 ticket on another date.'
		);
		expect( dialog ).toHaveTextContent(
			'It also removes 1 cancelled or otherwise inactive ticket of this purchase.'
		);
	} );

	it( 'applies the mailing filter to the tickets listed on this date', async () => {
		await renderSignups( { rows: [ stayed, movedIn ] } );

		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect(
			bodyRows().map( ( row ) => row.getAttribute( 'data-ticket-id' ) )
		).toEqual( [ '912' ] );
	} );

	it( 'exports exactly the listed rows, with the total on the anchor only', async () => {
		const writeText = jest.fn().mockResolvedValue();
		Object.assign( navigator, { clipboard: { writeText } } );
		await renderSignups( { rows: [ stayed, movedIn, allMovedAway ] } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Export' } ) );
		await screen.findByRole( 'radio', { name: 'Markdown' } );
		fireEvent.click( screen.getByRole( 'radio', { name: 'CSV' } ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Copy to clipboard' } )
		);

		await waitFor( () => expect( writeText ).toHaveBeenCalled() );
		const lines = writeText.mock.calls[ 0 ][ 0 ].split( '\r\n' ).slice( 1 );
		expect( lines ).toHaveLength( 2 );
		// Paula's anchor is listed here; Quinn's is on the other date.
		expect( lines[ 0 ] ).toContain( 'REF00901' );
		expect( lines[ 0 ] ).toContain( ',40.00,9,' );
		expect( lines[ 1 ] ).toContain( 'REF00912' );
		expect( lines[ 1 ] ).toContain( ',,10,' );
		delete navigator.clipboard;
	} );

	it( 'keeps whole-series passes and registrations without tickets as they were', () => {
		const rows = expandTicketRows( [
			{
				...signups[ 1 ],
				recurrence_scope: 'whole_series',
				listed_ticket_ids: [ 201, 202 ],
				accounting_anchor_ticket_id: 201,
			},
			{ ...signups[ 0 ], tickets: [], listed_ticket_ids: [] },
		] );

		expect(
			rows.map( ( row ) => [
				row.ticket?.id ?? null,
				row.isFirstTicket,
				row.isAccountingAnchor,
			] )
		).toEqual( [
			[ 201, true, true ],
			[ 202, false, false ],
			[ null, true, true ],
		] );
	} );
} );

describe( 'EventSignups — Print list (#1842)', () => {
	const printButton = () =>
		screen.getByRole( 'button', { name: 'Print list' } );

	/**
	 * Click "Print list" with a stand-in preview window and parse what was
	 * written to it.
	 *
	 * @return {{html: string, doc: Document}} Printed document
	 */
	function print() {
		const written = [];
		jest.spyOn( window, 'open' ).mockReturnValue( {
			document: {
				open: jest.fn(),
				write: ( html ) => written.push( html ),
				close: jest.fn(),
			},
		} );
		fireEvent.click( printButton() );
		const html = written.join( '' );
		return {
			html,
			doc: new window.DOMParser().parseFromString( html, 'text/html' ),
		};
	}

	const cellTexts = ( row ) =>
		Array.from( row.querySelectorAll( 'th, td' ) ).map(
			( cell ) => cell.textContent
		);
	const printedHeaders = ( doc ) =>
		cellTexts( doc.querySelector( 'thead tr' ) );
	const printedRows = ( doc ) =>
		Array.from( doc.querySelectorAll( 'tbody tr' ) ).map( cellTexts );

	async function renderForPrint( config = {}, props = {} ) {
		mockApi( config );
		render(
			<EventSignups
				eventDateId={ 42 }
				eventTitle="Summer Ball"
				eventDateLabel="June 10, 2026 7:00 pm"
				{ ...props }
			/>
		);
		await waitFor( () => expect( printButton() ).toBeInTheDocument() );
	}

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'prints the List’s data columns in order, numbered rows and the event heading, without controls', async () => {
		window.fairPaymentsConnector = { connectorActive: true };
		window.fairEventsManageEventData = { audienceUrl: '/audience' };
		await renderForPrint( { ticketOptions: options } );
		await screen.findByText( 'Ada Lovelace' );

		const screenHeaders = columnHeaders();
		const { html, doc } = print();

		expect( screenHeaders.pop() ).toBe( 'Actions' );
		expect( printedHeaders( doc ) ).toEqual( screenHeaders );
		expect( printedHeaders( doc ) ).toEqual( [
			'#',
			'Name',
			'Ticket',
			'Ticket Type',
			'Dinner',
			'Afterparty',
			'Status',
			'Mailing',
		] );
		expect( printedRows( doc ) ).toEqual( [
			[
				'1',
				'Ada Lovelace',
				'REF00101',
				'General',
				'',
				'',
				'Confirmed',
				'✓',
			],
			[ '2', 'Bob, Jr.', 'REF00201', 'General', '', '', 'Confirmed', '' ],
			[ '3', 'Bob, Jr.', 'REF00202', 'General', '', '', 'Confirmed', '' ],
		] );
		expect( doc.querySelector( 'h1' ).textContent ).toBe( 'Summer Ball' );
		expect( doc.querySelector( '.meta' ).textContent ).toBe(
			'June 10, 2026 7:00 pm · List · 3 tickets'
		);
		expect( doc.title ).toBe( 'Summer Ball — List' );

		// No actions, links or emails; the only control is the Print button.
		expect( doc.querySelectorAll( 'a' ) ).toHaveLength( 0 );
		expect(
			Array.from( doc.querySelectorAll( 'button' ) ).map(
				( button ) => button.textContent
			)
		).toEqual( [ 'Print' ] );
		expect( html ).not.toContain( 'Delete' );
		expect( html ).not.toContain( 'Edit ticket' );
		expect( html ).not.toContain( 'ada@example.com' );
		// The amount, wherever a column width happens to read the same.
		expect( doc.body.textContent ).not.toContain( '20.00' );
		expect( html ).not.toContain( 'Ticket 1 (' );
		expect( html ).not.toContain( '2026-07-20 10:00:00' );
		expect( html ).toContain( '.toolbar { display: none; }' );
		expect( html ).toContain( 'size: landscape' );
	} );

	it( 'prints every row while the mailing filter narrows the screen', async () => {
		await renderForPrint();
		await screen.findByText( 'Ada Lovelace' );
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);
		expect( bodyRows() ).toHaveLength( 1 );

		const { doc } = print();

		expect(
			printedRows( doc ).map( ( row ) => row.slice( 0, 2 ) )
		).toEqual( [
			[ '1', 'Ada Lovelace' ],
			[ '2', 'Bob, Jr.' ],
			[ '3', 'Bob, Jr.' ],
		] );
	} );

	it( 'stays available when the filter matches nothing but the List has rows', async () => {
		await renderForPrint( { rows: [ signups[ 1 ] ] } );
		await screen.findAllByText( 'Bob, Jr.' );
		fireEvent.click(
			screen.getByRole( 'checkbox', { name: 'Mailing opt-ins only' } )
		);

		expect(
			screen.getByRole( 'button', { name: 'Export' } )
		).toBeDisabled();
		expect( printButton() ).toBeEnabled();
		expect( printedRows( print().doc ) ).toHaveLength( 2 );
	} );

	it( 'is disabled when the complete List is empty', async () => {
		await renderForPrint( { rows: unsuccessfulSignups } );
		await screen.findByText( 'No confirmed registrations yet.' );
		const open = jest.spyOn( window, 'open' );

		expect( printButton() ).toBeDisabled();
		fireEvent.click( printButton() );
		expect( open ).not.toHaveBeenCalled();
	} );

	it( 'explains a blocked print window and clears the message once printing works', async () => {
		await renderForPrint();
		await screen.findByText( 'Ada Lovelace' );
		jest.spyOn( window, 'open' ).mockReturnValue( null );
		// The notice is also announced, so look at the visible one only.
		const notice = () =>
			document.querySelector(
				'.fair-events-signups .components-notice.is-error'
			);

		fireEvent.click( printButton() );

		expect( notice() ).toHaveTextContent(
			'Could not open the print window. Allow pop-ups for this site and try again.'
		);

		print();

		expect( notice() ).toBeNull();
	} );

	it( 'prints each extra state with a legend, per ticket', async () => {
		await renderForPrint( {
			rows: [
				{
					...signups[ 1 ],
					tickets: [
						ticket( 201, 1, { confirmed_activity_ids: [ 7 ] } ),
						ticket( 202, 2, { confirmed_activity_ids: [ 8 ] } ),
					],
				},
				{ ...signups[ 0 ], tickets: [] },
			],
			ticketOptions: options,
		} );
		await screen.findAllByText( 'Bob, Jr.' );

		const { doc } = print();

		expect(
			printedRows( doc ).map( ( row ) => row.slice( 2, 6 ) )
		).toEqual( [
			[ 'REF00201', 'General', '✓', '' ],
			[ 'REF00202', 'General', '', '✓' ],
			[ 'Ticket not created yet', 'General', '?', '?' ],
		] );
		expect(
			Array.from( doc.querySelectorAll( '.legend-entry' ) ).map(
				( entry ) => entry.textContent.trim()
			)
		).toEqual( [
			'✓ Selected',
			'Not selected',
			'? Selection unavailable',
		] );
		expect( doc.querySelector( '.warning' ).textContent ).toBe(
			'Some older registrations are still being split into individual tickets. They are listed as one row for now.'
		);
	} );

	it( 'prints no legend or warning when there are no extras and every ticket exists', async () => {
		await renderForPrint();
		await screen.findByText( 'Ada Lovelace' );

		const { doc } = print();

		expect( doc.querySelector( '.legend' ) ).toBeNull();
		expect( doc.querySelector( '.warning' ) ).toBeNull();
	} );

	it( 'leaves out unsuccessful registrations and tickets that stopped admitting', async () => {
		await renderForPrint( {
			rows: [
				...unsuccessfulSignups,
				{
					...signups[ 1 ],
					tickets: [
						ticket( 201, 1, { status: 'cancelled' } ),
						ticket( 202, 2 ),
					],
				},
				{
					...signups[ 0 ],
					id: 5,
					name: 'Gone Entirely',
					tickets: [ ticket( 501, 1, { status: 'refunded' } ) ],
				},
			],
		} );
		await screen.findByText( 'Bob, Jr.' );

		const { html, doc } = print();

		expect(
			printedRows( doc ).map( ( row ) => row.slice( 0, 3 ) )
		).toEqual( [ [ '1', 'Bob, Jr.', 'REF00202' ] ] );
		expect( html ).not.toContain( 'Unsuccessful' );
		expect( html ).not.toContain( 'Gone Entirely' );
		expect( doc.querySelector( '.meta' ).textContent ).toContain(
			'1 ticket'
		);
	} );

	it( 'prints an individually moved ticket only on its current date, with its purchase note', async () => {
		const stayed = {
			...signups[ 1 ],
			id: 9,
			name: 'Paula Purchaser',
			event_date_id: 42,
			event_date_label: '10 June',
			tickets: [
				ticket( 901, 1, { event_date_id: 42 } ),
				ticket( 902, 2, { event_date_id: 43 } ),
			],
			listed_ticket_ids: [ 901 ],
		};
		const movedIn = {
			...signups[ 1 ],
			id: 10,
			name: 'Quinn Guest',
			event_date_id: 43,
			event_date_label: '17 June',
			tickets: [
				ticket( 911, 1, { event_date_id: 43 } ),
				ticket( 912, 2, {
					event_date_id: 42,
					ticket_type_name: 'Reduced',
				} ),
			],
			listed_ticket_ids: [ 912 ],
		};
		const allMovedAway = {
			...stayed,
			id: 11,
			name: 'Rae Away',
			tickets: [ ticket( 921, 1, { event_date_id: 43 } ) ],
			listed_ticket_ids: [],
		};
		await renderForPrint( { rows: [ stayed, movedIn, allMovedAway ] } );
		await screen.findByText( 'Paula Purchaser' );

		const { html, doc } = print();

		expect(
			printedRows( doc ).map( ( row ) => row.slice( 0, 4 ) )
		).toEqual( [
			[ '1', 'Paula Purchaser', 'REF00901', 'General' ],
			[
				'2',
				'Quinn GuestPurchase registered for 17 June',
				'REF00912',
				'Reduced',
			],
		] );
		expect( html ).not.toContain( 'Rae Away' );
		expect( html ).not.toContain( 'REF00902' );
		expect( html ).not.toContain( 'REF00911' );
	} );

	it( 'prints over-capacity status as text, without its details', async () => {
		await renderForPrint( {
			rows: [
				{
					...signups[ 0 ],
					over_capacity: 1,
					overrides: [
						{
							action: 'move',
							user_display_name: 'Admin Person',
							created_at: '2026-07-01 09:00:00',
							reason: 'Promised a place',
						},
					],
				},
			],
		} );
		await screen.findByText( 'Ada Lovelace' );

		const { html, doc } = print();

		expect( printedRows( doc )[ 0 ][ 4 ] ).toBe(
			'Confirmed — over capacity'
		);
		expect( html ).not.toContain( 'Details' );
		expect( html ).not.toContain( 'Promised a place' );
	} );

	it( 'escapes names, titles and extra labels', async () => {
		const markup = '<img src=x onerror="alert(1)">';
		await renderForPrint(
			{
				rows: [
					{
						...signups[ 0 ],
						name: `Eve ${ markup } & "Co" 'x'`,
						event_date_id: 43,
						event_date_label: '<b>17 June</b>',
						tickets: [
							ticket( 101, 1, {
								ticket_type_name: '<script>alert(2)</script>',
							} ),
						],
					},
				],
				ticketOptions: [ { id: 7, name: '<i>Dinner</i>' } ],
			},
			{
				eventTitle: '</title><script>alert(3)</script>',
				eventDateLabel: '<u>June</u>',
			}
		);
		await screen.findByText( /Eve/ );

		const { html, doc } = print();

		expect( doc.querySelectorAll( 'img, script, b, i, u' ) ).toHaveLength(
			0
		);
		expect( html ).not.toContain( '<script>' );
		expect( html ).toContain(
			'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
		);
		expect( html ).toContain( '&amp; &quot;Co&quot; &#39;x&#39;' );
		expect( doc.querySelector( 'h1' ).textContent ).toBe(
			'</title><script>alert(3)</script>'
		);
		expect( printedHeaders( doc )[ 4 ] ).toBe( '<i>Dinner</i>' );
		expect( printedRows( doc )[ 0 ][ 1 ] ).toBe(
			`Eve ${ markup } & "Co" 'x'Purchase registered for <b>17 June</b>`
		);
		expect( printedRows( doc )[ 0 ][ 3 ] ).toBe(
			'<script>alert(2)</script>'
		);
	} );

	it( 'names an untitled event rather than printing an empty heading', async () => {
		await renderForPrint( {}, { eventTitle: '', eventDateLabel: '' } );
		await screen.findByText( 'Ada Lovelace' );

		const { doc } = print();

		expect( doc.querySelector( 'h1' ).textContent ).toBe(
			'(untitled event)'
		);
		expect( doc.querySelector( '.meta' ).textContent ).toBe(
			'List · 3 tickets'
		);
	} );

	it( 'prints the participant’s current consent as a mark, and never reads a refusal into the registration', async () => {
		const row = ( id, name, consent, optIn ) => ( {
			...signups[ 0 ],
			id,
			name,
			newsletter_consent: consent,
			mailing_opt_in: optIn,
			tickets: [ ticket( id * 100, 1 ) ],
		} );
		await renderForPrint( {
			rows: [
				row( 1, 'Granted Now', 'granted', false ),
				row( 2, 'Declined Now', 'declined', true ),
				row( 3, 'Unspecified Now', 'unspecified', true ),
				row( 4, 'Unlinked Opt-in', null, true ),
				row( 5, 'Unlinked No', null, false ),
				row( 6, 'Older Response', undefined, 1 ),
			],
		} );
		await screen.findByText( 'Granted Now' );

		// The screen keeps the registration's own Yes/No.
		expect(
			bodyRows().map(
				( tr ) => tr.querySelectorAll( 'td' )[ 5 ].textContent
			)
		).toEqual( [ 'No', 'Yes', 'Yes', 'Yes', 'No', 'Yes' ] );

		const { doc } = print();

		expect(
			printedRows( doc ).map( ( cells ) => [ cells[ 1 ], cells[ 5 ] ] )
		).toEqual( [
			[ 'Granted Now', '✓' ],
			[ 'Declined Now', '✗' ],
			[ 'Unspecified Now', '' ],
			[ 'Unlinked Opt-in', '✓' ],
			[ 'Unlinked No', '' ],
			[ 'Older Response', '✓' ],
		] );
		expect( doc.querySelector( 'tbody td.col-mailing' ).textContent ).toBe(
			'✓'
		);
	} );

	it( 'keeps seven extras in one section now that the date column is gone', async () => {
		const sevenOptions = Array.from( { length: 7 }, ( _, index ) => ( {
			id: 100 + index,
			name: `Extra ${ index + 1 }`,
		} ) );
		await renderForPrint( { ticketOptions: sevenOptions } );
		await screen.findByText( 'Ada Lovelace' );

		const { doc } = print();

		expect( doc.querySelectorAll( 'table' ) ).toHaveLength( 1 );
		expect( doc.querySelector( 'h2' ) ).toBeNull();
		expect( printedHeaders( doc ) ).toHaveLength( 13 );
	} );

	it( 'splits a table with many extras into sections that keep every column, row and value', async () => {
		const manyOptions = Array.from( { length: 20 }, ( _, index ) => ( {
			id: 100 + index,
			name: `Extra ${ index + 1 }`,
		} ) );
		await renderForPrint( {
			rows: [
				{
					...signups[ 1 ],
					tickets: [
						ticket( 201, 1, {
							confirmed_activity_ids: [ 100, 119 ],
						} ),
						ticket( 202, 2, { confirmed_activity_ids: [ 110 ] } ),
					],
				},
			],
			ticketOptions: manyOptions,
		} );
		await screen.findAllByText( 'Bob, Jr.' );
		const screenHeaders = columnHeaders().slice( 0, -1 );

		const { doc } = print();

		const tables = Array.from( doc.querySelectorAll( 'table' ) );
		expect( tables.length ).toBeGreaterThan( 1 );
		expect(
			Array.from( doc.querySelectorAll( 'h2' ) ).map(
				( heading ) => heading.textContent
			)
		).toEqual(
			tables.map(
				( _, index ) =>
					`Columns — part ${ index + 1 } of ${ tables.length }`
			)
		);

		const merged = [ {}, {} ];
		const seenHeaders = [];
		tables.forEach( ( table, tableIndex ) => {
			const headers = cellTexts( table.querySelector( 'thead tr' ) );
			if ( tableIndex > 0 ) {
				// Later sections repeat the row number and the ticket.
				expect( headers.slice( 0, 2 ) ).toEqual( [ '#', 'Ticket' ] );
			}
			const rows = Array.from( table.querySelectorAll( 'tbody tr' ) );
			expect( rows ).toHaveLength( 2 );
			rows.forEach( ( row, rowIndex ) => {
				const cells = cellTexts( row );
				expect( cells[ 0 ] ).toBe( String( rowIndex + 1 ) );
				headers.forEach( ( header, cellIndex ) => {
					merged[ rowIndex ][ header ] = cells[ cellIndex ];
				} );
			} );
			seenHeaders.push( ...headers.slice( tableIndex > 0 ? 2 : 0 ) );
		} );

		expect( seenHeaders ).toEqual( screenHeaders );
		expect( merged[ 0 ] ).toMatchObject( {
			Name: 'Bob, Jr.',
			Ticket: 'REF00201',
			'Extra 1': '✓',
			'Extra 2': '',
			'Extra 11': '',
			'Extra 20': '✓',
			Status: 'Confirmed',
			Mailing: '',
		} );
		expect( merged[ 1 ] ).toMatchObject( {
			Ticket: 'REF00202',
			'Extra 1': '',
			'Extra 11': '✓',
			'Extra 20': '',
		} );
	} );
} );

describe( 'splitColumnSections', () => {
	const column = ( key, isExtra = false ) => ( { key, label: key, isExtra } );

	it( 'keeps a table that fits in one section', () => {
		const columns = [ column( 'number' ), column( 'name' ) ];
		expect( splitColumnSections( columns ) ).toEqual( [ columns ] );
	} );

	it( 'never leaves a section with only the repeated columns', () => {
		const columns = [
			column( 'number' ),
			column( 'name' ),
			column( 'ticket' ),
			column( 'a', true ),
			column( 'b', true ),
		];

		const sections = splitColumnSections( columns, 1 );

		expect(
			sections.map( ( section ) => section.map( ( c ) => c.key ) )
		).toEqual( [
			[ 'number' ],
			[ 'number', 'name' ],
			[ 'number', 'ticket' ],
			[ 'number', 'ticket', 'a' ],
			[ 'number', 'ticket', 'b' ],
		] );
	} );
} );

describe( 'scopeNotes', () => {
	const signup = { event_date_label: '10 June', tickets: [ {}, {} ] };

	it( 'keeps the whole-registration wording when no ticket was moved on its own', () => {
		expect(
			scopeNotes( {
				isMove: true,
				signup,
				counts: {
					confirmed: 2,
					onThisDate: 2,
					onOtherDates: 0,
					onRegistrationDate: 2,
					inactive: 0,
				},
			} )
		).toEqual( [
			'This moves the whole registration, with all 2 of its tickets.',
		] );
	} );

	it( 'says no ticket moves when every ticket was moved on its own, and names inactive tickets', () => {
		expect(
			scopeNotes( {
				isMove: true,
				signup,
				counts: {
					confirmed: 2,
					onThisDate: 2,
					onOtherDates: 0,
					onRegistrationDate: 0,
					inactive: 1,
				},
			} )
		).toEqual( [
			'No ticket of this purchase is still on the date it is registered for (10 June), so no ticket moves: only the date the purchase is registered for changes.',
			'2 tickets were moved on their own to other dates and stay where they are; any already on the new date stay there with the purchase.',
			'1 cancelled or otherwise inactive ticket is left as it is.',
		] );
	} );
} );

describe( 'EventSignups — test-payment tickets (#1866)', () => {
	const testPurchase = {
		...signups[ 1 ],
		id: 5,
		name: 'Tess Tester',
		transaction_id: 505,
		is_test_payment: true,
	};
	const livePurchase = { ...signups[ 0 ], is_test_payment: false };
	const freeRegistration = {
		...signupWithMissingTicketType,
		is_test_payment: false,
	};
	const unresolvedPurchase = {
		...signups[ 0 ],
		id: 6,
		name: 'Una Resolved',
		transaction_id: 506,
		is_test_payment: null,
		tickets: [ ticket( 601, 1 ) ],
	};

	const warningIn = ( row ) =>
		row.querySelector( '.fair-events-signups__test-payment' );

	function print() {
		const written = [];
		jest.spyOn( window, 'open' ).mockReturnValue( {
			document: {
				open: jest.fn(),
				write: ( html ) => written.push( html ),
				close: jest.fn(),
			},
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Print list' } ) );
		return new window.DOMParser().parseFromString(
			written.join( '' ),
			'text/html'
		);
	}

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	it( 'lists confirmed test purchases and marks every one of their tickets', async () => {
		await renderSignups( {
			rows: [
				testPurchase,
				livePurchase,
				freeRegistration,
				unresolvedPurchase,
			],
		} );

		const rows = bodyRows();
		expect( rows ).toHaveLength( 5 );
		const byRef = ( ref ) =>
			rows.find( ( row ) => row.textContent.includes( ref ) );

		[ 'REF00201', 'REF00202' ].forEach( ( ref ) => {
			const row = byRef( ref );
			expect( row ).toHaveTextContent( 'Tess Tester' );
			expect( warningIn( row ) ).toHaveTextContent( 'Test payment' );
			// The warning sits in the Ticket cell, beside the reference.
			expect(
				within( row ).getAllByRole( 'cell' )[ 2 ]
			).toHaveTextContent( `${ ref }Test payment` );
		} );
		[ 'REF00101', 'REF00301', 'REF00601' ].forEach( ( ref ) => {
			expect( warningIn( byRef( ref ) ) ).toBeNull();
		} );
	} );

	it( 'keeps the confirmation and over-capacity status beside the warning', async () => {
		await renderSignups( {
			rows: [ { ...testPurchase, over_capacity: true } ],
		} );

		bodyRows().forEach( ( row ) => {
			expect( warningIn( row ) ).not.toBeNull();
			expect( row ).toHaveTextContent( 'Confirmed — over capacity' );
		} );
	} );

	it( 'marks a confirmed test registration whose tickets are not created yet', async () => {
		await renderSignups( {
			rows: [ { ...testPurchase, tickets: [] } ],
		} );

		const [ row ] = bodyRows();
		expect( row ).toHaveTextContent( 'Ticket not created yet' );
		expect( warningIn( row ) ).toHaveTextContent( 'Test payment' );
	} );

	it( 'leaves out unsuccessful test purchases', async () => {
		await renderSignups( {
			rows: [
				livePurchase,
				...unsuccessfulSignups.map( ( row ) => ( {
					...row,
					is_test_payment: true,
				} ) ),
			],
		} );

		expect( bodyRows() ).toHaveLength( 1 );
		expect( screen.queryByText( 'Test payment' ) ).not.toBeInTheDocument();
	} );

	it( 'prints a text warning beside every test ticket', async () => {
		await renderSignups( {
			rows: [ testPurchase, livePurchase, freeRegistration ],
		} );

		const doc = print();
		const printed = Array.from( doc.querySelectorAll( 'tbody tr' ) );
		expect( printed ).toHaveLength( 4 );
		const ticketCells = printed.map(
			( row ) => row.querySelectorAll( 'td' )[ 2 ]
		);
		expect( ticketCells.map( ( cell ) => cell.textContent ) ).toEqual( [
			'REF00201 Test payment',
			'REF00202 Test payment',
			'REF00101',
			'REF00301',
		] );
		expect(
			ticketCells.map(
				( cell ) => cell.querySelectorAll( '.test-warning' ).length
			)
		).toEqual( [ 1, 1, 0, 0 ] );
		// Readable in black and white: bold, bordered, no background color.
		const style = doc.querySelector( 'style' ).textContent;
		const rule = style.slice(
			style.indexOf( '.test-warning {' ),
			style.indexOf( '}', style.indexOf( '.test-warning {' ) )
		);
		expect( rule ).toContain( 'font-weight: 700' );
		expect( rule ).toContain( 'border: 2px solid #111' );
		expect( rule ).not.toContain( 'background' );
	} );

	it( 'repeats the warning in every printed section', async () => {
		const manyOptions = Array.from( { length: 20 }, ( _, index ) => ( {
			id: 100 + index,
			name: `Extra ${ index + 1 }`,
		} ) );
		await renderSignups( {
			rows: [ testPurchase ],
			ticketOptions: manyOptions,
		} );

		const doc = print();
		const tables = Array.from( doc.querySelectorAll( 'table' ) );
		expect( tables.length ).toBeGreaterThan( 1 );
		tables.forEach( ( table ) => {
			const rows = Array.from( table.querySelectorAll( 'tbody tr' ) );
			expect( rows ).toHaveLength( 2 );
			rows.forEach( ( row ) => {
				expect(
					row.querySelector( '.test-warning' )?.textContent
				).toBe( 'Test payment' );
			} );
		} );
	} );
} );
