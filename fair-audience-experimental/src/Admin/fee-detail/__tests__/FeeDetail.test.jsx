/**
 * @jest-environment jsdom
 *
 * Component tests for the per-member payment reminder on Fee Detail (#1770):
 * the row action is offered for pending payments only, the dialog names the
 * member, the recipient and the fee, cancelling sends nothing, one
 * confirmation sends one request however often the button is clicked, and
 * each outcome (sent, mail failure, stale payment, failed refresh, send
 * that could not be recorded) gets its own feedback.
 *
 * Also covers the budgets offered by the transfer dialog (#1802): they come
 * from Fair Finance when the dialog opens, and a load that is running, empty
 * or failed each looks different.
 *
 * And submitting that dialog (#1802): the transfer goes to Fair Finance, an
 * empty description is left out, a failed transfer keeps the dialog open
 * with the reason, and a transfer that was created but could not be followed
 * by marking the payment paid is reported as such and never sent twice.
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
const BUDGETS_PATH = '/fair-finance/v1/budgets';
const STALE_BUDGETS_PATH = '/fair-payments-connector/v1/budgets';
const TRANSFER_PATH = '/fair-finance/v1/financial-entries/transfer';
const STALE_TRANSFER_PATH =
	'/fair-payments-connector/v1/financial-entries/transfer';
const MARK_PAID_PATH = `${ PAYMENTS_PATH }/31/mark-paid`;
const BUDGETS = [
	{ id: 11, name: 'Membership income' },
	{ id: 12, name: 'Bank account' },
];

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

/** Open the transfer dialog for a row and return it. */
async function openTransferDialog( name = 'Ada Example' ) {
	await openRowMenu( name );
	fireEvent.click(
		await screen.findByRole( 'menuitem', { name: 'Create Transfer' } )
	);
	return screen.findByRole( 'dialog', { name: 'Create Transfer' } );
}

const budgetSelects = ( dialog ) => [
	within( dialog ).getByRole( 'combobox', { name: 'From Budget (Source)' } ),
	within( dialog ).getByRole( 'combobox', { name: 'To Budget (Target)' } ),
];

const optionLabels = ( select ) =>
	within( select )
		.getAllByRole( 'option' )
		.map( ( option ) => option.textContent );

const sendButton = ( dialog ) =>
	within( dialog ).getByRole( 'button', { name: 'Send Payment Reminder' } );

/**
 * Every failed budgets load is logged by useBudgets; jest-console fails any
 * test that logs an error it does not assert.
 */
function expectBudgetsLoadErrorLogged() {
	expect( console ).toHaveErrored();
	expect( console.error ).toHaveBeenCalledWith(
		'Error loading budgets:',
		expect.anything()
	);
}

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
		render( <FeeDetail /> );

		await rowOf( 'Ada Example' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Send Reminders' } )
		);
		const bulkDialog = screen.getByRole( 'dialog', {
			name: 'Send payment reminders — Membership 2026',
		} );
		fireEvent.click(
			within( bulkDialog ).getByRole( 'button', {
				name: 'Send reminders',
			} )
		);

		// The pending bulk dialog cannot be dismissed and hides the row
		// actions, so no single reminder can start alongside it.
		fireEvent.keyDown( bulkDialog, { key: 'Escape', code: 'Escape' } );
		expect( bulkDialog ).toBeInTheDocument();
		expect(
			within( await rowOf( 'Ada Example' ) ).queryByRole( 'button', {
				name: 'Actions',
			} )
		).not.toBeInTheDocument();
		expect( callsTo( REMINDER_PATH ) ).toHaveLength( 0 );

		await act( async () => {
			bulk.resolve( { sent: [ 'ada@example.test' ], failed: [] } );
		} );

		const dialog = await openReminderDialog();
		expect( sendButton( dialog ) ).toBeEnabled();
	} );
} );

