/**
 * @jest-environment jsdom
 *
 * Component tests for the per-member payment reminder on Fee Detail (#1770):
 * the row action is offered for pending payments only, the dialog names the
 * member, the recipient and the fee, cancelling sends nothing, one
 * confirmation sends one request however often the button is clicked, and
 * each outcome (sent, mail failure, stale payment, failed refresh, send
 * that could not be recorded) gets its own feedback.
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import FeeDetail from '../FeeDetail.js';

jest.mock( '@wordpress/api-fetch' );

const FEE_PATH = '/fair-audience/v1/fees/7';
const PAYMENTS_PATH = `${ FEE_PATH }/payments`;
const REMINDER_PATH = `${ PAYMENTS_PATH }/31/send-reminder`;
const BULK_PATH = `${ FEE_PATH }/send-reminders`;
const SENT_AT = '2026-10-08 09:30:00';

const FEE = {
	id: 7,
	name: 'Membership 2026',
	group_id: 3,
	group_name: 'Members',
	amount: '25.00',
	currency: 'EUR',
	due_date: '2026-12-31',
	status: 'active',
};

const payment = ( overrides ) => ( {
	id: 31,
	fee_id: 7,
	participant_id: 101,
	participant_name: 'Ada',
	participant_surname: 'Example',
	participant_email: 'ada@example.test',
	amount: '25.00',
	status: 'pending',
	paid_at: null,
	reminder_sent_at: null,
	transaction_id: null,
	...overrides,
} );

const PENDING = payment();
const PAID = payment( {
	id: 32,
	participant_id: 102,
	participant_name: 'Ben',
	participant_surname: 'Sample',
	participant_email: 'ben@example.test',
	status: 'paid',
	paid_at: '2026-10-01 10:00:00',
} );
const NO_EMAIL = payment( {
	id: 33,
	participant_id: 103,
	participant_name: 'Cleo',
	participant_surname: 'Placeholder',
	participant_email: null,
} );

const SENT = {
	sent: true,
	recorded: true,
	email: 'ada@example.test',
	reminder_sent_at: SENT_AT,
	message: 'Payment reminder sent.',
};

const restError = ( code, message ) =>
	Object.assign( new Error( message ), { code, message } );

/** A promise the test settles by hand, to hold a request in flight. */
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
}

/**
 * Route apiFetch by path. `payments` is read on every call, so a test can
 * swap what the next reload returns; `routes` overrides single paths.
 */
function mockApi( { payments = [ PENDING, PAID ], routes = {} } = {} ) {
	const state = { payments, routes };
	apiFetch.mockImplementation( ( { path } ) => {
		if ( state.routes[ path ] ) {
			return state.routes[ path ]();
		}
		if ( path === FEE_PATH ) {
			return Promise.resolve( FEE );
		}
		if ( path === PAYMENTS_PATH ) {
			return Promise.resolve( state.payments );
		}
		return Promise.resolve( [] );
	} );
	return state;
}

const callsTo = ( path ) =>
	apiFetch.mock.calls.filter( ( [ options ] ) => options.path === path );

const rowOf = async ( name ) =>
	( await screen.findByText( name ) ).closest( 'tr' );

async function openRowMenu( name ) {
	fireEvent.click(
		within( await rowOf( name ) ).getByRole( 'button', {
			name: 'Actions',
		} )
	);
}

/** Open the reminder dialog for a row and return it. */
async function openReminderDialog( name = 'Ada Example' ) {
	await openRowMenu( name );
	fireEvent.click(
		await screen.findByRole( 'menuitem', {
			name: 'Send Payment Reminder',
		} )
	);
	return screen.findByRole( 'dialog', { name: 'Send Payment Reminder' } );
}

/**
 * A page notice by its text. Notices are also announced through a live
 * region, so the visible one is matched by its container.
 */
const findNotice = ( text ) =>
	screen.findByText( text, { selector: '.components-notice__content' } );

const sendButton = ( dialog ) =>
	within( dialog ).getByRole( 'button', { name: 'Send Payment Reminder' } );

