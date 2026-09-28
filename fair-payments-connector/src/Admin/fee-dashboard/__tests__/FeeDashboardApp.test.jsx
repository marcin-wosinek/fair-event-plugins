/**
 * Component tests for the Fee Dashboard monthly statistics (#1685).
 *
 * Exercises:
 *   - The pricing explanation (#1655) still renders.
 *   - The current month loads by default and the five figures render.
 *   - Previous / next / current month navigation requests the right month.
 *   - Missing Mollie or Fair Event fees mark dependent figures incomplete
 *     and show how many transactions are affected.
 *   - Mixed currencies render separately; empty months and errors are clear.
 *   - A slow response for an earlier month never replaces the latest one.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	act,
	configure,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import FeeDashboardApp, { shiftMonth } from '../FeeDashboardApp.js';

jest.mock( '@wordpress/api-fetch' );

// Notice announces its text through @wordpress/a11y live regions, which
// persist across tests; only match the rendered page.
configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

const figures = ( overrides = {} ) => ( {
	currency: 'EUR',
	transaction_count: 3,
	paid_total: 1000,
	fair_event_commission: 20,
	mollie_commission: 5.5,
	amount_after_fees: 974.5,
	missing_fair_event_commission_count: 0,
	missing_mollie_commission_count: 0,
	fair_event_commission_complete: true,
	mollie_commission_complete: true,
	amount_after_fees_complete: true,
	...overrides,
} );

const summary = ( month, currencies = [ figures() ], testmode = false ) => ( {
	month,
	testmode,
	currencies,
} );

const requestedMonth = ( call ) =>
	new URLSearchParams( call[ 0 ].path.split( '?' )[ 1 ] ).get( 'month' );

beforeEach( () => {
	// Fake only Date so Testing Library's async polling keeps real timers.
	jest.useFakeTimers( {
		now: new Date( '2027-02-15T12:00:00Z' ),
		doNotFake: [
			'setTimeout',
			'clearTimeout',
			'setInterval',
			'clearInterval',
			'setImmediate',
			'clearImmediate',
			'nextTick',
			'queueMicrotask',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			'requestIdleCallback',
			'cancelIdleCallback',
			'hrtime',
			'performance',
		],
	} );
} );

afterEach( () => {
	jest.useRealTimers();
	jest.clearAllMocks();
} );

describe( 'shiftMonth', () => {
	it( 'moves across year boundaries', () => {
		expect( shiftMonth( '2027-01', -1 ) ).toBe( '2026-12' );
		expect( shiftMonth( '2026-12', 1 ) ).toBe( '2027-01' );
	} );
} );

describe( 'FeeDashboardApp', () => {
	it( 'explains the uncapped 2% fee, the 2026 waiver, and separate Mollie fees', async () => {
		apiFetch.mockResolvedValue( summary( '2027-02' ) );
		render( <FeeDashboardApp /> );

		expect(
			screen.getByText(
				'The integration fee is 2% of ticket sales, with no monthly cap. It is waived through 31 December 2026. Mollie processing fees apply separately.'
			)
		).toBeInTheDocument();
		expect(
			await screen.findByText( 'Mollie commission' )
		).toBeInTheDocument();
	} );

	it( 'loads the current month by default and shows the five figures', async () => {
		apiFetch.mockResolvedValue( summary( '2027-02' ) );
		render( <FeeDashboardApp /> );

		expect( await screen.findByText( 'Paid transactions' ) ).toBeVisible();
		expect( requestedMonth( apiFetch.mock.calls[ 0 ] ) ).toBe( '2027-02' );
		expect(
			screen.getByTestId( 'fee-dashboard-month' ).textContent
		).toMatch( /2027/ );

		expect( screen.getByText( '3' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Total paid' ) ).toBeInTheDocument();
		expect( screen.getByText( /1\.000,00/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Calculated amount after fees' )
		).toBeInTheDocument();
		expect( screen.getByText( /974,50/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Fair Event commission' )
		).toBeInTheDocument();
		expect( screen.getByText( /20,00/ ) ).toBeInTheDocument();
		expect( screen.getByText( /5,50/ ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'An estimate, not a confirmed Mollie payout.' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Incomplete' ) ).toBeNull();
		expect( screen.queryByText( 'Current month' ) ).toBeNull();
	} );

	it( 'navigates between months and back to the current month', async () => {
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				summary(
					new URLSearchParams( path.split( '?' )[ 1 ] ).get( 'month' )
				)
			)
		);
		render( <FeeDashboardApp /> );
		await screen.findByText( 'Paid transactions' );

		fireEvent.click( screen.getByText( 'Previous month' ) );
		await screen.findByText( 'Paid transactions' );
		fireEvent.click( screen.getByText( 'Previous month' ) );
		await screen.findByText( 'Paid transactions' );
		expect( requestedMonth( apiFetch.mock.calls[ 2 ] ) ).toBe( '2026-12' );
		expect(
			screen.getByTestId( 'fee-dashboard-month' ).textContent
		).toMatch( /2026/ );

		fireEvent.click( screen.getByText( 'Next month' ) );
		await screen.findByText( 'Paid transactions' );
		expect( requestedMonth( apiFetch.mock.calls[ 3 ] ) ).toBe( '2027-01' );

		fireEvent.click( screen.getByText( 'Current month' ) );
		await screen.findByText( 'Paid transactions' );
		expect( requestedMonth( apiFetch.mock.calls[ 4 ] ) ).toBe( '2027-02' );
		expect( screen.queryByText( 'Current month' ) ).toBeNull();
	} );

	it( 'marks Mollie-dependent figures incomplete and counts transactions awaiting fees', async () => {
		apiFetch.mockResolvedValue(
			summary( '2027-02', [
				figures( {
					missing_mollie_commission_count: 2,
					mollie_commission_complete: false,
					amount_after_fees_complete: false,
				} ),
			] )
		);
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText(
				'2 paid transactions are still awaiting Mollie fee data. The Mollie commission and the amount after fees are incomplete until it arrives.'
			)
		).toBeInTheDocument();
		// Mollie commission + amount after fees.
		expect( screen.getAllByText( 'Incomplete' ) ).toHaveLength( 2 );
		expect(
			screen.getByText( 'Known subtotal so far.' )
		).toBeInTheDocument();
	} );

	it( 'uses singular wording and flags a missing Fair Event commission separately', async () => {
		apiFetch.mockResolvedValue(
			summary( '2027-02', [
				figures( {
					missing_fair_event_commission_count: 1,
					fair_event_commission_complete: false,
					amount_after_fees_complete: false,
				} ),
			] )
		);
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText(
				'1 paid transaction has no recorded Fair Event commission. The Fair Event commission and the amount after fees are incomplete.'
			)
		).toBeInTheDocument();
		expect( screen.getAllByText( 'Incomplete' ) ).toHaveLength( 2 );
		expect( screen.queryByText( /awaiting Mollie fee data/ ) ).toBeNull();
	} );

	it( 'shows each currency separately', async () => {
		apiFetch.mockResolvedValue(
			summary( '2027-02', [
				figures(),
				figures( {
					currency: 'PLN',
					transaction_count: 1,
					paid_total: 100,
				} ),
			] )
		);
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByRole( 'heading', { name: 'EUR' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'heading', { name: 'PLN' } )
		).toBeInTheDocument();
		expect( screen.getAllByText( 'Total paid' ) ).toHaveLength( 2 );
	} );

	it( 'renders zero values for an empty month', async () => {
		apiFetch.mockResolvedValue(
			summary( '2027-02', [
				figures( {
					transaction_count: 0,
					paid_total: 0,
					fair_event_commission: 0,
					mollie_commission: 0,
					amount_after_fees: 0,
				} ),
			] )
		);
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText( 'No paid transactions in this month.' )
		).toBeInTheDocument();
		expect( screen.getAllByText( /0,00/ ) ).toHaveLength( 4 );
		expect( screen.queryByText( 'Incomplete' ) ).toBeNull();
	} );

	it( 'shows the test mode notice', async () => {
		apiFetch.mockResolvedValue( summary( '2027-02', [ figures() ], true ) );
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText(
				'Test mode — these figures reflect test transactions only.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows a loading error and retries', async () => {
		apiFetch
			.mockRejectedValueOnce( new Error( 'Server unavailable' ) )
			.mockResolvedValueOnce( summary( '2027-02' ) );
		render( <FeeDashboardApp /> );

		expect(
			await screen.findByText( 'Server unavailable' )
		).toBeInTheDocument();
		fireEvent.click( screen.getByText( 'Try again' ) );

		expect( await screen.findByText( 'Paid transactions' ) ).toBeVisible();
		expect( screen.queryByText( 'Server unavailable' ) ).toBeNull();
	} );

	it( 'ignores a slow response for a month that is no longer selected', async () => {
		let resolveFirst;
		apiFetch
			.mockImplementationOnce(
				() => new Promise( ( resolve ) => ( resolveFirst = resolve ) )
			)
			.mockResolvedValueOnce(
				summary( '2027-01', [ figures( { transaction_count: 7 } ) ] )
			);
		render( <FeeDashboardApp /> );

		fireEvent.click( screen.getByText( 'Previous month' ) );
		expect( await screen.findByText( '7' ) ).toBeInTheDocument();

		await act( async () => {
			resolveFirst(
				summary( '2027-02', [ figures( { transaction_count: 99 } ) ] )
			);
		} );

		expect( screen.getByText( '7' ) ).toBeInTheDocument();
		expect( screen.queryByText( '99' ) ).toBeNull();
	} );
} );
