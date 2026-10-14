/**
 * Component test for the transaction view's "Event" field (#1599).
 *
 * Mirrors the existing Participant field: search-as-you-type, save through
 * the transaction update endpoint, and a debounced, cancel/clear/error-aware
 * UI. A recurring master must never be offered as a selectable result — only
 * its individually generated occurrences.
 */
import '@testing-library/jest-dom';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TransactionPage from '../TransactionPage.js';

jest.mock( '@wordpress/api-fetch' );

const BASE_TRANSACTION = {
	id: 42,
	mollie_payment_id: 'tr_test_42',
	post_id: null,
	post_title: '',
	user_id: null,
	user_name: '',
	participant_id: null,
	participant: null,
	amount: 12.5,
	currency: 'EUR',
	mollie_fee: null,
	application_fee: null,
	status: 'paid',
	testmode: false,
	description: '',
	redirect_url: '',
	webhook_url: '',
	checkout_url: '',
	metadata: null,
	created_at: '2026-07-01 10:00:00',
	payment_initiated_at: '',
	updated_at: '2026-07-01 10:00:00',
	line_items: [],
	event_date_id: null,
	event: null,
};

function mockApiFetch( { transaction, onUpdate, searchResults } ) {
	apiFetch.mockImplementation( ( options ) => {
		const { path, method } = options;

		if ( path.startsWith( '/fair-payments-connector/v1/transactions/' ) ) {
			if ( path.endsWith( '/log' ) ) {
				return Promise.resolve( [] );
			}
			if ( 'POST' === method ) {
				return onUpdate( options.data );
			}
			return Promise.resolve( transaction );
		}

		if ( path.startsWith( '/fair-events/v1/event-dates/all' ) ) {
			return Promise.resolve( searchResults || [] );
		}

		return Promise.reject( new Error( `Unhandled path: ${ path }` ) );
	} );
}

async function getEventRow() {
	return ( await screen.findByText( 'Event' ) ).closest( 'tr' );
}

function setTransactionId( id ) {
	window.history.pushState( {}, '', `/?transaction_id=${ id }` );
}

async function search( row, text ) {
	fireEvent.click(
		within( row ).getByRole( 'button', { name: /Add|Edit/ } )
	);
	fireEvent.change(
		await within( row ).findByPlaceholderText( 'Search by event title…' ),
		{ target: { value: text } }
	);
}

