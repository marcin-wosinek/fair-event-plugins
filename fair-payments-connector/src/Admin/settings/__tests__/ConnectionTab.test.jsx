/**
 * Component tests for the connection overview section (#1208) and the
 * mandatory audit reason on connect/reconnect/disconnect/mode-change (#1575).
 *
 * Exercises:
 *   - Connected: profile name, enabled methods, and the "manage in Mollie" link render.
 *   - Disconnected: none of the overview section renders.
 *   - Error: the overview section shows a warning while the rest of the
 *     connected controls (mode switch, disconnect) still render.
 *   - Connect: the button stays disabled until a reason is entered, and the
 *     reason is sent when requesting the OAuth state.
 *   - Mode change: a Save button only appears once the mode actually differs
 *     and stays disabled until a reason is entered.
 *   - Disconnect: the confirm dialog blocks on an empty reason and posts the
 *     reason to oauth/disconnect (not /wp/v2/settings) on confirm.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
	methods: [
		{ id: 'ideal', description: 'iDEAL', image: '' },
		{ id: 'creditcard', description: 'Credit card', image: '' },
	],
	manage_url: 'https://my.mollie.com/dashboard/',
};

function mockApiFetchFor( { connected, overview, overviewError } ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve(
				connected
					? CONNECTED_SETTINGS
					: { fair_payment_mollie_connected: false }
			);
		}
		if ( path === '/fair-payments-connector/v1/connection/overview' ) {
			if ( overviewError ) {
				return Promise.reject(
					new Error( 'Failed to load payment methods.' )
				);
			}
			return Promise.resolve( overview );
		}
		return Promise.resolve( {} );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ConnectionTab — connection overview', () => {
	it( 'shows profile name, enabled methods, and the manage link when connected', async () => {
		mockApiFetchFor( { connected: true, overview: OVERVIEW } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect( await screen.findByText( 'My Webshop' ) ).toBeInTheDocument();
		expect( screen.getByText( 'iDEAL' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Credit card' ) ).toBeInTheDocument();

		const link = screen.getByRole( 'link', {
			name: 'Manage payment methods in Mollie',
		} );
		expect( link ).toHaveAttribute(
			'href',
			'https://my.mollie.com/dashboard/'
		);
		expect( link ).toHaveAttribute( 'target', '_blank' );

		// Pre-existing settings-load logging and the @wordpress/components
		// ButtonGroup deprecation warning are expected, not under test here.
		expect( console ).toHaveLogged();
		expect( console ).toHaveWarned();
	} );

	it( 'renders nothing from the overview section when disconnected', async () => {
		mockApiFetchFor( { connected: false } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect(
			await screen.findByText( 'Connect your Mollie account', {
				exact: false,
			} )
		).toBeInTheDocument();
		expect( screen.queryByText( 'My Webshop' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', {
				name: 'Manage payment methods in Mollie',
			} )
		).not.toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );

	it( 'shows a warning but keeps the connected controls when the overview fetch fails', async () => {
		mockApiFetchFor( { connected: true, overviewError: true } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const notice = await screen.findByText(
			'Failed to load payment methods.',
			{ selector: '.components-notice__content' }
		);
		expect( notice ).toBeInTheDocument();

		// Rest of the connected view still renders.
		expect( screen.getByText( 'Mode' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Disconnect' } )
		).toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — connect requires a reason', () => {
	it( 'keeps Connect disabled until a reason is entered, then sends it with the state request', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path === '/wp/v2/settings' ) {
				return Promise.resolve( {
					fair_payment_mollie_connected: false,
				} );
			}
			if ( path === '/fair-payments-connector/v1/oauth/state' ) {
				return Promise.resolve( { state: 'test-state' } );
			}
			return Promise.resolve( {} );
		} );

		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const connectButton = await screen.findByRole( 'button', {
			name: 'Connect with Mollie',
		} );
		expect( connectButton ).toBeDisabled();

		fireEvent.change( screen.getByLabelText( /Reason for connecting/i ), {
			target: { value: 'Setting up payments for the first time.' },
		} );
		expect( connectButton ).toBeEnabled();

		// jsdom has no real navigation; only assert the state request itself.
		fireEvent.click( connectButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/state',
					method: 'POST',
					data: {
						reason: 'Setting up payments for the first time.',
					},
				} )
			);
		} );

		expect( console ).toHaveLogged();
		// jsdom doesn't implement real navigation; the component's
		// window.location.href assignment after a successful state fetch
		// logs this as an expected limitation of the test environment.
		expect( console ).toHaveErrored();
	} );
} );

describe( 'ConnectionTab — mode change requires a reason', () => {
	it( 'only shows Save mode once the mode differs, and requires a reason', async () => {
		mockApiFetchFor( { connected: true, overview: OVERVIEW } );

		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect(
			screen.queryByRole( 'button', { name: 'Save mode' } )
		).not.toBeInTheDocument();

		fireEvent.click(
			await screen.findByRole( 'radio', { name: 'Live Mode' } )
		);

		const saveModeButton = await screen.findByRole( 'button', {
			name: 'Save mode',
		} );
		expect( saveModeButton ).toBeDisabled();

		fireEvent.change(
			screen.getByLabelText( /Reason for the mode change/i ),
			{
				target: { value: 'Going live for the launch event.' },
			}
		);
		expect( saveModeButton ).toBeEnabled();

		fireEvent.click( saveModeButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/settings',
					method: 'POST',
					data: {
						settings: { fair_payment_mode: 'live' },
						reason: 'Going live for the launch event.',
					},
				} )
			);
		} );

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — disconnect', () => {
	it( 'blocks on an empty reason, then posts the reason to oauth/disconnect (not /wp/v2/settings) on confirm', async () => {
		mockApiFetchFor( { connected: true, overview: OVERVIEW } );

		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const disconnectButton = await screen.findByRole( 'button', {
			name: 'Disconnect',
		} );
		fireEvent.click( disconnectButton );

		const dialogConfirmButtons = await screen.findAllByRole( 'button', {
			name: 'Disconnect',
		} );
		const confirmButton =
			dialogConfirmButtons[ dialogConfirmButtons.length - 1 ];

		// Confirming with no reason must not call the API — it should
		// surface an inline validation error and keep the dialog open.
		fireEvent.click( confirmButton );
		expect(
			await screen.findByText( 'A reason is required to disconnect.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-payments-connector/v1/oauth/disconnect',
			} )
		);

		fireEvent.change(
			screen.getByLabelText( /Reason for disconnecting/i ),
			{
				target: { value: 'Retiring this Mollie account.' },
			}
		);
		fireEvent.click( confirmButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/disconnect',
					method: 'POST',
					data: { reason: 'Retiring this Mollie account.' },
				} )
			);
		} );

		// Disconnecting reloads settings — wait for that GET so its
		// console.log calls have already happened before asserting on them.
		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( { path: '/wp/v2/settings' } )
			);
		} );

		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/wp/v2/settings',
				method: 'POST',
			} )
		);

		expect( console ).toHaveLogged();
	} );
} );
