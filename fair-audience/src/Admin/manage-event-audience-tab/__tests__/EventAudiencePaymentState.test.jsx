/**
 * @jest-environment jsdom
 *
 * Component tests for unfinished purchases in the Audience tab (#1754).
 *
 * Exercises:
 *   - Someone whose purchase awaits payment is named "Payment in progress",
 *     and "Payment not completed" once the payment failed or its hold
 *     lapsed; never with a registered role.
 *   - They are counted apart and left out of the printed roster.
 *   - Saving other details of such a participant never sends a role; an
 *     administrator can still pick one explicitly.
 *   - A confirmed ticket holder who starts another purchase stays signed up.
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

const future = () =>
	new Date( Date.now() + 10 * 60 * 1000 )
		.toISOString()
		.slice( 0, 19 )
		.replace( 'T', ' ' );
const past = () =>
	new Date( Date.now() - 10 * 60 * 1000 )
		.toISOString()
		.slice( 0, 19 )
		.replace( 'T', ' ' );

/**
 * Ticket as the participants endpoint lists it.
 *
 * @param {number} id     Ticket ID.
 * @param {string} status Ticket status.
 * @return {Object} Ticket
 */
function ticket( id, status ) {
	return {
		id,
		reference: `REF${ id }`,
		signup_id: id,
		ticket_type_id: 3,
		ticket_type_name: 'Regular',
		status,
		attended_at: null,
		activity_ids: [],
		activity_names: [],
		confirmed_activity_ids: [],
	};
}

/**
 * Participant row as the participants endpoint lists it.
 *
 * @param {number} id        Participant ID.
 * @param {string} name      Full name.
 * @param {Object} overrides Fields to override.
 * @return {Object} Participant
 */
function participant( id, name, overrides = {} ) {
	return {
		id,
		participant_id: id,
		event_date_id: 5,
		is_series_pass: false,
		participant_name: name,
		name: name.split( ' ' )[ 0 ],
		surname: name.split( ' ' )[ 1 ],
		participant_email: `p${ id }@example.com`,
		email_profile: 'minimal',
		label: 'signed_up',
		ticket_type_id: 3,
		ticket_type_name: 'Regular',
		attended_at: null,
		created_at: '2026-01-01 10:00:00',
		payment_expires_at: null,
		payment_in_progress: false,
		ticket_option_names: [],
		ticket_option_ids: [],
		confirmed_ticket_option_ids: [],
		participant_ticket_option_ids: [],
		participant_ticket_option_names: [],
		tickets: [],
		cancelled_tickets: [],
		admin_comment: '',
		...overrides,
	};
}

const paying = () =>
	participant( 20, 'Petra Paying', {
		label: 'pending_payment',
		payment_expires_at: future(),
		payment_in_progress: true,
		tickets: [ ticket( 201, 'pending_payment' ) ],
	} );

const failed = () =>
	participant( 21, 'Fred Failed', {
		label: 'pending_payment',
		payment_expires_at: future(),
		payment_in_progress: false,
	} );

const lapsed = () =>
	participant( 22, 'Lena Lapsed', {
		label: 'pending_payment',
		payment_expires_at: past(),
		payment_in_progress: false,
	} );

const registered = () =>
	participant( 23, 'Rita Registered', {
		tickets: [ ticket( 231, 'confirmed' ) ],
	} );

