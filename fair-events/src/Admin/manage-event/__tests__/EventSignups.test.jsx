/**
 * @jest-environment jsdom
 *
 * Component tests for the List tab (#1568 replaces the fixed-column CSV
 * download with the "Export" popup — see SignupExportModal.test.jsx for its
 * own coverage; #1683 narrows the table to confirmed registrations, hides
 * email and amount, and adds numbering and extra columns).
 *
 * Exercises:
 *   - Only confirmed registrations (paid or free) are listed and exported.
 *   - Email and amount stay out of the table and the delete dialog, but are
 *     still exported.
 *   - Rows are numbered from 1 after filtering.
 *   - Each configured extra gets a column with a selected / not selected /
 *     unavailable indicator; no extras means no extra columns.
 *   - Mailing opt-ins filter, empty states, and delete.
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
import EventSignups, {
	buildConfirmedOptionsByParticipant,
} from '../EventSignups.js';

jest.mock( '@wordpress/api-fetch' );

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
 */
function mockApi( {
	rows = signups,
	ticketOptions = [],
	participants = [],
	deleteResult = { deleted: true },
} = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( method === 'DELETE' ) {
			return deleteResult instanceof Error
				? Promise.reject( deleteResult )
				: Promise.resolve( deleteResult );
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
		await screen.findByText( firstConfirmed.name );
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
		expect(
			screen.getByText( 'Confirmed — over capacity' )
		).toBeInTheDocument();
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
		expect( screen.getAllByText( 'General' ) ).toHaveLength( 2 );
		expect( screen.queryByText( '3' ) ).not.toBeInTheDocument();
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
		expect(
			bodyRows().map( ( row ) => within( row ).getAllByRole( 'cell' ) )
		).toHaveLength( 3 );
		expect(
			bodyRows().map(
				( row ) => within( row ).getAllByRole( 'cell' )[ 0 ].textContent
			)
		).toEqual( [ '1', '2', '3' ] );

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
		expect( lines[ 0 ] ).toContain( 'Amount' );
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
			'Ticket Type',
			'Qty',
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
				'Ticket Type',
				'Qty',
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

	it( 'checks only extras the participant holds as confirmed', async () => {
		await renderSignups( {
			ticketOptions: options,
			participants: [
				{
					participant_id: 11,
					ticket_option_ids: [ 7, 8 ],
					// 8 is still held for an unpaid add-on.
					confirmed_ticket_option_ids: [ 7 ],
				},
				{
					participant_id: 12,
					ticket_option_ids: [],
					confirmed_ticket_option_ids: [],
				},
			],
		} );

		await waitFor( () =>
			expect(
				within( bodyRows()[ 0 ] ).getByRole( 'img', {
					name: 'Selected',
				} )
			).toBeInTheDocument()
		);
		const [ ada, bob ] = bodyRows();
		expect(
			within( ada )
				.getAllByRole( 'img' )
				.map( ( img ) => img.getAttribute( 'aria-label' ) )
		).toEqual( [ 'Selected', 'Not selected' ] );
		expect(
			within( bob )
				.getAllByRole( 'img' )
				.map( ( img ) => img.getAttribute( 'aria-label' ) )
		).toEqual( [ 'Not selected', 'Not selected' ] );
	} );

	it( 'shows an unavailable indicator when a registration has no Audience record', async () => {
		await renderSignups( {
			rows: [ { ...signups[ 0 ], participant_id: null } ],
			ticketOptions: options,
			participants: [],
		} );

		await waitFor( () =>
			expect(
				screen.getAllByRole( 'img', { name: 'Selection unavailable' } )
			).toHaveLength( 2 )
		);
	} );

	it( 'shows an unavailable indicator when the Audience roster fails to load', async () => {
		await renderSignups( {
			ticketOptions: options,
			participants: new Error( 'boom' ),
		} );

		await waitFor( () =>
			expect(
				screen.getAllByRole( 'img', { name: 'Selection unavailable' } )
			).toHaveLength( 4 )
		);
		expect(
			screen.queryByRole( 'img', { name: 'Not selected' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps extra columns but marks selections unavailable without Fair Audience', async () => {
		delete window.fairEventsManageEventData;
		await renderSignups( { ticketOptions: options } );

		await waitFor( () => expect( columnHeaders() ).toContain( 'Dinner' ) );
		expect(
			screen.getAllByRole( 'img', { name: 'Selection unavailable' } )
		).toHaveLength( 4 );
		expect(
			document.querySelector( '.components-notice__content' )
		).toHaveTextContent(
			'Selected extras are shown only when Fair Audience is active.'
		);
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( '/fair-audience/' ),
			} )
		);
	} );
} );

describe( 'buildConfirmedOptionsByParticipant', () => {
	it( 'merges confirmed option IDs per participant and ignores unlinked rows', () => {
		const map = buildConfirmedOptionsByParticipant( [
			{ participant_id: '5', confirmed_ticket_option_ids: [ 1 ] },
			{ participant_id: 5, confirmed_ticket_option_ids: [ '2' ] },
			{ participant_id: 6 },
			{ participant_id: null, confirmed_ticket_option_ids: [ 3 ] },
		] );

		expect( [ ...map.get( 5 ) ] ).toEqual( [ 1, 2 ] );
		expect( map.get( 6 ).size ).toBe( 0 );
		expect( map.size ).toBe( 2 );
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
				expect( screen.getByText( name ) ).toBeInTheDocument();
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
			screen.getByRole( 'button', { name: 'Delete signup' } )
		);

		await waitFor( () =>
			expect(
				screen.queryByText( 'Ada Lovelace' )
			).not.toBeInTheDocument()
		);
		expect( screen.getByText( 'Bob, Jr.' ) ).toBeInTheDocument();
		expect(
			within( bodyRows()[ 0 ] ).getAllByRole( 'cell' )[ 0 ]
		).toHaveTextContent( '1' );
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
			screen.getByRole( 'button', { name: 'Delete signup' } )
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
