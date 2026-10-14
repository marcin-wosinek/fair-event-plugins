/**
 * Component tests for the "Create test payment" button (#1207).
 *
 * Exercises:
 *   - Connected: the button is enabled and no "connect first" hint shows.
 *   - Disconnected: the button is disabled and the hint shows.
 *   - Clicking (connected, test mode): a payment is created, the checkout opens
 *     in a new tab, and the fallback link renders.
 *   - Live mode (#1773): a WordPress dialog shows the server-provided amount,
 *     currency, and account first; cancelling creates nothing, confirming
 *     sends the confirmed context once, failures stay in the dialog, and an
 *     outdated confirmation shows the current details for a fresh one.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectionTab from '../ConnectionTab.js';

jest.mock( '@wordpress/api-fetch' );

const CONNECTED_SETTINGS = {
	fair_payment_mollie_connected: true,
	fair_payment_mode: 'test',
	fair_payment_organization_id: 'org_123',
	fair_payment_mollie_profile_id: 'pfl_123',
	fair_payment_mollie_token_expires: 0,
};

const OVERVIEW = {
	profile_name: 'My Webshop',
	profile_id: 'pfl_123',
	mode: 'test',
	methods: [],
	manage_url: 'https://my.mollie.com/dashboard/',
};

const CHECKOUT_URL = 'https://www.mollie.com/checkout/test-1';

function mockApiFetch( { connected, testPaymentResult } ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve(
				connected
					? CONNECTED_SETTINGS
					: { fair_payment_mollie_connected: false }
			);
		}
		if ( path === '/fair-payments-connector/v1/connection/overview' ) {
			return Promise.resolve( OVERVIEW );
		}
		if ( path === '/fair-payments-connector/v1/test-payment' ) {
			return (
				testPaymentResult ||
				Promise.resolve( {
					success: true,
					transaction_id: 42,
					checkout_url: CHECKOUT_URL,
					status: 'open',
					currency: 'EUR',
					mode: 'test',
				} )
			);
		}
		return Promise.resolve( {} );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ConnectionTab — test payment button', () => {
	it( 'enables the button and hides the hint when connected', async () => {
		mockApiFetch( { connected: true } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const button = await screen.findByRole( 'button', {
			name: 'Create test payment',
		} );
		expect( button ).toBeEnabled();
		expect(
			screen.queryByText( 'Connect Mollie first to run a test payment.' )
		).not.toBeInTheDocument();

		expect( console ).toHaveLogged();
		expect( console ).toHaveWarned();
	} );

	it( 'disables the button and shows the hint when disconnected', async () => {
		mockApiFetch( { connected: false } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const button = await screen.findByRole( 'button', {
			name: 'Create test payment',
		} );
		expect( button ).toBeDisabled();
		expect(
			screen.getByText( 'Connect Mollie first to run a test payment.' )
		).toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );

	it( 'creates a payment, opens the checkout, and shows the fallback link', async () => {
		const openSpy = jest
			.spyOn( window, 'open' )
			.mockImplementation( () => null );
		const onNotice = jest.fn();
		mockApiFetch( { connected: true } );
		render(
			<ConnectionTab onNotice={ onNotice } shouldReload={ false } />
		);

		const button = await screen.findByRole( 'button', {
			name: 'Create test payment',
		} );
		fireEvent.click( button );

		await waitFor( () =>
			expect( openSpy ).toHaveBeenCalledWith(
				CHECKOUT_URL,
				'_blank',
				'noopener'
			)
		);

		const link = await screen.findByRole( 'link', {
			name: 'open it here.',
		} );
		expect( link ).toHaveAttribute( 'href', CHECKOUT_URL );
		expect( onNotice ).toHaveBeenCalledWith(
			expect.objectContaining( { status: 'success' } )
		);

		openSpy.mockRestore();
		expect( console ).toHaveLogged();
	} );
} );

const LIVE_CONTEXT = {
	amount: '1.00',
	amount_display: '1.00 PLN',
	currency: 'PLN',
	mode: 'live',
	profile_id: 'pfl_123',
	organization_id: 'org_123',
};

/**
 * Mock a connected live-mode site.
 *
 * @param {Object}   args
 * @param {Function} args.create  Returns the POST /test-payment response.
 * @param {Function} args.context Returns the GET /test-payment response.
 */
function mockLiveSite( {
	create = () =>
		Promise.resolve( {
			success: true,
			transaction_id: 43,
			checkout_url: CHECKOUT_URL,
			status: 'open',
			currency: 'PLN',
			mode: 'live',
		} ),
	context = () => Promise.resolve( LIVE_CONTEXT ),
} = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( {
				...CONNECTED_SETTINGS,
				fair_payment_mode: 'live',
			} );
		}
		if ( path === '/fair-payments-connector/v1/connection/overview' ) {
			return Promise.resolve( { ...OVERVIEW, mode: 'live' } );
		}
		if ( path === '/fair-payments-connector/v1/test-payment' ) {
			return method === 'POST' ? create() : context();
		}
		return Promise.reject( new Error( 'No route' ) );
	} );
}

const createCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) =>
			options.path === '/fair-payments-connector/v1/test-payment' &&
			options.method === 'POST'
	);

async function openLiveDialog() {
	render( <ConnectionTab onNotice={ () => {} } shouldReload={ false } /> );
	await screen.findByText( 'My Webshop' );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Create test payment' } )
	);
	const dialog = await screen.findByRole( 'dialog' );
	await within( dialog ).findByText(
		'Create a live test payment of 1.00 PLN?'
	);
	return dialog;
}

describe( 'ConnectionTab — live test payment confirmation', () => {
	it( 'shows the amount, currency, account, and real-money warning', async () => {
		mockLiveSite();
		const dialog = await openLiveDialog();

		expect(
			within( dialog ).getByRole( 'heading', {
				name: 'Create live test payment',
			} )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( 'My Webshop' )
		).toBeInTheDocument();
		expect( within( dialog ).getByText( 'pfl_123' ) ).toBeInTheDocument();
		expect( within( dialog ).getByText( 'org_123' ) ).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				'Live mode: this creates a real payment with real money and gateway fees.'
			)
		).toBeInTheDocument();
		expect( createCalls() ).toHaveLength( 0 );

		expect( console ).toHaveLogged();
	} );

	it( 'cancelling creates no payment', async () => {
		mockLiveSite();
		const dialog = await openLiveDialog();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( createCalls() ).toHaveLength( 0 );

		expect( console ).toHaveLogged();
	} );

	it( 'creates the payment once with the confirmed context and keeps the fallback link', async () => {
		const openSpy = jest
			.spyOn( window, 'open' )
			.mockImplementation( () => null );
		let resolveCreate;
		mockLiveSite( {
			create: () =>
				new Promise( ( resolve ) => {
					resolveCreate = resolve;
				} ),
		} );
		const dialog = await openLiveDialog();

		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Create live test payment',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		expect(
			await within( dialog ).findByRole( 'button', { name: 'Creating…' } )
		).toBeDisabled();
		expect( createCalls() ).toHaveLength( 1 );
		expect( createCalls()[ 0 ][ 0 ].data ).toEqual( {
			confirmed: {
				mode: 'live',
				currency: 'PLN',
				profile_id: 'pfl_123',
				organization_id: 'org_123',
			},
		} );

		resolveCreate( {
			success: true,
			transaction_id: 43,
			checkout_url: CHECKOUT_URL,
		} );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( openSpy ).toHaveBeenCalledWith(
			CHECKOUT_URL,
			'_blank',
			'noopener'
		);
		expect(
			await screen.findByRole( 'link', { name: 'open it here.' } )
		).toHaveAttribute( 'href', CHECKOUT_URL );

		openSpy.mockRestore();
		expect( console ).toHaveLogged();
	} );

	it( 'keeps a failure visible in the dialog and allows a retry', async () => {
		mockLiveSite( {
			create: () =>
				Promise.reject( {
					code: 'test_payment_failed',
					message: 'Mollie rejected the payment',
				} ),
		} );
		const dialog = await openLiveDialog();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Create live test payment',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Mollie rejected the payment' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Create live test payment',
			} )
		).toBeEnabled();

		expect( console ).toHaveLogged();
	} );

	it( 'shows the current details for a fresh confirmation when the context changed', async () => {
		mockLiveSite( {
			create: () =>
				Promise.reject( {
					code: 'test_payment_context_changed',
					message:
						'The payment mode, currency, or connected Mollie account changed since you confirmed.',
					data: {
						status: 409,
						context: {
							...LIVE_CONTEXT,
							amount_display: '1.00 EUR',
							currency: 'EUR',
						},
					},
				} ),
		} );
		const dialog = await openLiveDialog();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Create live test payment',
			} )
		);

		expect(
			await within( dialog ).findByText(
				'Create a live test payment of 1.00 EUR?'
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText( /changed since you confirmed/ )
		).toBeInTheDocument();
		expect( createCalls() ).toHaveLength( 1 );

		expect( console ).toHaveLogged();
	} );

	it( 'cannot confirm when the payment details fail to load', async () => {
		mockLiveSite( {
			context: () =>
				Promise.reject( { message: 'Mollie is not connected.' } ),
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Create test payment',
			} )
		);
		const dialog = await screen.findByRole( 'dialog' );

		expect(
			await within( dialog ).findByText( 'Mollie is not connected.' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Create live test payment',
			} )
		).toBeDisabled();
		expect( createCalls() ).toHaveLength( 0 );

		expect( console ).toHaveLogged();
	} );
} );