function mockApi( participants ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( method === 'PUT' ) {
			return Promise.resolve( { label: 'signed_up' } );
		}
		if ( path.endsWith( '/participants' ) ) {
			return Promise.resolve( participants );
		}
		if ( path.includes( '/fair-events/v1/event-dates/5/tickets' ) ) {
			// "Edit participant" is offered once the event has activities.
			return Promise.resolve( {
				options: [ { id: 7, name: 'Workshop', short_name: 'WS' } ],
				ticket_types: [],
			} );
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

function participantRow( name ) {
	return screen
		.getAllByText( name )
		.map( ( node ) =>
			node.closest( 'tr.fair-audience-audience-table__participant' )
		)
		.find( Boolean );
}

function roleOf( name ) {
	return participantRow( name ).querySelector( 'td[data-colname="Role"]' )
		.textContent;
}

function participantPuts() {
	return apiFetch.mock.calls
		.map( ( [ args ] ) => args )
		.filter(
			( args ) =>
				args.method === 'PUT' && args.path.includes( '/participants/' )
		);
}

afterEach( () => {
	jest.clearAllMocks();
	jest.restoreAllMocks();
} );

describe( 'EventAudience — unfinished purchases (#1754)', () => {
	it( 'names the payment state instead of a registered role', async () => {
		mockApi( [ paying(), failed(), lapsed(), registered() ] );
		renderAudience();

		await screen.findAllByText( 'Petra Paying' );
		expect( roleOf( 'Petra Paying' ) ).toBe( 'Payment in progress' );
		expect( roleOf( 'Fred Failed' ) ).toBe( 'Payment not completed' );
		expect( roleOf( 'Lena Lapsed' ) ).toBe( 'Payment not completed' );
		expect( roleOf( 'Rita Registered' ) ).toBe( 'Signed up' );
		expect( screen.queryByText( 'pending_payment' ) ).toBeNull();
	} );

	it( 'counts unfinished purchases apart from signed-up participants', async () => {
		mockApi( [ paying(), failed(), registered() ] );
		renderAudience();

		await screen.findAllByText( 'Petra Paying' );
		expect(
			screen.getByText( 'Signed up:' ).closest( 'span' )
		).toHaveTextContent( 'Signed up: 1' );
		expect(
			screen.getByText( 'Unfinished purchases:' ).closest( 'span' )
		).toHaveTextContent( 'Unfinished purchases: 2' );
	} );

	it( 'shows no unfinished-purchase count when there is none', async () => {
		mockApi( [ registered() ] );
		renderAudience();

		await screen.findAllByText( 'Rita Registered' );
		expect( screen.queryByText( 'Unfinished purchases:' ) ).toBeNull();
	} );

	it( 'leaves unfinished purchases out of the printed roster', async () => {
		const written = [];
		jest.spyOn( window, 'open' ).mockReturnValue( {
			document: {
				open: jest.fn(),
				write: ( html ) => written.push( html ),
				close: jest.fn(),
			},
		} );
		mockApi( [ paying(), failed(), registered() ] );
		renderAudience();

		await screen.findAllByText( 'Petra Paying' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Print list' } ) );

		const printed = written.join( '' );
		expect( printed ).toContain( 'Rita Registered' );
		expect( printed ).not.toContain( 'Petra Paying' );
		expect( printed ).not.toContain( 'Fred Failed' );
	} );

	it( 'saves other details of a paying participant without sending a role', async () => {
		mockApi( [ paying() ] );
		renderAudience();

		await screen.findAllByText( 'Petra Paying' );
		fireEvent.click(
			within( participantRow( 'Petra Paying' ) ).getByRole( 'button', {
				name: 'Edit participant',
			} )
		);
		const modal = screen.getByRole( 'dialog' );
		expect( within( modal ).getByLabelText( 'Role' ) ).toHaveValue(
			'pending_payment'
		);
		expect(
			within( modal ).getByRole( 'option', {
				name: 'Payment in progress',
			} )
		).toBeInTheDocument();

		fireEvent.click(
			within( modal ).getByRole( 'button', {
				name: /^Save( participant)?$/,
			} )
		);

		await waitFor( () => expect( participantPuts() ).toHaveLength( 1 ) );
		expect( participantPuts()[ 0 ].data ).not.toHaveProperty( 'label' );
		await waitFor( () =>
			expect( roleOf( 'Petra Paying' ) ).toBe( 'Payment in progress' )
		);
	} );

	it( 'saves a lapsed hold without confirming it unless the administrator decides', async () => {
		mockApi( [ lapsed() ] );
		renderAudience();

		await screen.findAllByText( 'Lena Lapsed' );
		fireEvent.click(
			within( participantRow( 'Lena Lapsed' ) ).getByRole( 'button', {
				name: 'Edit participant',
			} )
		);
		const modal = screen.getByRole( 'dialog' );
		fireEvent.click(
			within( modal ).getByRole( 'button', {
				name: /^Save( participant)?$/,
			} )
		);

		await waitFor( () => expect( participantPuts() ).toHaveLength( 1 ) );
		expect( participantPuts()[ 0 ].data ).not.toHaveProperty( 'label' );
	} );

	it( 'lets the administrator confirm a paying participant explicitly', async () => {
		mockApi( [ paying() ] );
		renderAudience();

		await screen.findAllByText( 'Petra Paying' );
		fireEvent.click(
			within( participantRow( 'Petra Paying' ) ).getByRole( 'button', {
				name: 'Edit participant',
			} )
		);
		const modal = screen.getByRole( 'dialog' );
		fireEvent.change( within( modal ).getByLabelText( 'Role' ), {
			target: { value: 'signed_up' },
		} );
		fireEvent.click(
			within( modal ).getByRole( 'button', {
				name: /^Save( participant)?$/,
			} )
		);

		await waitFor( () => expect( participantPuts() ).toHaveLength( 1 ) );
		expect( participantPuts()[ 0 ].data.label ).toBe( 'signed_up' );
		await waitFor( () =>
			expect( roleOf( 'Petra Paying' ) ).toBe( 'Signed up' )
		);
	} );

	it( 'keeps a confirmed ticket holder signed up while another purchase is unpaid', async () => {
		mockApi( [
			participant( 24, 'Dora Double', {
				tickets: [
					ticket( 241, 'confirmed' ),
					ticket( 242, 'pending_payment' ),
				],
			} ),
		] );
		renderAudience();

		await screen.findAllByText( 'Dora Double' );
		expect( roleOf( 'Dora Double' ) ).toBe( 'Signed up' );
		expect( screen.getByText( 'Awaiting payment' ) ).toBeInTheDocument();
	} );
} );