beforeEach( () => {
	// jsdom has no CSS.supports, which the row menu's popover calls.
	window.CSS = { ...window.CSS, supports: jest.fn( () => false ) };
	window.history.pushState(
		{},
		'',
		'?page=fair-audience-fee-detail&fee_id=7'
	);
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'FeeDetail — which payments can be reminded', () => {
	it( 'offers the action for a pending payment and not for a paid one', async () => {
		mockApi();
		render( <FeeDetail /> );

		await openRowMenu( 'Ada Example' );
		expect(
			await screen.findByRole( 'menuitem', {
				name: 'Send Payment Reminder',
			} )
		).toBeInTheDocument();
		fireEvent.keyDown( document.activeElement, { key: 'Escape' } );

		await openRowMenu( 'Ben Sample' );
		await screen.findByRole( 'menuitem', { name: 'View Audit Log' } );
		expect(
			screen.queryByRole( 'menuitem', {
				name: 'Send Payment Reminder',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'explains why a member without an email address cannot be reminded', async () => {
		mockApi( { payments: [ NO_EMAIL ] } );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog( 'Cleo Placeholder' );
		expect(
			within( dialog ).getByText(
				'This member has no email address, so a reminder cannot be sent.'
			)
		).toBeInTheDocument();
		expect( sendButton( dialog ) ).toBeDisabled();

		fireEvent.click( sendButton( dialog ) );
		expect( callsTo( `${ PAYMENTS_PATH }/33/send-reminder` ) ).toHaveLength(
			0
		);
	} );
} );

describe( 'FeeDetail — confirming a reminder', () => {
	it( 'names the member, the recipient and the fee before anything is sent', async () => {
		mockApi();
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		expect( dialog ).toHaveTextContent( 'Member: Ada Example' );
		expect( dialog ).toHaveTextContent( 'Email: ada@example.test' );
		expect( dialog ).toHaveTextContent( 'Fee: Membership 2026' );
		expect( dialog ).toHaveTextContent( 'Amount: 25.00 EUR' );
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 0 );
	} );

	it( 'sends nothing when cancelled', async () => {
		mockApi();
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 0 );
	} );

	it( 'sends one reminder, reports it, and shows the new reminder date', async () => {
		const api = mockApi( {
			routes: { [ REMINDER_PATH ]: () => Promise.resolve( SENT ) },
		} );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		api.payments = [ payment( { reminder_sent_at: SENT_AT } ), PAID ];
		fireEvent.click( sendButton( dialog ) );

		expect(
			await findNotice( 'Payment reminder sent to ada@example.test.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			within( await rowOf( 'Ada Example' ) ).getByText( SENT_AT )
		).toBeInTheDocument();

		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 1 );
		expect( callsTo( REMINDER_PATH )[ 0 ][ 0 ].method ).toBe( 'POST' );
		// Loaded on mount, then again after the send.
		expect( callsTo( PAYMENTS_PATH ) ).toHaveLength( 2 );
		expect( callsTo( FEE_PATH ) ).toHaveLength( 2 );
	} );

	it( 'loads the audit log afresh when it is opened after a send', async () => {
		mockApi( {
			routes: {
				[ REMINDER_PATH ]: () => Promise.resolve( SENT ),
				[ `${ PAYMENTS_PATH }/31/audit-log` ]: () =>
					Promise.resolve( [
						{
							id: 1,
							action: 'reminder_sent',
							created_at: SENT_AT,
							performed_by_name: 'admin',
						},
					] ),
			},
		} );
		render( <FeeDetail /> );

		fireEvent.click( sendButton( await openReminderDialog() ) );
		await findNotice( 'Payment reminder sent to ada@example.test.' );

		await openRowMenu( 'Ada Example' );
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: 'View Audit Log' } )
		);

		const log = await screen.findByRole( 'dialog', { name: 'Audit Log' } );
		expect(
			await within( log ).findByText( 'reminder sent' )
		).toBeInTheDocument();
	} );

	it( 'sends a single request when the button is clicked repeatedly', async () => {
		const pending = deferred();
		mockApi( { routes: { [ REMINDER_PATH ]: () => pending.promise } } );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		const button = sendButton( dialog );
		fireEvent.click( button );
		fireEvent.click( button );
		fireEvent.click( button );

		await waitFor( () => expect( button ).toBeDisabled() );
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 1 );
		// Neither the dialog nor the bulk send can be used meanwhile.
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', {
				name: 'Send Reminders',
				hidden: true,
			} )
		).toBeDisabled();

		await act( async () => {
			pending.resolve( SENT );
		} );
		await findNotice( 'Payment reminder sent to ada@example.test.' );
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 1 );
	} );
} );

