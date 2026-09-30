/**
 * Component test for the transactions list "Entry" column (#1290).
 *
 * The `entry_id` deep link into the entries screen never worked (no reader,
 * no filter, no model support), so instead of repairing it the link is
 * dropped: entry ids render as plain, comma-separated text and no anchor
 * points at the retired `fair-payments-connector-entries` slug.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TransactionsApp from '../TransactionsApp.js';

jest.mock( '@wordpress/api-fetch' );

const TRANSACTION = {
	id: 42,
	amount: 12.5,
	currency: 'EUR',
	mollie_fee: null,
	application_fee: null,
	status: 'paid',
	testmode: false,
	description: 'Ticket purchase',
	participant: null,
	user_name: 'Jane Doe',
	entry_ids: [ 12, 34 ],
	created_at: '2026-07-01',
};

beforeEach( () => {
	apiFetch.mockImplementation( () =>
		Promise.resolve( {
			transactions: [ TRANSACTION ],
			total: 1,
			pages: 1,
		} )
	);
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'TransactionsApp — entry column', () => {
	it( 'renders entry ids as plain text, not a link to the retired entries slug', async () => {
		render( <TransactionsApp /> );

		expect( await screen.findByText( '#12, #34' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: /#12|#34/ } )
		).not.toBeInTheDocument();

		const staleLink = screen
			.queryAllByRole( 'link' )
			.find( ( l ) =>
				( l.getAttribute( 'href' ) || '' ).includes(
					'fair-payments-connector-entries'
				)
			);
		expect( staleLink ).toBeUndefined();
	} );
} );

describe( 'TransactionsApp — external updates moved (#1695)', () => {
	it( 'no longer offers loading missing Mollie fees; that runs from External Updates', async () => {
		render( <TransactionsApp /> );

		expect( await screen.findByText( '#12, #34' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', {
				name: 'Load Missing Mollie Fees',
			} )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Import' } )
		).toBeInTheDocument();
	} );
} );

describe( 'TransactionsApp — post-deletion success notice (#1618)', () => {
	afterEach( () => {
		window.history.pushState( {}, '', '/' );
	} );

	// The accessibility live region echoes notice text alongside the visible
	// Notice, so scope matches to the rendered notice content itself.
	const successNoticeContent = () =>
		screen.queryByText(
			( content, element ) =>
				content ===
					'Transaction deleted. The payment in Mollie or any other external service was not changed.' &&
				element?.className === 'components-notice__content'
		);

	it( 'shows a success notice for the one-use marker and strips it from the URL', async () => {
		window.history.pushState(
			{},
			'',
			'/?page=fair-payments-connector-transactions&transaction_deleted=1'
		);

		render( <TransactionsApp /> );

		await waitFor( () =>
			expect( successNoticeContent() ).toBeInTheDocument()
		);

		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-transactions'
		);
	} );

	it( 'shows no success notice when the marker is absent', async () => {
		window.history.pushState(
			{},
			'',
			'/?page=fair-payments-connector-transactions'
		);

		render( <TransactionsApp /> );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect( successNoticeContent() ).not.toBeInTheDocument();
	} );
} );