describe( 'FeeDetail — budgets in the transfer dialog', () => {
	const EMPTY_MESSAGE =
		'There are no budgets yet. Add budgets in Fair Finance to create a transfer.';
	const FAILURE_MESSAGE = 'Budgets could not be loaded.';

	it( 'asks Fair Finance for budgets when the dialog opens and lists them by name', async () => {
		mockApi( {
			routes: { [ BUDGETS_PATH ]: () => Promise.resolve( BUDGETS ) },
		} );
		render( <FeeDetail /> );

		await rowOf( 'Ada Example' );
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 0 );

		const dialog = await openTransferDialog();
		await within( dialog ).findAllByRole( 'option', {
			name: 'Bank account',
		} );
		for ( const select of budgetSelects( dialog ) ) {
			expect( optionLabels( select ) ).toEqual( [
				'-- Select Budget --',
				'Membership income',
				'Bank account',
			] );
		}
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 1 );
		expect( callsTo( STALE_BUDGETS_PATH ) ).toHaveLength( 0 );
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
	} );

	it( 'shows that budgets are loading and holds the selects until they arrive', async () => {
		const pending = deferred();
		mockApi( { routes: { [ BUDGETS_PATH ]: () => pending.promise } } );
		render( <FeeDetail /> );

		const dialog = await openTransferDialog();
		expect(
			within( dialog ).getByText( 'Loading budgets…' )
		).toBeInTheDocument();
		for ( const select of budgetSelects( dialog ) ) {
			expect( select ).toBeDisabled();
		}

		await act( async () => {
			pending.resolve( BUDGETS );
		} );

		expect(
			within( dialog ).queryByText( 'Loading budgets…' )
		).not.toBeInTheDocument();
		for ( const select of budgetSelects( dialog ) ) {
			expect( select ).toBeEnabled();
		}
	} );

	it( 'says there are no budgets yet when the list is empty', async () => {
		mockApi();
		render( <FeeDetail /> );

		const dialog = await openTransferDialog();
		expect(
			await within( dialog ).findByText( EMPTY_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
	} );

	it( 'reports a failed load, unlike an empty list, and loads the budgets on Retry', async () => {
		let loads = 0;
		mockApi( {
			routes: {
				[ BUDGETS_PATH ]: () => {
					loads += 1;
					return loads === 1
						? Promise.reject( new Error( 'Network error' ) )
						: Promise.resolve( BUDGETS );
				},
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openTransferDialog();
		expect(
			await within( dialog ).findByText( FAILURE_MESSAGE )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'A transfer needs a source and a target budget.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).queryByText( EMPTY_MESSAGE )
		).not.toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Retry' } )
		);

		await within( dialog ).findAllByRole( 'option', {
			name: 'Bank account',
		} );
		expect(
			within( dialog ).queryByText( FAILURE_MESSAGE )
		).not.toBeInTheDocument();
		expect( callsTo( BUDGETS_PATH ) ).toHaveLength( 2 );

		expectBudgetsLoadErrorLogged();
	} );
} );

describe( 'FeeDetail — creating a transfer', () => {
	const MARK_PAID_FAILED =
		'The transfer was created, but the payment could not be marked as paid. Mark the payment as paid from its row actions; do not create the transfer again.';

	const createButton = ( dialog ) =>
		within( dialog ).getByRole( 'button', { name: 'Create Transfer' } );

	/** Open the dialog and pick a source and a target budget. */
	async function fillTransferDialog( routes = {} ) {
		const state = mockApi( {
			routes: {
				[ BUDGETS_PATH ]: () => Promise.resolve( BUDGETS ),
				...routes,
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openTransferDialog();
		await within( dialog ).findAllByRole( 'option', {
			name: 'Bank account',
		} );
		const [ source, target ] = budgetSelects( dialog );
		fireEvent.change( source, { target: { value: '12' } } );
		fireEvent.change( target, { target: { value: '11' } } );
		await waitFor( () => expect( createButton( dialog ) ).toBeEnabled() );
		return { dialog, state };
	}

	it( 'posts the transfer to Fair Finance, then marks the payment paid', async () => {
		const { dialog, state } = await fillTransferDialog();
		state.payments = [ payment( { status: 'paid' } ), PAID ];

		fireEvent.click( createButton( dialog ) );

		expect(
			await findNotice( 'Transfer created and payment marked as paid.' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'dialog', { name: 'Create Transfer' } )
		).not.toBeInTheDocument();

		expect( callsTo( STALE_TRANSFER_PATH ) ).toHaveLength( 0 );
		expect( callsTo( TRANSFER_PATH ) ).toHaveLength( 1 );
		const [ [ transfer ] ] = callsTo( TRANSFER_PATH );
		expect( transfer.method ).toBe( 'POST' );
		expect( transfer.data ).toEqual( {
			amount: 25,
			entry_date: new Date().toISOString().split( 'T' )[ 0 ],
			source_budget_id: 12,
			target_budget_id: 11,
			description: 'Membership 2026 — Ada Example',
			participant_id: 101,
		} );

		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 1 );
		expect( callsTo( MARK_PAID_PATH )[ 0 ][ 0 ].method ).toBe( 'POST' );
	} );

	it( 'leaves the description out when it is empty', async () => {
		const { dialog } = await fillTransferDialog();

		fireEvent.change(
			within( dialog ).getByRole( 'textbox', { name: 'Description' } ),
			{ target: { value: '   ' } }
		);
		fireEvent.click( createButton( dialog ) );

		await findNotice( 'Transfer created and payment marked as paid.' );
		const [ [ transfer ] ] = callsTo( TRANSFER_PATH );
		expect( transfer.data ).not.toHaveProperty( 'description' );
	} );

	it( 'keeps the dialog open with the reason when the transfer fails', async () => {
		const alert = jest.fn();
		window.alert = alert;
		let attempts = 0;
		const { dialog } = await fillTransferDialog( {
			[ TRANSFER_PATH ]: () => {
				attempts += 1;
				return attempts === 1
					? Promise.reject(
							restError(
								'rest_transfer_creation_failed',
								'Failed to create transfer.'
							)
						)
					: Promise.resolve( { id: 501 } );
			},
		} );

		fireEvent.click( createButton( dialog ) );

		expect(
			await within( dialog ).findByText( 'Failed to create transfer.' )
		).toBeInTheDocument();
		expect( alert ).not.toHaveBeenCalled();
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 0 );
		expect(
			screen.getByRole( 'dialog', { name: 'Create Transfer' } )
		).toBeInTheDocument();

		// What was entered is still there, and the transfer can be retried.
		const [ source, target ] = budgetSelects( dialog );
		expect( source ).toHaveValue( '12' );
		expect( target ).toHaveValue( '11' );
		await waitFor( () => expect( createButton( dialog ) ).toBeEnabled() );

		fireEvent.click( createButton( dialog ) );

		await findNotice( 'Transfer created and payment marked as paid.' );
		expect( callsTo( TRANSFER_PATH ) ).toHaveLength( 2 );
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 1 );
	} );

	it( 'says the transfer exists when only marking the payment paid fails', async () => {
		const { dialog } = await fillTransferDialog( {
			[ MARK_PAID_PATH ]: () =>
				Promise.reject(
					restError( 'rest_forbidden', 'Sorry, you cannot do that.' )
				),
		} );

		fireEvent.click( createButton( dialog ) );

		expect( await findNotice( MARK_PAID_FAILED ) ).toBeInTheDocument();
		// The dialog is gone, so the transfer cannot be submitted again.
		expect(
			screen.queryByRole( 'dialog', { name: 'Create Transfer' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Transfer created and payment marked as paid.' )
		).not.toBeInTheDocument();
		expect( callsTo( TRANSFER_PATH ) ).toHaveLength( 1 );
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 1 );
	} );

	it( 'sends a single transfer when the button is clicked repeatedly', async () => {
		const pending = deferred();
		const { dialog } = await fillTransferDialog( {
			[ TRANSFER_PATH ]: () => pending.promise,
		} );

		const button = createButton( dialog );
		fireEvent.click( button );
		fireEvent.click( button );
		fireEvent.click( button );

		await waitFor( () => expect( button ).toBeDisabled() );
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();

		await act( async () => {
			pending.resolve( { id: 501 } );
		} );

		await findNotice( 'Transfer created and payment marked as paid.' );
		expect( callsTo( TRANSFER_PATH ) ).toHaveLength( 1 );
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 1 );
	} );
} );

describe( 'FeeDetail — confirming payment status changes (#1936)', () => {
	const CANCEL_PATH = `${ PAYMENTS_PATH }/31/cancel`;

	async function openStatusDialog( action, title ) {
		await openRowMenu( 'Ada Example' );
		fireEvent.click(
			await screen.findByRole( 'menuitem', { name: action } )
		);
		return screen.findByRole( 'dialog', { name: title } );
	}

	it( 'names the member, fee and amount before marking paid, and cancelling changes nothing', async () => {
		mockApi();
		render( <FeeDetail /> );

		const dialog = await openStatusDialog(
			'Mark as Paid',
			'Mark as paid — Ada Example'
		);

		expect(
			within( dialog ).getByText(
				'Membership 2026: 25.00 EUR (ada@example.test).'
			)
		).toBeVisible();
		expect(
			within( dialog ).getByText( /No money is collected/ )
		).toBeVisible();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Mark as paid' } )
		).not.toHaveClass( 'is-destructive' );

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 0 );
	} );

	it( 'marks paid once, keeps the dialog on failure, and retries', async () => {
		const first = deferred();
		let attempts = 0;
		mockApi( {
			routes: {
				[ MARK_PAID_PATH ]: () => {
					attempts++;
					return attempts === 1
						? first.promise
						: Promise.resolve( {} );
				},
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openStatusDialog(
			'Mark as Paid',
			'Mark as paid — Ada Example'
		);
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Mark as paid',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );
		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 1 );

		await act( async () =>
			first.reject( restError( 'update_failed', '' ) )
		);

		expect(
			within( dialog ).getByText(
				'The payment could not be marked as paid. Try again.',
				{ selector: '.components-notice__content' }
			)
		).toBeVisible();

		await act( async () => fireEvent.click( confirm ) );

		expect( callsTo( MARK_PAID_PATH ) ).toHaveLength( 2 );
		expect(
			await findNotice( 'Payment of Ada Example marked as paid.' )
		).toBeInTheDocument();
	} );

	it( 'states that cancelling refunds nothing, with a destructive button', async () => {
		mockApi( { routes: { [ CANCEL_PATH ]: () => Promise.resolve( {} ) } } );
		render( <FeeDetail /> );

		const dialog = await openStatusDialog(
			'Cancel',
			'Cancel payment — Ada Example'
		);

		expect(
			within( dialog ).getByText( /is canceled or refunded/ )
		).toBeVisible();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Cancel payment',
		} );
		expect( confirm ).toHaveClass( 'is-destructive' );

		await act( async () => fireEvent.click( confirm ) );

		expect( callsTo( CANCEL_PATH ) ).toHaveLength( 1 );
		expect(
			await findNotice( 'Payment of Ada Example canceled.' )
		).toBeInTheDocument();
	} );
} );

