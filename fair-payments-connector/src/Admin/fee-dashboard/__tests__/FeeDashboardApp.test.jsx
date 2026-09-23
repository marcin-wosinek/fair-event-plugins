/**
 * Component tests for the Fee Dashboard (#1655: flat 2% integration fee
 * with no monthly cap).
 *
 * Exercises:
 *   - The pricing explanation states the uncapped 2% rate, the waiver
 *     through 31 December 2026, and that Mollie fees are separate.
 *   - Monthly volume and integration-fee totals still render.
 *   - No cap meter, remaining allowance, or active-plan breakdown renders,
 *     even if a stale response still carries the removed fields.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import FeeDashboardApp from '../FeeDashboardApp.js';

jest.mock( '@wordpress/api-fetch' );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'FeeDashboardApp', () => {
	it( 'explains the uncapped 2% fee, the 2026 waiver, and separate Mollie fees', async () => {
		apiFetch.mockResolvedValue( {
			month: '2027-02',
			total_volume: 1000,
			total_fees: 20,
			testmode: false,
		} );
		render( <FeeDashboardApp /> );

		expect(
			screen.getByText(
				'The integration fee is 2% of ticket sales, with no monthly cap. It is waived through 31 December 2026. Mollie processing fees apply separately.'
			)
		).toBeInTheDocument();
		expect(
			await screen.findByText( 'Integration fees this month' )
		).toBeInTheDocument();
	} );

	it( 'shows volume and fee totals without any cap or plan elements', async () => {
		apiFetch.mockResolvedValue( {
			month: '2027-02',
			total_volume: 1000,
			total_fees: 20,
			testmode: false,
			fee_cap: 12,
			cap_remaining: 0,
			plan_breakdown: { 'fair-payments-connector': 4 },
		} );
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText( 'Total payment volume this month' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Integration fees this month' )
		).toBeInTheDocument();
		expect( screen.getByText( /1\.000,00/ ) ).toBeInTheDocument();
		expect( screen.getByText( /20,00/ ) ).toBeInTheDocument();

		expect( screen.queryByText( 'Monthly fee cap' ) ).toBeNull();
		expect( screen.queryByText( /remaining/ ) ).toBeNull();
		expect( screen.queryByText( 'Active plan' ) ).toBeNull();
		expect( screen.queryByText( 'fair-payments-connector' ) ).toBeNull();
	} );
} );
