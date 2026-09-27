/**
 * @jest-environment jsdom
 *
 * Component tests for per-ticket activities and check-in (#1533).
 *
 * Exercises:
 *   - A purchaser holding two tickets gets one check-in box per ticket, and
 *     checking one in updates only that ticket.
 *   - The edit modal edits one ticket's activities without touching its
 *     sibling or the participant-level activities.
 *   - A participant-level check-in not tied to a ticket stays visible as such.
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
	activity_ids: [],
	activity_names: [],
	confirmed_activity_ids: [],
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
	ticket_option_names: [ 'Morning workshop' ],
	ticket_option_ids: [ 7 ],
	confirmed_ticket_option_ids: [ 7 ],
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
			return Promise.resolve( [ participant ] );
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

function ticketCalls() {
	return apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter( ( args ) => /\/tickets\/\d+$/.test( args.path ) );
}

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'EventAudience — per-ticket check-in and activities', () => {
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

	it( 'saves one ticket’s activities from the edit modal, leaving its sibling and the participant untouched', async () => {
		mockApi();
		renderAudience();

		fireEvent.click(
			( await screen.findAllByRole( 'button', { name: 'Edit' } ) )[ 0 ]
		);
		const modal = screen.getByRole( 'dialog' );

		const secondEditor = modal.querySelector( '[data-ticket-id="102"]' );
		fireEvent.click(
			within( secondEditor ).getByRole( 'checkbox', {
				name: 'Evening workshop',
			} )
		);
		fireEvent.click(
			within( modal ).getByRole( 'button', {
				name: 'Save Ticket 2 — Regular (BBBB2222)',
			} )
		);

		await waitFor( () => expect( ticketCalls() ).toHaveLength( 1 ) );
		expect( ticketCalls()[ 0 ] ).toEqual( {
			path: '/fair-audience/v1/event-dates/5/tickets/102',
			method: 'PUT',
			data: { activity_ids: [ 8 ], attended: false },
		} );

		// The first ticket keeps its own selection.
		const firstEditor = modal.querySelector( '[data-ticket-id="101"]' );
		expect(
			within( firstEditor ).getByRole( 'checkbox', {
				name: 'Morning workshop',
			} )
		).toBeChecked();
		expect(
			within( firstEditor ).getByRole( 'checkbox', {
				name: 'Evening workshop',
			} )
		).not.toBeChecked();

		// The participant has no activities outside tickets, so saving the
		// participant sends no activity list that could overwrite them.
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
	} );

	it( 'labels a check-in not tied to any ticket as participant-level', async () => {
		mockApi( { ...PARTICIPANT, attended_at: '2025-12-01 18:00:00' } );
		renderAudience();

		expect(
			await screen.findByText( 'Earlier check-in (participant)' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Checked in: Ticket 1 — Regular (AAAA1111)',
			} )
		).not.toBeChecked();
	} );
} );
