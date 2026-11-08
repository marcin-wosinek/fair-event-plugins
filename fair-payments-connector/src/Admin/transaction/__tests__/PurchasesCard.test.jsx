/**
 * Component tests for the transaction view's Purchases card (#2141, stage
 * 5 of #2111): the purchases a transaction pays for, as Fair Events'
 * payment links record them through `fair_payment_prepare_purchases`, with
 * each purchase's share. Without a plugin reporting purchases the card is
 * absent.
 */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { PurchasesCard, purchaseRoleLabel } from '../TransactionPage.js';

const purchase = ( overrides = {} ) => ( {
	signup_id: 5,
	name: 'Ana Buyer',
	status: 'confirmed',
	event_date_id: 9,
	event: {
		title: 'Spring Gala',
		start_date: '2026-12-01',
		start_time: '19:00',
		end_date: '2026-12-01',
		end_time: '23:00',
		all_day: false,
		manage_url:
			'admin.php?page=fair-events-manage-event&event_date_id=9&tab=finance',
	},
	role: 'charge',
	allocated_amount: 12,
	currency: 'EUR',
	...overrides,
} );

describe( 'PurchasesCard', () => {
	it( 'is absent when no plugin reports purchases', () => {
		const { container } = render( <PurchasesCard purchases={ null } /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'says when the transaction pays for no purchase', () => {
		render( <PurchasesCard purchases={ [] } /> );
		expect(
			screen.getByText( 'This transaction isn’t linked to any purchase.' )
		).toBeInTheDocument();
	} );

	it( 'lists each purchase with its event and share', () => {
		render(
			<PurchasesCard
				purchases={ [
					purchase(),
					purchase( {
						signup_id: 6,
						name: '',
						event_date_id: 10,
						event: null,
						role: 'additional_charge',
					} ),
				] }
			/>
		);

		const rows = within( screen.getByRole( 'table' ) )
			.getAllByRole( 'row' )
			.slice( 1 );
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 0 ] ).toHaveTextContent( 'Ana Buyer' );
		expect( rows[ 0 ] ).toHaveTextContent( 'Tickets' );
		expect( rows[ 0 ] ).toHaveTextContent( /12/ );
		expect(
			within( rows[ 0 ] ).getByRole( 'link', { name: /Spring Gala/ } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-manage-event&event_date_id=9&tab=finance'
		);
		expect( rows[ 1 ] ).toHaveTextContent( 'Purchase #6' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Event date #10' );
		expect( rows[ 1 ] ).toHaveTextContent( 'Added activities' );
	} );

	it( 'marks a refund record as not counted', () => {
		expect( purchaseRoleLabel( 'legacy_refund_record' ) ).toBe(
			'Refund record (not counted)'
		);
		expect( purchaseRoleLabel( 'upgrade' ) ).toBe( 'Series upgrade' );
	} );
} );