beforeEach( () => {
	setTransactionId( BASE_TRANSACTION.id );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'TransactionPage — Event field', () => {
	it( 'shows a "not linked" state when no event is assigned', async () => {
		mockApiFetch( { transaction: BASE_TRANSACTION } );

		render( <TransactionPage /> );

		const row = await getEventRow();
		expect( within( row ).getByText( '-' ) ).toBeInTheDocument();
	} );

	it( "renders the linked event's title, date, and manage link", async () => {
		const transaction = {
			...BASE_TRANSACTION,
			event_date_id: 7,
			event: {
				id: 7,
				title: 'Spring Meetup',
				start_datetime: '2027-03-01 10:00:00',
				manage_url:
					'admin.php?page=fair-events-manage-event&event_date_id=7',
			},
		};
		mockApiFetch( { transaction } );

		render( <TransactionPage /> );

		const link = await screen.findByRole( 'link', {
			name: /Spring Meetup/,
		} );
		expect( link ).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-manage-event&event_date_id=7'
		);
	} );

	it( 'falls back to the raw ID when a stored event cannot currently be resolved', async () => {
		const transaction = {
			...BASE_TRANSACTION,
			event_date_id: 99,
			event: null,
		};
		mockApiFetch( { transaction } );

		render( <TransactionPage /> );

		expect( await screen.findByText( '#99' ) ).toBeInTheDocument();
	} );

	it( 'flattens a recurring master into its individual occurrences and links the selected one', async () => {
		const onUpdate = jest.fn( ( data ) =>
			Promise.resolve( {
				...BASE_TRANSACTION,
				event_date_id: data.event_date_id,
				event: {
					id: data.event_date_id,
					title: 'Weekly Standup',
					start_datetime: '2027-04-08 09:00:00',
					manage_url: `admin.php?page=fair-events-manage-event&event_date_id=${ data.event_date_id }`,
				},
			} )
		);
		const searchResults = [
			{
				id: 5,
				title: 'Weekly Standup',
				occurrence_type: 'master',
				children: [
					{
						id: 6,
						title: 'Weekly Standup',
						start_datetime: '2027-04-01 09:00:00',
						occurrence_type: 'generated',
					},
					{
						id: 7,
						title: 'Weekly Standup',
						start_datetime: '2027-04-08 09:00:00',
						occurrence_type: 'generated',
					},
				],
			},
		];
		mockApiFetch( {
			transaction: BASE_TRANSACTION,
			onUpdate,
			searchResults,
		} );

		render( <TransactionPage /> );

		const row = await getEventRow();
		await search( row, 'Weekly' );

		// Only the two individual occurrences are offered — never the master.
		const options = await within( row ).findAllByRole( 'button', {
			name: /Weekly Standup/,
		} );
		expect( options ).toHaveLength( 2 );

		// The second occurrence (id 7, 2027-04-08) — not the master itself.
		fireEvent.click( options[ 1 ] );

		await waitFor( () =>
			expect( onUpdate ).toHaveBeenCalledWith( { event_date_id: 7 } )
		);
		expect(
			await screen.findByRole( 'link', { name: /Weekly Standup/ } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-manage-event&event_date_id=7'
		);
	} );

	it( 'clears an existing event link', async () => {
		const linked = {
			...BASE_TRANSACTION,
			event_date_id: 7,
			event: {
				id: 7,
				title: 'Spring Meetup',
				start_datetime: '2027-03-01 10:00:00',
				manage_url:
					'admin.php?page=fair-events-manage-event&event_date_id=7',
			},
		};
		const onUpdate = jest.fn( () =>
			Promise.resolve( { ...BASE_TRANSACTION } )
		);
		mockApiFetch( { transaction: linked, onUpdate } );

		render( <TransactionPage /> );

		await screen.findByRole( 'link', { name: /Spring Meetup/ } );
		const row = await getEventRow();
		fireEvent.click(
			within( row ).getByRole( 'button', { name: 'Edit' } )
		);
		fireEvent.click(
			within( row ).getByRole( 'button', { name: 'Remove' } )
		);

		await waitFor( () =>
			expect( onUpdate ).toHaveBeenCalledWith( { event_date_id: 0 } )
		);
		await waitFor( () =>
			expect( within( row ).getByText( '-' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows an error notice when the search request fails', async () => {
		apiFetch.mockImplementation( ( options ) => {
			if ( options.path.endsWith( '/log' ) ) {
				return Promise.resolve( [] );
			}
			if (
				options.path.startsWith(
					'/fair-payments-connector/v1/transactions/'
				)
			) {
				return Promise.resolve( BASE_TRANSACTION );
			}
			if (
				options.path.startsWith( '/fair-events/v1/event-dates/all' )
			) {
				return Promise.reject( new Error( 'network error' ) );
			}
			return Promise.reject( new Error( 'unhandled' ) );
		} );

		render( <TransactionPage /> );

		const row = await getEventRow();
		await search( row, 'Weekly' );

		expect(
			await within( row ).findByText( 'Search failed. Please try again.' )
		).toBeInTheDocument();
	} );

	it( 'shows an error notice when saving the event link fails', async () => {
		const searchResults = [
			{ id: 7, title: 'Spring Meetup', occurrence_type: 'single' },
		];
		apiFetch.mockImplementation( ( options ) => {
			if ( options.path.endsWith( '/log' ) ) {
				return Promise.resolve( [] );
			}
			if (
				options.path.startsWith(
					'/fair-payments-connector/v1/transactions/'
				) &&
				'POST' === options.method
			) {
				return Promise.reject( new Error( 'Update failed' ) );
			}
			if (
				options.path.startsWith(
					'/fair-payments-connector/v1/transactions/'
				)
			) {
				return Promise.resolve( BASE_TRANSACTION );
			}
			if (
				options.path.startsWith( '/fair-events/v1/event-dates/all' )
			) {
				return Promise.resolve( searchResults );
			}
			return Promise.reject( new Error( 'unhandled' ) );
		} );

		render( <TransactionPage /> );

		const row = await getEventRow();
		await search( row, 'Spring' );
		fireEvent.click(
			await within( row ).findByRole( 'button', {
				name: /Spring Meetup/,
			} )
		);

		expect(
			await screen.findByText( 'Update failed', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );

const deleteCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) => 'DELETE' === options.method
	);

function mockDeletion( { transaction = BASE_TRANSACTION, remove } ) {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.path.endsWith( '/log' ) ) {
			return Promise.resolve( [] );
		}
		if ( 'DELETE' === options.method ) {
			return remove( options );
		}
		return Promise.resolve( transaction );
	} );
}

async function openDeleteDialog() {
	fireEvent.click(
		await screen.findByRole( 'button', {
			name: 'Delete local transaction',
		} )
	);
	return screen.findByRole( 'dialog' );
}

describe( 'TransactionPage — delete transaction (#1618, #1773)', () => {
	it( 'names the transaction, amount, and description and states the local-only blast radius', async () => {
		mockApiFetch( {
			transaction: {
				...BASE_TRANSACTION,
				description: 'Ticket for Summer Jam',
			},
		} );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();

		expect(
			within( dialog ).getByText(
				'Permanently delete transaction #42 for 12.50 EUR? This cannot be undone.'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'Description: Ticket for Summer Jam' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( /not cancelled, refunded, or deleted/ )
		).toBeInTheDocument();
	} );

	it( 'says so when the transaction has no description', async () => {
		mockApiFetch( { transaction: BASE_TRANSACTION } );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();

		expect(
			within( dialog ).getByText( 'This transaction has no description.' )
		).toBeInTheDocument();
	} );

	it( 'cancelling the confirmation issues no request and leaves the transaction unchanged', async () => {
		mockApiFetch( { transaction: BASE_TRANSACTION } );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteCalls() ).toHaveLength( 0 );
	} );

	it( 'confirming sends one DELETE to the hardcoded endpoint, however often it is clicked', async () => {
		mockDeletion( {
			remove: () => Promise.resolve( { deleted: true, id: 42 } ),
		} );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete local transaction',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		await waitFor( () => expect( deleteCalls() ).toHaveLength( 1 ) );
		expect( deleteCalls()[ 0 ][ 0 ].path ).toBe(
			'/fair-payments-connector/v1/transactions/42'
		);
		// jsdom doesn't implement navigation, so the success redirect's
		// `window.location.href = …` logs a documented no-op console.error.
		await waitFor( () => expect( console ).toHaveErrored() );
		expect( deleteCalls() ).toHaveLength( 1 );
	} );

	it( 'stays open and busy while the deletion runs', async () => {
		mockDeletion( { remove: () => new Promise( () => {} ) } );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete local transaction',
			} )
		);

		expect(
			await within( dialog ).findByRole( 'button', { name: 'Deleting…' } )
		).toBeDisabled();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
	} );

	it( 'keeps the transaction displayed and shows the error in the dialog when deletion fails', async () => {
		mockDeletion( {
			remove: () => Promise.reject( new Error( 'Delete failed' ) ),
		} );

		render( <TransactionPage /> );
		const dialog = await openDeleteDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete local transaction',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Delete failed', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Delete local transaction',
			} )
		).toBeEnabled();
		// The transaction detail view is still behind the dialog, not an
		// error page (the open modal hides it from the accessibility tree).
		expect(
			screen.getByRole( 'heading', {
				name: /Transaction #42/,
				hidden: true,
			} )
		).toBeInTheDocument();
	} );
} );