describe( 'FeeDetail — reminders that do not go through', () => {
	it( 'keeps the dialog open with the reason when the email fails', async () => {
		mockApi( {
			routes: {
				[ REMINDER_PATH ]: () =>
					Promise.reject(
						restError(
							'reminder_send_failed',
							'The reminder email could not be sent.'
						)
					),
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		fireEvent.click( sendButton( dialog ) );

		expect(
			await within( dialog ).findByText(
				'The reminder email could not be sent.'
			)
		).toBeInTheDocument();
		expect( sendButton( dialog ) ).toBeEnabled();
		expect(
			screen.queryByText( /Payment reminder sent to/ )
		).not.toBeInTheDocument();
		// Nothing changed, so nothing is reloaded.
		expect( callsTo( PAYMENTS_PATH ) ).toHaveLength( 1 );
	} );

	it( 'reports a permission failure without claiming a send', async () => {
		mockApi( {
			routes: {
				[ REMINDER_PATH ]: () =>
					Promise.reject(
						restError(
							'rest_forbidden',
							'Sorry, you are not allowed to do that.'
						)
					),
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		fireEvent.click( sendButton( dialog ) );

		expect(
			await within( dialog ).findByText(
				'Sorry, you are not allowed to do that.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText( /Payment reminder sent to/ )
		).not.toBeInTheDocument();
	} );

	it( 'closes the dialog and reloads the row when the payment is no longer pending', async () => {
		const api = mockApi( {
			routes: {
				[ REMINDER_PATH ]: () =>
					Promise.reject(
						restError(
							'payment_not_pending',
							'This payment is no longer pending, so no reminder was sent.'
						)
					),
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openReminderDialog();
		api.payments = [ payment( { status: 'paid' } ), PAID ];
		fireEvent.click( sendButton( dialog ) );

		expect(
			await findNotice(
				'This payment is no longer pending, so no reminder was sent.'
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect( callsTo( PAYMENTS_PATH ) ).toHaveLength( 2 )
		);

		// The refreshed row no longer offers the action.
		await waitFor( async () =>
			expect(
				within( await rowOf( 'Ada Example' ) ).getByText( 'paid' )
			).toBeInTheDocument()
		);
		await openRowMenu( 'Ada Example' );
		await screen.findByRole( 'menuitem', { name: 'View Audit Log' } );
		expect(
			screen.queryByRole( 'menuitem', {
				name: 'Send Payment Reminder',
			} )
		).not.toBeInTheDocument();
	} );

	it( 'says the email went out when only the page refresh fails', async () => {
		let paymentLoads = 0;
		mockApi( {
			routes: {
				[ REMINDER_PATH ]: () => Promise.resolve( SENT ),
				[ PAYMENTS_PATH ]: () => {
					paymentLoads += 1;
					return paymentLoads === 1
						? Promise.resolve( [ PENDING, PAID ] )
						: Promise.reject( new Error( 'Network error' ) );
				},
			},
		} );
		render( <FeeDetail /> );

		fireEvent.click( sendButton( await openReminderDialog() ) );

		expect(
			await findNotice(
				/Payment reminder sent to ada@example\.test, but this page could not be refreshed\..*does not need to be sent again\./
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'warns against resending when the send could not be recorded', async () => {
		const message =
			'The reminder was sent, but it could not be recorded on the payment. Do not send it again.';
		mockApi( {
			routes: {
				[ REMINDER_PATH ]: () =>
					Promise.resolve( {
						...SENT,
						recorded: false,
						reminder_sent_at: null,
						message,
					} ),
			},
		} );
		render( <FeeDetail /> );

		fireEvent.click( sendButton( await openReminderDialog() ) );

		expect( await findNotice( message ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'Payment reminder sent to ada@example.test.' )
		).not.toBeInTheDocument();
	} );
} );

describe( 'FeeDetail — individual and bulk sends do not overlap', () => {
	it( 'holds a single reminder back while reminders go out to everyone', async () => {
		const bulk = deferred();
		mockApi( { routes: { [ BULK_PATH ]: () => bulk.promise } } );
		jest.spyOn( window, 'confirm' ).mockReturnValue( true );
		render( <FeeDetail /> );

		await rowOf( 'Ada Example' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Send Reminders' } )
		);

		const dialog = await openReminderDialog();
		expect(
			within( dialog ).getByText(
				/Reminders are being sent to all members with pending payments\./
			)
		).toBeInTheDocument();
		expect( sendButton( dialog ) ).toBeDisabled();
		fireEvent.click( sendButton( dialog ) );
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 0 );

		await act( async () => {
			bulk.resolve( { sent: [ 'ada@example.test' ], failed: [] } );
		} );
		await waitFor( () => expect( sendButton( dialog ) ).toBeEnabled() );
	} );
} );
