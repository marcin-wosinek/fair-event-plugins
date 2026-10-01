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
