/**
 * @jest-environment jsdom
 *
 * Component tests for the "Move signup to another occurrence" action (#954)
 * and the rest of the participant row actions (#1710).
 *
 * Exercises:
 *   - Rows offer Edit participant and Move but no Delete (#1710); deleting a
 *     registration lives on the List tab.
 *   - Move button is hidden when there is only one occurrence.
 *   - Move button appears for non-series-pass rows when siblings exist.
 *   - Opening the modal lists the other occurrences (current one excluded).
 *   - Confirming calls the move endpoint and refreshes the participant list.
 *   - "Move ticket" moves one ticket to another date, names its purchaser
 *     and assignee, is not offered for a whole-series pass or without other
 *     dates, and asks for a reason before going over capacity (#1699).
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

const PARTICIPANT = {
	id: 1,
	participant_id: 10,
	event_date_id: 5,
	is_series_pass: false,
	participant_name: 'Jane Doe',
	name: 'Jane',
	surname: 'Doe',
	participant_email: 'jane@example.com',
	email_profile: 'marketing',
	label: 'signed_up',
	ticket_type_id: null,
	ticket_type_name: null,
	attended_at: null,
	created_at: '2026-01-01 10:00:00',
	payment_expires_at: null,
	ticket_option_names: [],
	ticket_option_ids: [],
	admin_comment: '',
};

const SIBLINGS = [
	{ id: 5, start_datetime: '2026-01-01 10:00:00', occurrence_type: 'master' },
	{
		id: 6,
		start_datetime: '2026-01-08 10:00:00',
		occurrence_type: 'generated',
	},
	{
		id: 7,
		start_datetime: '2026-01-15 10:00:00',
		occurrence_type: 'generated',
	},
];

function mockApiFetchFor( { siblings, ticketOptions = [] } ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path.includes( '/participants/10/move' ) ) {
			return Promise.resolve( {
				message: 'moved',
				target_event_date_id: 6,
			} );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( [ PARTICIPANT ] );
		}
		if ( path.includes( '/siblings' ) ) {
			return Promise.resolve( siblings );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( {
				options: ticketOptions,
				ticket_types: [],
			} );
		}
		if ( path.includes( 'forms-summary' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.includes( 'group-permission-rules' ) ) {
			return Promise.resolve( [] );
		}
		if ( path.includes( '/groups' ) ) {
			return Promise.resolve( [] );
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

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — Move action', () => {
	it( 'hides the Move button when there is only one occurrence', async () => {
		mockApiFetchFor( { siblings: [ SIBLINGS[ 0 ] ] } );
		renderAudience();

		expect( await screen.findByText( 'Jane Doe' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Move' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the Move button and lists sibling occurrences in the modal', async () => {
		mockApiFetchFor( { siblings: SIBLINGS } );
		renderAudience();

		const moveButton = await screen.findByRole( 'button', {
			name: 'Move',
		} );
		fireEvent.click( moveButton );

		const modal = screen.getByRole( 'dialog' );
		const select = within( modal ).getByRole( 'combobox' );
		const options = within( select ).getAllByRole( 'option' );

		// Current occurrence (id 5) is excluded; the other two are listed.
		expect( options ).toHaveLength( 2 );
	} );

	it( 'confirming the move calls the move endpoint with the selected target', async () => {
		mockApiFetchFor( { siblings: SIBLINGS } );
		renderAudience();

		const moveButton = await screen.findByRole( 'button', {
			name: 'Move',
		} );
		fireEvent.click( moveButton );

		const modal = screen.getByRole( 'dialog' );
		fireEvent.click(
			within( modal ).getByRole( 'button', { name: 'Move' } )
		);

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-audience/v1/event-dates/5/participants/10/move',
				method: 'POST',
				data: { target_event_date_id: 6 },
			} )
		);
	} );
} );

describe( 'EventAudience — participant row actions (#1710)', () => {
	it( 'offers Edit participant and Move but no Delete', async () => {
		mockApiFetchFor( {
			siblings: SIBLINGS,
			ticketOptions: [ { id: 3, name: 'Pottery' } ],
		} );
		renderAudience();

		expect(
			await screen.findByRole( 'button', { name: 'Move' } )
		).toBeInTheDocument();
		expect(
			await screen.findByRole( 'button', { name: 'Edit participant' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Delete' } )
		).not.toBeInTheDocument();
	} );

	it( 'never calls the participant DELETE endpoint from the row', async () => {
		mockApiFetchFor( { siblings: SIBLINGS } );
		renderAudience();

		await screen.findByRole( 'button', { name: 'Move' } );
		expect(
			screen.queryByRole( 'button', { name: /delete/i } )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( { method: 'DELETE' } )
		);
	} );
} );

const BUYER = {
	participant_id: 10,
	name: 'Jane Doe',
	email: 'jane@example.com',
};
const GUEST = {
	participant_id: 12,
	name: 'Gil Guest',
	email: 'gil@example.com',
};

const MOVABLE_TICKET = {
	id: 101,
	position: 1,
	reference: 'AAAA1111',
	signup_id: 40,
	event_date_id: 5,
	whole_series: false,
	ticket_type_id: 3,
	ticket_type_name: 'Regular',
	status: 'confirmed',
	attended_at: '2026-01-01 18:00:00',
	activity_ids: [],
	activity_names: [],
	confirmed_activity_ids: [],
	purchaser: BUYER,
	assignee: GUEST,
};
const SIBLING_TICKET = {
	...MOVABLE_TICKET,
	id: 102,
	position: 2,
	reference: 'BBBB2222',
	attended_at: null,
	assignee: BUYER,
};
const SERIES_PASS = {
	...MOVABLE_TICKET,
	id: 103,
	position: 1,
	reference: 'CCCC3333',
	whole_series: true,
	ticket_type_name: 'Season pass',
	attended_at: null,
	assignee: BUYER,
};

function mockTicketMove( { siblings = SIBLINGS, refusal = null } = {} ) {
	let refused = false;
	apiFetch.mockImplementation( ( { path, data } ) => {
		if ( /\/tickets\/\d+\/move$/.test( path ) ) {
			if ( refusal && ! refused && ! data.override_reason ) {
				refused = true;
				return Promise.reject( refusal );
			}
			return Promise.resolve( { ...MOVABLE_TICKET, event_date_id: 7 } );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( [
				{
					...PARTICIPANT,
					tickets: [ MOVABLE_TICKET, SIBLING_TICKET, SERIES_PASS ],
					cancelled_tickets: [],
				},
			] );
		}
		if ( path.includes( '/siblings' ) ) {
			return Promise.resolve( siblings );
		}
		if ( path.includes( '/tickets' ) ) {
			return Promise.resolve( { options: [], ticket_types: [] } );
		}
		return Promise.resolve( [] );
	} );
}

const ticketRowOf = ( id ) =>
	document.querySelector( `tr[data-ticket-id="${ id }"]` );

const moveCalls = () =>
	apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter( ( args ) => /\/tickets\/\d+\/move$/.test( args.path ) );

describe( 'EventAudience — moving one ticket (#1699)', () => {
	it( 'offers no ticket move without another date, or for a whole-series pass', async () => {
		mockTicketMove( { siblings: [ SIBLINGS[ 0 ] ] } );
		renderAudience();
		await screen.findByText( 'Jane Doe' );
		expect(
			screen.queryByRole( 'button', { name: /^Move Ticket/ } )
		).not.toBeInTheDocument();

		jest.clearAllMocks();
		document.body.innerHTML = '';
		mockTicketMove();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		expect(
			within( ticketRowOf( 101 ) ).getByRole( 'button', {
				name: 'Move Ticket 1 — Regular (AAAA1111)',
			} )
		).toBeInTheDocument();
		expect(
			within( ticketRowOf( 103 ) ).queryByRole( 'button', {
				name: /^Move Ticket/,
			} )
		).not.toBeInTheDocument();
	} );

	it( 'moves only the selected ticket to the chosen date', async () => {
		mockTicketMove();
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		fireEvent.click(
			within( ticketRowOf( 101 ) ).getByRole( 'button', {
				name: 'Move Ticket 1 — Regular (AAAA1111)',
			} )
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Move ticket — Ticket 1 — Regular (AAAA1111)',
		} );
		expect(
			Array.from( dialog.querySelectorAll( 'dd' ) ).map(
				( dd ) => dd.textContent
			)
		).toEqual( [
			'Jane Doe (jane@example.com)',
			'Gil Guest (gil@example.com)',
		] );
		expect( dialog ).toHaveTextContent( 'Only this ticket moves.' );
		expect( dialog ).toHaveTextContent( 'nothing is charged or refunded' );

		// The other dates only, never the current one.
		const select = within( dialog ).getByLabelText( 'Move to date' );
		const optionValues = Array.from( select.options ).map(
			( o ) => o.value
		);
		expect( optionValues ).toEqual( [ '6', '7' ] );

		fireEvent.change( select, { target: { value: '7' } } );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Move ticket' } )
		);

		await screen.findByText( /^Ticket moved to / );
		expect( moveCalls() ).toEqual( [
			{
				path: '/fair-audience/v1/event-dates/5/tickets/101/move',
				method: 'POST',
				data: { target_event_date_id: 7 },
			},
		] );
		expect(
			apiFetch.mock.calls.filter( ( [ args ] ) =>
				args.path.endsWith( '/participants' )
			)
		).toHaveLength( 2 );
	} );

	it( 'asks for a reason before moving over capacity', async () => {
		mockTicketMove( {
			refusal: {
				code: 'capacity_exceeded',
				message:
					'January 8, 2026 10:00 would have 3 of 2 places taken.',
				data: {
					status: 409,
					projections: [ { after: 3, capacity: 2 } ],
				},
			},
		} );
		renderAudience();
		await screen.findByText( 'Jane Doe' );

		fireEvent.click(
			within( ticketRowOf( 101 ) ).getByRole( 'button', {
				name: 'Move Ticket 1 — Regular (AAAA1111)',
			} )
		);
		const dialog = screen.getByRole( 'dialog' );
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Move ticket' } )
		);

		expect(
			await within( dialog ).findByText(
				'January 8, 2026 10:00 would have 3 of 2 places taken.'
			)
		).toBeInTheDocument();

		// The move stays blocked until a reason is entered.
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Move over capacity',
		} );
		expect( confirm ).toBeDisabled();
		expect( dialog ).toHaveTextContent(
			'Enter a reason to move over capacity.'
		);

		fireEvent.change(
			within( dialog ).getByLabelText( 'Reason for going over capacity' ),
			{ target: { value: 'Organizer approved an extra place' } }
		);
		await waitFor( () => expect( confirm ).toBeEnabled() );
		fireEvent.click( confirm );

		await screen.findByText( /^Ticket moved to / );
		expect( moveCalls().map( ( call ) => call.data ) ).toEqual( [
			{ target_event_date_id: 6 },
			{
				target_event_date_id: 6,
				override_reason: 'Organizer approved an extra place',
			},
		] );
	} );
} );
