/**
 * Component tests for the Finance tab's purchase payments (#2141, stage 5
 * of #2111; PAYMENT_HISTORY_MIGRATION.md §8.15): every attempt of each
 * purchase from GET get-tickets' payment history, each purchase's own share
 * of a shared payment, which attempts count, and unavailable payment
 * information said as such.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import PurchasePayments, {
	paymentCountsLabel,
	paymentRoleLabel,
	paymentStatusLabel,
	purchasePaymentRows,
} from '../PurchasePayments.js';
import EventFinance from '../EventFinance.js';

jest.mock( '@wordpress/api-fetch' );

const payment = ( overrides = {} ) => ( {
	transaction_id: 11,
	role: 'charge',
	allocated_amount: 30,
	currency: 'EUR',
	attribution: 'live',
	created_at: '2026-11-01 10:00:00',
	counts_as_revenue: true,
	transaction: {
		status: 'paid',
		amount: 30,
		currency: 'EUR',
		created_at: '2026-11-01 10:00:00',
	},
	transaction_missing: false,
	latest: false,
	...overrides,
} );

const signup = ( id, name, payments, information = 'available' ) => ( {
	id,
	name,
	transaction_id: payments.length
		? payments[ payments.length - 1 ].transaction_id
		: null,
	payment_history: {
		payment_information: information,
		currency: 'EUR',
		paid_amount: null,
		payments,
	},
} );

describe( 'purchase payment labels', () => {
	it( 'names each role and status', () => {
		expect( paymentRoleLabel( 'charge' ) ).toBe( 'Tickets' );
		expect( paymentRoleLabel( 'additional_charge' ) ).toBe(
			'Added activities'
		);
		expect( paymentRoleLabel( 'upgrade' ) ).toBe( 'Series upgrade' );
		expect( paymentRoleLabel( 'legacy_refund_record' ) ).toBe(
			'Refund record'
		);
		expect( paymentStatusLabel( payment() ) ).toBe( 'Paid' );
		expect(
			paymentStatusLabel(
				payment( { transaction: null, transaction_missing: true } )
			)
		).toBe( 'Missing in Fair Payments Connector' );
	} );

	it( 'says why a payment does not count', () => {
		expect( paymentCountsLabel( payment() ) ).toBe( 'Counted' );
		expect(
			paymentCountsLabel( payment( { counts_as_revenue: false } ) )
		).toBe( 'Not counted: not paid' );
		expect(
			paymentCountsLabel(
				payment( {
					role: 'legacy_refund_record',
					counts_as_revenue: false,
				} )
			)
		).toBe( 'Not counted: refund record' );
	} );

	it( 'lists one row per payment and skips purchases without any', () => {
		const rows = purchasePaymentRows( [
			signup( 1, 'Ana', [
				payment( { transaction_id: 10 } ),
				payment(),
			] ),
			signup( 2, 'Free', [] ),
			{ id: 3, name: 'Before readers', payment_history: null },
		] );
		expect( rows.map( ( row ) => row.payment.transaction_id ) ).toEqual( [
			10, 11,
		] );
	} );
} );

describe( 'PurchasePayments', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'shows every attempt with this purchase’s share of a shared payment', async () => {
		apiFetch.mockResolvedValue( [
			signup( 1, 'Ana Buyer', [
				payment( {
					transaction_id: 10,
					counts_as_revenue: false,
					transaction: {
						status: 'failed',
						amount: 30,
						currency: 'EUR',
					},
				} ),
				payment( { latest: true } ),
			] ),
			signup( 2, 'Shared Buyer', [
				payment( {
					transaction_id: 12,
					allocated_amount: 12,
					transaction: {
						status: 'paid',
						amount: 36,
						currency: 'EUR',
					},
				} ),
			] ),
		] );

		render( <PurchasePayments eventDateId={ 7 } /> );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets?event_date=7',
		} );
		const table = await screen.findByRole( 'table' );
		const rows = within( table ).getAllByRole( 'row' ).slice( 1 );
		expect( rows ).toHaveLength( 3 );
		expect( rows[ 0 ] ).toHaveTextContent( 'Ana Buyer' );
		expect( rows[ 0 ] ).toHaveTextContent( 'Failed' );
		expect( rows[ 0 ] ).toHaveTextContent( 'Not counted: not paid' );
		expect( rows[ 1 ] ).toHaveTextContent( '(latest attempt)' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Counted' );
		expect( rows[ 2 ] ).toHaveTextContent( 'Shared Buyer' );
		expect( rows[ 2 ] ).toHaveTextContent( /of\s.*36/ );
		expect(
			within( rows[ 2 ] ).getByRole( 'link', { name: '#12' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-transaction&transaction_id=12'
		);
	} );

	it( 'says when payment information can’t be read', async () => {
		apiFetch.mockResolvedValue( [
			signup(
				1,
				'Ana',
				[ payment( { transaction: null, counts_as_revenue: false } ) ],
				'unavailable'
			),
		] );

		render( <PurchasePayments eventDateId={ 7 } /> );

		expect(
			(
				await screen.findAllByText(
					/payment information can’t be read/
				)
			)[ 0 ]
		).toBeInTheDocument();
	} );

	it( 'says when no purchase has a payment', async () => {
		apiFetch.mockResolvedValue( [ signup( 1, 'Free', [] ) ] );

		render( <PurchasePayments eventDateId={ 7 } /> );

		expect(
			await screen.findByText( 'No purchase on this date has a payment.' )
		).toBeInTheDocument();
	} );

	it( 'names the section that failed to load', async () => {
		apiFetch.mockRejectedValue( { message: 'Server error.' } );

		render( <PurchasePayments eventDateId={ 7 } /> );

		expect(
			(
				await screen.findAllByText(
					'Purchase payments could not be loaded. Server error.'
				)
			)[ 0 ]
		).toBeInTheDocument();
	} );
} );

describe( 'EventFinance purchase payments', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				path.startsWith( '/fair-events/v1/get-tickets' )
					? []
					: { transactions: [] }
			)
		);
	} );

	it( 'keeps the general payments list and adds the section once the readers are active', async () => {
		render(
			<EventFinance
				eventDateId={ 7 }
				connectorActive
				financeActive={ false }
				paymentReadersActive
			/>
		);

		expect(
			await screen.findByRole( 'heading', { name: 'Purchase payments' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'Finance' } )
		).toBeInTheDocument();
		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/get-tickets?event_date=7',
			} )
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-payments-connector/v1/transactions?event_date_id=7&status=paid&mode=live&per_page=100',
		} );
	} );

	it( 'has no section before the readers are active', async () => {
		render(
			<EventFinance
				eventDateId={ 7 }
				connectorActive
				financeActive={ false }
			/>
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect(
			screen.queryByRole( 'heading', { name: 'Purchase payments' } )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith( {
			path: '/fair-events/v1/get-tickets?event_date=7',
		} );
	} );
} );
