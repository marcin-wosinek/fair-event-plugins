/**
 * @jest-environment jsdom
 *
 * Component tests for tickets in the Audience tab (#1533, #1530).
 *
 * Exercises:
 *   - A purchaser holding two tickets gets one row per ticket under their
 *     participant row, and checking one in updates only that ticket.
 *   - "Edit ticket" edits one ticket's activities without touching its
 *     sibling; "Edit participant" never sends ticket activities.
 *   - Activity totals count tickets, with participant-level activity
 *     totalled separately.
 *   - History not tied to a ticket is shown, and printed, as such.
 *   - The printed list gives each ticket its own row.
 *   - "Assign ticket" gives one ticket to an existing or a new participant,
 *     names the purchaser and the current assignee, offers the existing
 *     identity on an email conflict, and moves the ticket to its new holder
 *     (#1535).
 *   - "Cancel ticket" and "Delete ticket" name the ticket, its purchaser
 *     and assignee and what happens to the payment, and send a request for
 *     that ticket only; a cancelled ticket offers nothing but deletion
 *     (#1699).
 *   - Search finds tickets by purchaser, assignee, email and reference and
 *     shows only matching tickets; the tickets CSV exports those same
 *     tickets, one row each (#1699).
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventAudience from '../EventAudience.js';
import { buildTicketsCsv, escapeCsvField } from '../ticketSearch.js';

jest.mock( '@wordpress/api-fetch' );

const OPTIONS = [
	{ id: 7, name: 'Morning workshop', short_name: 'AM' },
	{ id: 8, name: 'Evening workshop', short_name: 'PM' },
];

const TICKET_ONE = {
	id: 101,
	reference: 'AAAA1111',
	signup_id: 40,
	ticket_type_id: 3,
	ticket_type_name: 'Regular',
	status: 'confirmed',
	attended_at: null,
	activity_ids: [ 7 ],
	activity_names: [ 'Morning workshop' ],
	confirmed_activity_ids: [ 7 ],
};

const TICKET_TWO = {
	id: 102,
	reference: 'BBBB2222',
	signup_id: 41,
	ticket_type_id: 3,
	ticket_type_name: 'Regular',
	status: 'confirmed',
	attended_at: null,
	activity_ids: [ 7, 8 ],
	activity_names: [ 'Morning workshop', 'Evening workshop' ],
	confirmed_activity_ids: [ 7, 8 ],
};

const PARTICIPANT = {
	id: 1,
	participant_id: 10,
	event_date_id: 5,
	is_series_pass: false,
	participant_name: 'Jane Doe',
	name: 'Jane',
	surname: 'Doe',
	participant_email: 'jane@example.com',
	email_profile: 'minimal',
	label: 'signed_up',
	ticket_type_id: 3,
	ticket_type_name: 'Regular',
	attended_at: null,
	created_at: '2026-01-01 10:00:00',
	payment_expires_at: null,
	ticket_option_names: [ 'Morning workshop', 'Evening workshop' ],
	ticket_option_ids: [ 7, 8 ],
	confirmed_ticket_option_ids: [ 7, 8 ],
	participant_ticket_option_ids: [],
	participant_ticket_option_names: [],
	tickets: [ TICKET_ONE, TICKET_TWO ],
	admin_comment: '',
};

function mockApi( participant = PARTICIPANT ) {
	apiFetch.mockImplementation( ( { path, method, data } ) => {
		const ticketMatch = path.match(
			/^\/fair-audience\/v1\/event-dates\/5\/tickets\/(\d+)$/
		);
		if ( ticketMatch && ! method ) {
			const source = [ TICKET_ONE, TICKET_TWO ].find(
				( t ) => t.id === Number( ticketMatch[ 1 ] )
			);
			return Promise.resolve( {
				ticket: {
					...source,
					position: 1,
					participant_name: 'Jane Doe',
					editable: true,
					over_capacity_activity_ids: [],
				},
				ticket_types: [
					{
						id: 3,
						label: 'Regular',
						current: true,
						capacity: null,
						remaining: null,
						activities_enabled: true,
						minimum_activities: 0,
						maximum_activities: null,
					},
				],
				activities: OPTIONS.map( ( o ) => ( {
					id: o.id,
					name: o.name,
					capacity: null,
					remaining: null,
				} ) ),
			} );
		}
		if ( ticketMatch && method === 'PUT' ) {
			const source = [ TICKET_ONE, TICKET_TWO ].find(
				( t ) => t.id === Number( ticketMatch[ 1 ] )
			);
			const activityIds = data.activity_ids ?? source.activity_ids;
			return Promise.resolve( {
				...source,
				attended_at:
					data.attended === undefined
						? source.attended_at
						: data.attended
						? '2026-01-01 18:00:00'
						: null,
				activity_ids: activityIds,
				activity_names: OPTIONS.filter( ( o ) =>
					activityIds.includes( o.id )
				).map( ( o ) => o.name ),
				confirmed_activity_ids: activityIds,
			} );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve(
				Array.isArray( participant ) ? participant : [ participant ]
			);
		}
		if ( path.includes( '/fair-events/v1/event-dates/5/tickets' ) ) {
			return Promise.resolve( { options: OPTIONS, ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

function renderAudience() {
	render(
		<EventAudience
			eventId={ 1 }
			eventDateId={ 5 }
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Weekly class"
		/>
	);
}

// Someone added by hand, without tickets: activities and check-in stay on
// the participant.
const WALK_IN = {
	...PARTICIPANT,
	id: 2,
	participant_id: 11,
	participant_name: 'Sam Walkin',
	name: 'Sam',
	surname: 'Walkin',
	ticket_type_id: null,
	ticket_type_name: null,
	ticket_option_names: [ 'Evening workshop' ],
	ticket_option_ids: [ 8 ],
	confirmed_ticket_option_ids: [ 8 ],
	participant_ticket_option_ids: [ 8 ],
	participant_ticket_option_names: [ 'Evening workshop' ],
	tickets: [],
};

// A ticket holder with an activity and a check-in recorded before tickets
// kept them, not attributed to their ticket.
const WITH_HISTORY = {
	...PARTICIPANT,
	attended_at: '2025-12-01 18:00:00',
	ticket_option_names: [ 'Morning workshop', 'Evening workshop' ],
	ticket_option_ids: [ 7, 8 ],
	participant_ticket_option_ids: [ 8 ],
	participant_ticket_option_names: [ 'Evening workshop' ],
	tickets: [ TICKET_ONE ],
};

function ticketRow( ticketId ) {
	return document.querySelector( `tr[data-ticket-id="${ ticketId }"]` );
}

function totalsCells( label ) {
	const row = screen.getByText( label ).closest( 'tr' );
	return Array.from( row.querySelectorAll( 'th' ) )
		.slice( 1, 1 + OPTIONS.length )
		.map( ( th ) => th.textContent );
}

function ticketCalls() {
	return apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter(
			( args ) =>
				args.method === 'PUT' && /\/tickets\/\d+$/.test( args.path )
		);
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — tickets in the Audience tab', () => {
	it( 'shows each of a purchaser’s tickets as its own row under the participant', async () => {
		mockApi();
		renderAudience();

		await screen.findByText( 'Jane Doe' );
		expect( screen.getByText( '2 tickets' ) ).toBeInTheDocument();

		const first = ticketRow( 101 );
		const second = ticketRow( 102 );
		expect( first ).toHaveTextContent( 'Ticket 1 (AAAA1111)' );
		expect( second ).toHaveTextContent( 'Ticket 2 (BBBB2222)' );
		expect( first ).toHaveTextContent( 'Regular' );
		expect( first ).toHaveTextContent( 'Confirmed' );

		// Ticket and participant actions are separate controls.
		expect(
			within( first ).getByRole( 'button', {
				name: 'Edit Ticket 1 — Regular (AAAA1111)',
			} )
		).toBeInTheDocument();
		expect(
			within( first ).queryByRole( 'button', {
				name: 'Edit participant',
			} )
		).not.toBeInTheDocument();
		const participantRow = document.querySelector(
			'tr[data-participant-id="10"]'
		);
		expect(
			within( participantRow ).getByRole( 'button', {
				name: 'Edit participant',
			} )
		).toBeInTheDocument();
		expect(
			within( participantRow ).queryByRole( 'checkbox' )
		).not.toBeInTheDocument();
	} );

	it( 'checks in one of two sibling tickets without changing the other', async () => {
		mockApi();
		renderAudience();

		const first = await screen.findByRole( 'checkbox', {
			name: 'Checked in: Ticket 1 — Regular (AAAA1111)',
		} );
		const second = screen.getByRole( 'checkbox', {
			name: 'Checked in: Ticket 2 — Regular (BBBB2222)',
		} );

		fireEvent.click( second );

		await waitFor( () => expect( ticketCalls() ).toHaveLength( 1 ) );
		expect( ticketCalls()[ 0 ] ).toEqual( {
			path: '/fair-audience/v1/event-dates/5/tickets/102',
			method: 'PUT',
			data: { attended: true },
		} );
		expect( second ).toBeChecked();
		expect( first ).not.toBeChecked();
	} );

	it( 'edits only the selected ticket’s activities', async () => {
		mockApi();
		renderAudience();

		await screen.findByText( 'Jane Doe' );
		fireEvent.click(
			within( ticketRow( 102 ) ).getByRole( 'button', {
				name: 'Edit Ticket 2 — Regular (BBBB2222)',
			} )
		);
		const modal = await screen.findByRole( 'dialog', {
			name: 'Edit ticket — Jane Doe',
		} );
		fireEvent.click(
			await within( modal ).findByRole( 'checkbox', {
				name: 'Morning workshop',
			} )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save ticket' } )
		);

		await waitFor( () => expect( ticketCalls() ).toHaveLength( 1 ) );
		expect( ticketCalls()[ 0 ] ).toEqual( {
			path: '/fair-audience/v1/event-dates/5/tickets/102',
			method: 'PUT',
			data: { activity_ids: [ 8 ] },
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);

		// Ticket 2 lost the morning workshop; ticket 1 keeps it.
		const morning = ( row ) =>
			row.querySelectorAll( 'td.is-activity' )[ 0 ].textContent;
		expect( morning( ticketRow( 102 ) ) ).toBe( '' );
		expect( morning( ticketRow( 101 ) ) ).toBe( '✓' );
	} );

	it( 'never sends ticket activities when saving the participant', async () => {
		mockApi();
		renderAudience();

		await screen.findByText( 'Jane Doe' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit participant' } )
		);
		const modal = screen.getByRole( 'dialog' );
		expect(
			within( modal ).queryByRole( 'button', { name: 'Save ticket' } )
		).toBeNull();

		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Save participant' } )
		);
		await waitFor( () => {
			const participantPut = apiFetch.mock.calls
				.map( ( [ args ] ) => args )
				.find(
					( args ) =>
						args.method === 'PUT' &&
						args.path.endsWith( '/participants/10' )
				);
			expect( participantPut ).toBeDefined();
			expect( participantPut.data ).not.toHaveProperty(
				'ticket_option_ids'
			);
		} );
		expect( ticketCalls() ).toHaveLength( 0 );
	} );

	it( 'counts activities per ticket and totals participant-level ones separately', async () => {
		mockApi( [ PARTICIPANT, WALK_IN ] );
		renderAudience();

		await screen.findByText( 'Sam Walkin' );
		// Morning: tickets 1 and 2. Evening: ticket 2 only.
		expect( totalsCells( 'Total — tickets' ) ).toEqual( [ '2', '1' ] );
		// The walk-in's evening workshop is not a ticket selection.
		expect( totalsCells( 'Total — not tied to a ticket' ) ).toEqual( [
			'0',
			'1',
		] );
	} );

	it( 'keeps a participant without tickets on a single row with their own check-in', async () => {
		mockApi( [ PARTICIPANT, WALK_IN ] );
		renderAudience();

		await screen.findByText( 'Sam Walkin' );
		const row = document.querySelector( 'tr[data-participant-id="11"]' );
		expect(
			within( row ).getByRole( 'checkbox', { name: 'Shown up' } )
		).toBeInTheDocument();
		expect(
			row.querySelectorAll( 'td.is-activity' )[ 1 ]
		).toHaveTextContent( '✓' );
	} );

	it( 'shows history not tied to a ticket as such', async () => {
		mockApi( WITH_HISTORY );
		renderAudience();

		const history = (
			await screen.findByText( 'Not tied to a ticket' )
		).closest( 'tr' );
		expect( history ).toHaveTextContent( 'Earlier check-in' );
		expect(
			history.querySelectorAll( 'td.is-activity' )[ 1 ]
		).toHaveTextContent( '✓' );
		// The ticket itself holds only its own activity and no check-in.
		expect(
			ticketRow( 101 ).querySelectorAll( 'td.is-activity' )[ 1 ]
		).toHaveTextContent( '' );
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Checked in: Ticket 1 — Regular (AAAA1111)',
			} )
		).not.toBeChecked();
	} );

	it( 'prints one row per ticket, grouped under the participant', async () => {
		const written = [];
		jest.spyOn( window, 'open' ).mockReturnValue( {
			document: {
				open: jest.fn(),
				write: ( html ) => written.push( html ),
				close: jest.fn(),
			},
		} );
		mockApi( [
			{ ...WITH_HISTORY, tickets: [ TICKET_ONE, TICKET_TWO ] },
			WALK_IN,
		] );
		renderAudience();

		await screen.findByText( 'Sam Walkin' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Print list' } ) );

		const doc = new DOMParser().parseFromString(
			written.join( '' ),
			'text/html'
		);
		const groups = doc.querySelectorAll( 'table > tbody' );
		expect( groups ).toHaveLength( 2 );

		const janeRows = groups[ 0 ].querySelectorAll( 'tr' );
		// Two tickets plus the activity not tied to either of them.
		expect( janeRows ).toHaveLength( 3 );
		expect(
			groups[ 0 ].querySelector( 'td.name' ).getAttribute( 'rowspan' )
		).toBe( '3' );
		const ticketCells = Array.from(
			groups[ 0 ].querySelectorAll( 'td.ticket' )
		).map( ( td ) => td.textContent );
		expect( ticketCells ).toEqual( [
			'Ticket 1 (AAAA1111)',
			'Ticket 2 (BBBB2222)',
			'Not tied to a ticket',
		] );
		const activities = Array.from(
			groups[ 0 ].querySelectorAll( 'td.activities' )
		).map( ( td ) => td.textContent );
		expect( activities ).toEqual( [ 'AM', 'AM, PM', 'PM' ] );

		// The participant without tickets keeps one row.
		expect( groups[ 1 ].querySelectorAll( 'tr' ) ).toHaveLength( 1 );
		expect( groups[ 1 ].querySelector( 'td.name' ).textContent ).toBe(
			'Sam Walkin'
		);
		expect( groups[ 1 ].querySelector( 'td.activities' ).textContent ).toBe(
			'PM'
		);
	} );
} );

describe( 'EventAudience — tickets awaiting payment (#1709)', () => {
	it( 'keeps the check-in of a ticket awaiting payment read-only', async () => {
		mockApi( {
			...PARTICIPANT,
			tickets: [
				TICKET_ONE,
				{ ...TICKET_TWO, status: 'pending_payment' },
			],
		} );
		renderAudience();

		await screen.findByText( 'Jane Doe' );
		expect(
			within( ticketRow( 101 ) ).getByRole( 'checkbox' )
		).toBeEnabled();
		const pending = within( ticketRow( 102 ) ).getByRole( 'checkbox' );
		expect( pending ).toBeDisabled();
		expect( pending ).toHaveAttribute(
			'title',
			'Check-in is available once the payment is complete.'
		);
	} );
} );

describe( 'EventAudience — assigning a ticket (#1535)', () => {
	const JANE = {
		participant_id: 10,
		name: 'Jane Doe',
		email: 'jane@example.com',
	};
	const CASEY = {
		participant_id: 20,
		name: 'Casey Companion',
		email: 'casey@example.com',
	};
	const owned = ( ticket, position, assignee = JANE ) => ( {
		...ticket,
		position,
		purchaser: JANE,
		assignee,
	} );
	const PURCHASER = {
		...PARTICIPANT,
		tickets: [ owned( TICKET_ONE, 1 ), owned( TICKET_TWO, 2 ) ],
		assigned_away_ticket_count: 0,
	};
	// The list once ticket two is Casey's.
	const AFTER_ASSIGNMENT = [
		{
			...PURCHASER,
			tickets: [ owned( TICKET_ONE, 1 ) ],
			assigned_away_ticket_count: 1,
		},
		{
			...PARTICIPANT,
			id: 3,
			participant_id: 20,
			participant_name: 'Casey Companion',
			name: 'Casey',
			surname: 'Companion',
			participant_email: 'casey@example.com',
			ticket_type_id: null,
			ticket_type_name: null,
			tickets: [ owned( TICKET_TWO, 2, CASEY ) ],
			assigned_away_ticket_count: 0,
		},
	];
	const DIRECTORY = [
		{
			id: 20,
			name: 'Casey',
			surname: 'Companion',
			email: 'casey@example.com',
		},
		{ id: 10, name: 'Jane', surname: 'Doe', email: 'jane@example.com' },
		{ id: 30, name: 'Alex', surname: 'Other', email: 'alex@example.com' },
	];

	// The audience list follows the assignment: `assign` decides each
	// request's outcome, and a successful one switches the list.
	function mockAssignApi( { audience = [ PURCHASER ], assign } = {} ) {
		let rows = audience;
		apiFetch.mockImplementation( ( { path, method, data } ) => {
			if ( /\/tickets\/\d+\/assign$/.test( path ) && method === 'POST' ) {
				const outcome = assign
					? assign( data )
					: { assignee: CASEY, purchaser: JANE };
				if ( outcome.error ) {
					return Promise.reject( outcome.error );
				}
				rows = AFTER_ASSIGNMENT;
				return Promise.resolve( { ...TICKET_TWO, ...outcome } );
			}
			if ( path === '/fair-audience/v1/participants?per_page=0' ) {
				return Promise.resolve( DIRECTORY );
			}
			if ( path.endsWith( '/participants' ) ) {
				return Promise.resolve( rows );
			}
			if ( path.includes( '/fair-events/v1/event-dates/5/tickets' ) ) {
				return Promise.resolve( {
					options: OPTIONS,
					ticket_types: [],
				} );
			}
			return Promise.resolve( [] );
		} );
	}

	function assignCalls() {
		return apiFetch.mock.calls
			.map( ( [ args ] ) => args )
			.filter( ( args ) => /\/assign$/.test( args.path ) );
	}

	async function openAssignModal( ticketId = 102 ) {
		await screen.findByText( 'Jane Doe' );
		fireEvent.click(
			within( ticketRow( ticketId ) ).getByRole( 'button', {
				name: /^Assign Ticket/,
			} )
		);
		return screen.findByRole( 'dialog' );
	}

	it( 'names the purchaser and the current assignee, and requires a choice', async () => {
		mockAssignApi();
		renderAudience();

		const modal = await openAssignModal();
		expect( modal ).toHaveAccessibleName(
			'Assign ticket — Ticket 2 — Regular (BBBB2222)'
		);
		const people = modal.querySelector(
			'.fair-audience-assign-ticket__people'
		);
		expect( people ).toHaveTextContent(
			'PurchaserJane Doe (jane@example.com)'
		);
		expect( people ).toHaveTextContent(
			'Current assigneeJane Doe (jane@example.com)'
		);

		// The current assignee is not offered; everyone else is.
		await within( modal ).findByRole( 'radio', {
			name: 'Casey Companion (casey@example.com)',
		} );
		expect(
			within( modal ).queryByRole( 'radio', { name: /Jane Doe/ } )
		).not.toBeInTheDocument();

		expect(
			within( modal ).getByRole( 'button', { name: 'Assign ticket' } )
		).toBeDisabled();
		expect( modal ).toHaveTextContent( 'Choose a participant.' );
	} );

	it( 'assigns the ticket to an existing participant and lists it under them', async () => {
		mockAssignApi();
		renderAudience();

		const modal = await openAssignModal();
		fireEvent.change(
			within( modal ).getByLabelText( 'Search by name or email' ),
			{ target: { value: 'casey' } }
		);
		expect(
			within( modal ).queryByRole( 'radio', { name: /Alex Other/ } )
		).not.toBeInTheDocument();
		fireEvent.click(
			await within( modal ).findByRole( 'radio', {
				name: 'Casey Companion (casey@example.com)',
			} )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Assign ticket' } )
		);

		await waitFor( () => expect( assignCalls() ).toHaveLength( 1 ) );
		expect( assignCalls()[ 0 ] ).toEqual( {
			path: '/fair-audience/v1/event-dates/5/tickets/102/assign',
			method: 'POST',
			data: { participant_id: 20 },
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect(
			await screen.findByText( 'Ticket assigned to Casey Companion.' )
		).toBeInTheDocument();

		// The ticket moved to its new holder's rows and still names its
		// purchaser; the purchaser keeps the other one.
		const caseyRow = await waitFor( () => {
			const row = document.querySelector(
				'tr[data-participant-id="20"]'
			);
			expect( row ).not.toBeNull();
			return row;
		} );
		expect( caseyRow.parentElement ).toContainElement( ticketRow( 102 ) );
		expect( ticketRow( 102 ) ).toHaveTextContent(
			'Purchased by Jane Doe (jane@example.com)'
		);
		const janeRow = document.querySelector(
			'tr[data-participant-id="10"]'
		);
		expect( janeRow.parentElement ).toContainElement( ticketRow( 101 ) );
		expect( janeRow.parentElement ).not.toContainElement(
			ticketRow( 102 )
		);
		expect( janeRow ).toHaveTextContent(
			'1 ticket assigned to someone else'
		);
		expect( ticketRow( 101 ) ).not.toHaveTextContent( 'Purchased by' );
	} );

	it( 'creates a new participant in the same step', async () => {
		mockAssignApi( {
			assign: () => ( {
				purchaser: JANE,
				assignee: {
					participant_id: 40,
					name: 'Nico Newcomer',
					email: 'nico@example.com',
				},
			} ),
		} );
		renderAudience();

		const modal = await openAssignModal();
		fireEvent.click(
			within( modal ).getByRole( 'radio', { name: 'A new participant' } )
		);
		const submit = within( modal ).getByRole( 'button', {
			name: 'Assign ticket',
		} );
		expect( submit ).toBeDisabled();
		expect( modal ).toHaveTextContent( 'Enter a name.' );

		fireEvent.change( within( modal ).getByLabelText( 'Name' ), {
			target: { value: ' Nico ' },
		} );
		fireEvent.change( within( modal ).getByLabelText( 'Surname' ), {
			target: { value: 'Newcomer' },
		} );
		fireEvent.change(
			within( modal ).getByLabelText( 'Email (optional)' ),
			{ target: { value: 'nico@example.com' } }
		);
		fireEvent.click( submit );

		await waitFor( () => expect( assignCalls() ).toHaveLength( 1 ) );
		expect( assignCalls()[ 0 ].data ).toEqual( {
			participant: {
				name: 'Nico',
				surname: 'Newcomer',
				email: 'nico@example.com',
			},
		} );
		expect(
			await screen.findByText( 'Ticket assigned to Nico Newcomer.' )
		).toBeInTheDocument();
	} );

	it( 'offers the existing participant when the email is already used', async () => {
		mockAssignApi( {
			assign: ( data ) =>
				data.participant
					? {
							error: {
								code: 'email_exists',
								message:
									'A participant with this email already exists.',
								data: { status: 409, participant: CASEY },
							},
					  }
					: { purchaser: JANE, assignee: CASEY },
		} );
		renderAudience();

		const modal = await openAssignModal();
		fireEvent.click(
			within( modal ).getByRole( 'radio', { name: 'A new participant' } )
		);
		fireEvent.change( within( modal ).getByLabelText( 'Name' ), {
			target: { value: 'Casey' },
		} );
		fireEvent.change(
			within( modal ).getByLabelText( 'Email (optional)' ),
			{ target: { value: 'casey@example.com' } }
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Assign ticket' } )
		);

		// The popup stays open with the conflict and a way out of it.
		expect(
			await within( modal ).findByText(
				'A participant with this email already exists.'
			)
		).toBeInTheDocument();
		fireEvent.click(
			within( modal ).getByRole( 'button', {
				name: 'Select Casey Companion (casey@example.com)',
			} )
		);
		expect(
			within( modal ).getByRole( 'radio', {
				name: 'Casey Companion (casey@example.com)',
			} )
		).toBeChecked();
		expect(
			within( modal ).queryByText(
				'A participant with this email already exists.'
			)
		).not.toBeInTheDocument();

		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Assign ticket' } )
		);
		await waitFor( () => expect( assignCalls() ).toHaveLength( 2 ) );
		expect( assignCalls()[ 1 ].data ).toEqual( { participant_id: 20 } );
	} );

	it( 'explains that a checked-in ticket must have its check-in cleared', async () => {
		mockAssignApi( {
			audience: [
				{
					...PURCHASER,
					tickets: [
						owned( TICKET_ONE, 1 ),
						owned(
							{
								...TICKET_TWO,
								attended_at: '2026-01-01 18:00:00',
							},
							2
						),
					],
				},
			],
		} );
		renderAudience();

		const modal = await openAssignModal();
		expect( modal ).toHaveTextContent(
			'This ticket is checked in. Clear the check-in before assigning the ticket to someone else.'
		);
		fireEvent.click(
			await within( modal ).findByRole( 'radio', {
				name: 'Casey Companion (casey@example.com)',
			} )
		);
		expect(
			within( modal ).getByRole( 'button', { name: 'Assign ticket' } )
		).toBeDisabled();
		expect( assignCalls() ).toHaveLength( 0 );
	} );

	it( 'lists a purchaser holding none of their tickets as the purchaser, not as attending', async () => {
		mockAssignApi( {
			audience: [
				{
					...PURCHASER,
					label: 'interested',
					tickets: [],
					ticket_option_ids: [],
					ticket_option_names: [],
					confirmed_ticket_option_ids: [],
					assigned_away_ticket_count: 2,
				},
				{
					...AFTER_ASSIGNMENT[ 1 ],
					tickets: [
						owned( TICKET_ONE, 1, CASEY ),
						owned( TICKET_TWO, 2, CASEY ),
					],
				},
			],
		} );
		renderAudience();

		await screen.findByText( 'Casey Companion' );
		const janeRow = document.querySelector(
			'tr[data-participant-id="10"]'
		);
		expect( janeRow ).toHaveTextContent( 'Purchaser' );
		expect( janeRow ).toHaveTextContent( '2 tickets assigned to others' );
		expect( janeRow ).not.toHaveTextContent( 'Regular' );
		expect(
			within( janeRow ).queryByRole( 'checkbox' )
		).not.toBeInTheDocument();
	} );
} );

// One purchase of two tickets under one email: Jane keeps the first and
// gave the second to Gil. A third, cancelled ticket stays under Jane.
const JANE = {
	participant_id: 10,
	name: 'Jane Doe',
	email: 'jane@example.com',
};
const GIL = { participant_id: 12, name: 'Gil Guest', email: 'gil@example.com' };

const OWN_TICKET = {
	...TICKET_ONE,
	position: 1,
	event_date_id: 5,
	purchaser: JANE,
	assignee: JANE,
};
const GIVEN_TICKET = {
	...TICKET_TWO,
	signup_id: 40,
	position: 2,
	event_date_id: 5,
	purchaser: JANE,
	assignee: GIL,
};
const CANCELLED_TICKET = {
	...TICKET_ONE,
	id: 103,
	reference: 'CCCC3333',
	position: 3,
	event_date_id: 5,
	status: 'cancelled',
	activity_ids: [],
	activity_names: [],
	confirmed_activity_ids: [],
	purchaser: JANE,
	assignee: JANE,
};

const PURCHASER_ROW = {
	...PARTICIPANT,
	tickets: [ OWN_TICKET ],
	cancelled_tickets: [ CANCELLED_TICKET ],
	assigned_away_ticket_count: 1,
};
const HOLDER_ROW = {
	...PARTICIPANT,
	id: 3,
	participant_id: 12,
	participant_name: 'Gil Guest',
	name: 'Gil',
	surname: 'Guest',
	participant_email: 'gil@example.com',
	ticket_type_id: null,
	ticket_type_name: null,
	tickets: [ GIVEN_TICKET ],
	cancelled_tickets: [],
};

function mockOperationsApi( { cancelError = null } = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( /\/tickets\/\d+\/cancel$/.test( path ) ) {
			return cancelError
				? Promise.reject( cancelError )
				: Promise.resolve( { ...OWN_TICKET, status: 'cancelled' } );
		}
		if ( /\/tickets\/\d+$/.test( path ) && method === 'DELETE' ) {
			return Promise.resolve( { deleted: true, id: 103 } );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( [ PURCHASER_ROW, HOLDER_ROW ] );
		}
		if ( path.includes( '/siblings' ) ) {
			return Promise.resolve( [
				{
					id: 5,
					start_datetime: '2026-01-01 10:00:00',
					occurrence_type: 'master',
				},
			] );
		}
		if ( path.includes( '/fair-events/v1/event-dates/5/tickets' ) ) {
			return Promise.resolve( { options: OPTIONS, ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

function mutations() {
	return apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter( ( args ) => args.method && args.method !== 'GET' );
}

function participantLoads() {
	return apiFetch.mock.calls.filter( ( [ args ] ) =>
		args.path.endsWith( '/participants' )
	).length;
}

describe( 'EventAudience — cancelling and deleting a ticket (#1699)', () => {
	it( 'states that cancelling refunds nothing and cancels only the selected ticket', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		fireEvent.click(
			within( ticketRow( 101 ) ).getByRole( 'button', {
				name: 'Cancel Ticket 1 — Regular (AAAA1111)',
			} )
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Cancel ticket — Ticket 1 — Regular (AAAA1111)',
		} );
		const people = Array.from( dialog.querySelectorAll( 'dd' ) ).map(
			( dd ) => dd.textContent
		);
		expect( people ).toEqual( [
			'Jane Doe (jane@example.com)',
			'Jane Doe (jane@example.com)',
		] );
		expect( dialog ).toHaveTextContent(
			'Cancelling does not refund anything.'
		);
		expect( dialog ).toHaveTextContent( 'Only this ticket is cancelled.' );
		// Nothing is sent until the action is confirmed.
		expect( mutations() ).toHaveLength( 0 );

		const loadsBefore = participantLoads();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel ticket' } )
		);

		await screen.findByText( 'Ticket cancelled. No refund was issued.' );
		expect( mutations() ).toEqual( [
			{
				path: '/fair-audience/v1/event-dates/5/tickets/101/cancel',
				method: 'POST',
			},
		] );
		// The rows and totals are reloaded.
		expect( participantLoads() ).toBe( loadsBefore + 1 );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'sends nothing when the ticket is kept', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		fireEvent.click(
			within( ticketRow( 102 ) ).getByRole( 'button', {
				name: 'Cancel Ticket 2 — Regular (BBBB2222)',
			} )
		);
		// The assignee differs from the purchaser, and both are named.
		const dialog = screen.getByRole( 'dialog' );
		expect(
			Array.from( dialog.querySelectorAll( 'dd' ) ).map(
				( dd ) => dd.textContent
			)
		).toEqual( [
			'Jane Doe (jane@example.com)',
			'Gil Guest (gil@example.com)',
		] );

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Keep ticket' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( mutations() ).toHaveLength( 0 );
	} );

	it( 'keeps the popup open with the reason when cancelling is refused', async () => {
		mockOperationsApi( {
			cancelError: {
				code: 'ticket_inactive',
				message: 'This ticket is no longer active.',
			},
		} );
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		fireEvent.click(
			within( ticketRow( 101 ) ).getByRole( 'button', {
				name: 'Cancel Ticket 1 — Regular (AAAA1111)',
			} )
		);
		const dialog = screen.getByRole( 'dialog' );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel ticket' } )
		);

		expect(
			await within( dialog ).findByText(
				'This ticket is no longer active.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel ticket' } )
		).toBeEnabled();
	} );

	it( 'offers only deletion for a cancelled ticket, and deletes that ticket alone', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		const cancelledRow = ticketRow( 103 );
		expect( cancelledRow ).toHaveTextContent( 'Cancelled' );
		expect( within( cancelledRow ).getAllByRole( 'button' ) ).toHaveLength(
			1
		);
		expect(
			within( cancelledRow ).queryByRole( 'checkbox' )
		).not.toBeInTheDocument();
		// A cancelled ticket is not one of the tickets the participant holds.
		expect( screen.getAllByText( '1 ticket' ) ).toHaveLength( 2 );

		fireEvent.click(
			within( cancelledRow ).getByRole( 'button', {
				name: 'Delete Ticket 3 — Regular (CCCC3333)',
			} )
		);
		const dialog = screen.getByRole( 'dialog', {
			name: 'Delete ticket — Ticket 3 — Regular (CCCC3333)',
		} );
		expect( dialog ).toHaveTextContent(
			'Deleting does not refund anything and does not change the payment.'
		);
		expect( dialog ).toHaveTextContent( 'This cannot be undone.' );

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete ticket' } )
		);

		await screen.findByText( 'Ticket deleted.' );
		expect( mutations() ).toEqual( [
			{
				path: '/fair-audience/v1/event-dates/5/tickets/103',
				method: 'DELETE',
			},
		] );
	} );
} );

describe( 'EventAudience — searching and exporting tickets (#1699)', () => {
	const search = ( text ) =>
		fireEvent.change( screen.getByLabelText( 'Search' ), {
			target: { value: text },
		} );

	const shownTicketIds = () =>
		Array.from( document.querySelectorAll( 'tr[data-ticket-id]' ) ).map(
			( row ) => Number( row.dataset.ticketId )
		);

	it( 'finds a ticket by its reference and shows only that ticket', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );
		expect( shownTicketIds() ).toEqual( [ 102, 101, 103 ] );

		search( 'bbbb2222' );

		expect( shownTicketIds() ).toEqual( [ 102 ] );
		expect( screen.queryByText( 'Jane Doe' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Gil Guest' ) ).toBeInTheDocument();
	} );

	it( 'tells apart tickets bought with one email by their assignee', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		// The purchaser's email finds every ticket of the purchase,
		// each under the participant holding it.
		search( 'jane@example.com' );
		expect( shownTicketIds() ).toEqual( [ 102, 101, 103 ] );

		// The assignee's name or email finds only the ticket they hold.
		search( 'gil@example.com' );
		expect( shownTicketIds() ).toEqual( [ 102 ] );
		search( 'Gil' );
		expect( shownTicketIds() ).toEqual( [ 102 ] );
	} );

	it( 'keeps a participant without tickets findable by name or email', async () => {
		mockApi( [ PARTICIPANT, WALK_IN ] );
		renderAudience();
		await screen.findByText( 'Sam Walkin' );

		search( 'walkin' );

		expect( screen.getByText( 'Sam Walkin' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Jane Doe' ) ).not.toBeInTheDocument();
	} );

	it( 'does not give a participant row a check-in when the search hides their tickets', async () => {
		mockOperationsApi();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		// Matches Jane's cancelled ticket only: her active ticket is hidden.
		search( 'cccc3333' );

		expect( shownTicketIds() ).toEqual( [ 103 ] );
		const participantRow = document.querySelector(
			'tr[data-participant-id="10"]'
		);
		expect(
			within( participantRow ).queryByRole( 'checkbox' )
		).not.toBeInTheDocument();
	} );

	it( 'exports the tickets the search shows, one row per ticket', async () => {
		mockOperationsApi();
		const parts = [];
		const OriginalBlob = global.Blob;
		global.Blob = function ( content ) {
			parts.push( content.join( '' ) );
		};
		URL.createObjectURL = jest.fn( () => 'blob:tickets' );
		URL.revokeObjectURL = jest.fn();
		const click = jest
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => {} );

		try {
			renderAudience();
			await screen.findByText( 'Jane Doe' );

			fireEvent.click(
				screen.getByRole( 'button', { name: 'Export tickets CSV' } )
			);
			search( 'gil' );
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Export tickets CSV' } )
			);
		} finally {
			global.Blob = OriginalBlob;
		}

		expect( click ).toHaveBeenCalledTimes( 2 );
		const [ all, searched ] = parts.map( ( text ) =>
			text.replace( '﻿', '' ).split( '\r\n' )
		);

		// Header, then every listed ticket: two bought with one email are
		// separate rows, told apart by ID, reference and assignee.
		expect( all ).toHaveLength( 4 );
		expect( all[ 0 ] ).toBe(
			'"Ticket ID","Reference","Event date","Ticket type","Status","Activities","Checked in","Purchaser ID","Purchaser name","Purchaser email","Assignee ID","Assignee name","Assignee email"'
		);
		expect( all[ 1 ] ).toBe(
			'"102","BBBB2222","2026-01-01 10:00:00","Regular","Confirmed","Morning workshop; Evening workshop","","10","Jane Doe","jane@example.com","12","Gil Guest","gil@example.com"'
		);
		expect( all[ 2 ] ).toBe(
			'"101","AAAA1111","2026-01-01 10:00:00","Regular","Confirmed","Morning workshop","","10","Jane Doe","jane@example.com","10","Jane Doe","jane@example.com"'
		);
		expect( all[ 3 ] ).toContain( '"103","CCCC3333"' );
		expect( all[ 3 ] ).toContain( '"Cancelled"' );

		// The export follows the search.
		expect( searched ).toHaveLength( 2 );
		expect( searched[ 1 ] ).toContain( '"102","BBBB2222"' );
	} );

	it( 'disables the export when no ticket is shown', async () => {
		mockApi( [ WALK_IN ] );
		renderAudience();
		await screen.findByText( 'Sam Walkin' );

		expect(
			screen.getByRole( 'button', { name: 'Export tickets CSV' } )
		).toBeDisabled();
	} );
} );

describe( 'tickets CSV', () => {
	it( 'quotes fields, doubles quotes and keeps line breaks inside one field', () => {
		expect( escapeCsvField( 'Doe, "JD" Jane' ) ).toBe(
			'"Doe, ""JD"" Jane"'
		);
		expect( escapeCsvField( 'two\nlines' ) ).toBe( '"two\nlines"' );
		expect( escapeCsvField( null ) ).toBe( '""' );
	} );

	it( 'stops a spreadsheet from running a cell as a formula', () => {
		expect( escapeCsvField( '=HYPERLINK("http://x","y")' ) ).toBe(
			'"\'=HYPERLINK(""http://x"",""y"")"'
		);
		expect( escapeCsvField( '+1' ) ).toBe( '"\'+1"' );
		expect( escapeCsvField( '-1' ) ).toBe( '"\'-1"' );
		expect( escapeCsvField( '@cmd' ) ).toBe( '"\'@cmd"' );
		expect( escapeCsvField( '\tcmd' ) ).toBe( '"\'\tcmd"' );

		const csv = buildTicketsCsv( {
			tickets: [
				{
					...OWN_TICKET,
					purchaser: { ...JANE, name: '=SUM(A1:A9)' },
				},
			],
			eventDate: () => '2026-01-01 10:00:00',
			statusLabel: ( status ) => status,
		} );
		expect( csv.split( '\r\n' )[ 1 ] ).toContain( '"\'=SUM(A1:A9)"' );
	} );
} );