describe( 'FeeDetail — bulk payment reminders (#1936)', () => {
	const openBulkDialog = async () => {
		await rowOf( 'Ada Example' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Send Reminders' } )
		);
		return screen.getByRole( 'dialog', {
			name: 'Send payment reminders — Membership 2026',
		} );
	};

	it( 'lists every pending member before sending, and cancelling sends nothing', async () => {
		mockApi( { payments: [ PENDING, PAID, NO_EMAIL ] } );
		render( <FeeDetail /> );

		const dialog = await openBulkDialog();

		expect(
			within( dialog ).getByText( /each of the 2 members/ )
		).toBeVisible();
		expect(
			within( dialog ).getByText( 'Ada Example — ada@example.test' )
		).toBeVisible();
		expect(
			within( dialog ).getByText(
				'Cleo Placeholder — no email address; it will be reported as not sent'
			)
		).toBeVisible();
		expect(
			within( dialog ).queryByText( /Ben Sample/ )
		).not.toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( callsTo( BULK_PATH ) ).toHaveLength( 0 );
	} );

	it( 'reports which reminders were not sent and why', async () => {
		mockApi( {
			payments: [ PENDING, NO_EMAIL ],
			routes: {
				[ BULK_PATH ]: () =>
					Promise.resolve( {
						sent: [ 'ada@example.test' ],
						failed: [
							{
								name: 'Cleo',
								email: '',
								reason: 'Participant has no valid email address.',
							},
						],
					} ),
			},
		} );
		render( <FeeDetail /> );

		const dialog = await openBulkDialog();
		await act( async () =>
			fireEvent.click(
				within( dialog ).getByRole( 'button', {
					name: 'Send reminders',
				} )
			)
		);

		expect( callsTo( BULK_PATH ) ).toHaveLength( 1 );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( await screen.findByText( '1 reminder sent.' ) ).toBeVisible();
		expect(
			screen.getByText( 'Cleo: Participant has no valid email address.' )
		).toBeVisible();
	} );

	it( 'withholds sending when no payment is pending', async () => {
		mockApi( { payments: [ PAID ] } );
		render( <FeeDetail /> );
		await screen.findByText( 'Ben Sample' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Send Reminders' } )
		);

		const dialog = screen.getByRole( 'dialog' );
		expect(
			within( dialog ).getByText(
				'No member has a pending payment, so there is nobody to remind.'
			)
		).toBeVisible();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Send reminders' } )
		).toBeDisabled();
	} );
} );
