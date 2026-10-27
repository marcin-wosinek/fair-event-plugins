/**
 * Component tests for the connection overview section (#1208) and the
 * connect/reconnect/disconnect/mode-change controls, which no longer collect
 * an administrator-supplied audit reason (#1575).
 *
 * Exercises:
 *   - Connected: profile name, enabled methods, and the "manage in Mollie" link render.
 *   - Disconnected: none of the overview section renders.
 *   - Error: the overview section shows a warning while the rest of the
 *     connected controls (mode switch, disconnect) still render.
 *   - Connect: the button is enabled immediately and requests the OAuth
 *     state with no reason.
 *   - Mode change: a Save button only appears once the mode actually differs,
 *     and is enabled immediately.
 *   - Disconnect (#1773): the dialog names the Mollie profile and account
 *     (with a fallback), explains the effect, posts once to oauth/disconnect
 *     (not /wp/v2/settings) with no reason, keeps failures in the dialog,
 *     and treats a missing audit entry as a completed disconnect.
 *   - Stale overview (#1773): an answer for an earlier mode never replaces
 *     the current profile name, and the earlier mode's overview is gone in
 *     the same render that shows the new mode (#2066).
 *   - Settlement access (#1693): the authorization asks for it only when the
 *     site wants it, a connection missing it offers a reconnect that never
 *     disconnects, and nothing is shown when it is granted or not wanted.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
// React comes with @wordpress/element, which does not re-export Profiler.
// eslint-disable-next-line import/no-extraneous-dependencies
import { Profiler } from 'react';
import apiFetch from '@wordpress/api-fetch';
import ConnectionTab from '../ConnectionTab.js';
import { buildAuthorizeUrl } from '../settings-api.js';

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

function mockApiFetchFor( {
	connected,
	overview,
	overviewError,
	oauthStatus,
} ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-payments-connector/v1/oauth/status' ) {
			return oauthStatus
				? Promise.resolve( oauthStatus )
				: Promise.reject( new Error( 'No route' ) );
		}
		if ( path === '/fair-payments-connector/v1/oauth/state' ) {
			return Promise.resolve( {
				state: 'test-state',
				request_settlement_access: true,
			} );
		}
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
			screen.getByRole( 'button', { name: 'Disconnect Mollie' } )
		).toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — connect', () => {
	it( 'requests the OAuth state with no reason as soon as Connect is clicked', async () => {
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
		expect( connectButton ).toBeEnabled();

		// jsdom has no real navigation; only assert the state request itself.
		fireEvent.click( connectButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/state',
					method: 'POST',
				} )
			);
		} );

		const stateCall = apiFetch.mock.calls.find(
			( [ options ] ) =>
				options.path === '/fair-payments-connector/v1/oauth/state'
		);
		expect( stateCall[ 0 ] ).not.toHaveProperty( 'data' );

		expect( console ).toHaveLogged();
		// jsdom doesn't implement real navigation; the component's
		// window.location.href assignment after a successful state fetch
		// logs this as an expected limitation of the test environment.
		expect( console ).toHaveErrored();
	} );
} );

describe( 'ConnectionTab — mode change', () => {
	it( 'only shows Save mode once the mode differs, enabled immediately, with no reason sent', async () => {
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
		expect( saveModeButton ).toBeEnabled();

		fireEvent.click( saveModeButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/settings',
					method: 'POST',
					data: {
						settings: { fair_payment_mode: 'live' },
					},
				} )
			);
		} );

		expect( console ).toHaveLogged();
	} );
} );

/**
 * Mock apiFetch for the disconnect flow. `disconnect` decides the answer to
 * the disconnect request; every other request answers like a connected site.
 *
 * @param {Object}   args
 * @param {Function} args.disconnect Returns the disconnect response promise.
 * @param {Object}   args.overview   Overview response, or null to fail it.
 * @param {Object}   args.settings   Settings response.
 */
function mockDisconnectFlow( {
	disconnect,
	overview = OVERVIEW,
	settings = CONNECTED_SETTINGS,
} ) {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-payments-connector/v1/oauth/disconnect' ) {
			return disconnect();
		}
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( settings );
		}
		if ( path === '/fair-payments-connector/v1/connection/overview' ) {
			return overview
				? Promise.resolve( overview )
				: Promise.reject( new Error( 'Mollie unreachable' ) );
		}
		return Promise.reject( new Error( 'No route' ) );
	} );
}

const disconnectCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) =>
			options.path === '/fair-payments-connector/v1/oauth/disconnect'
	);

async function openDisconnectDialog() {
	// Wait for the profile name so the dialog can name it.
	await screen.findByText( 'Disconnect Mollie', { selector: 'button' } );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Disconnect Mollie' } )
	);
	return screen.findByRole( 'dialog' );
}

describe( 'ConnectionTab — disconnect', () => {
	it( 'names the Mollie profile and account and explains the effect', async () => {
		mockDisconnectFlow( { disconnect: () => Promise.resolve( {} ) } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);
		await screen.findByText( 'My Webshop' );

		const dialog = await openDisconnectDialog();

		expect(
			within( dialog ).getByText(
				'Disconnect this site from the Mollie profile "My Webshop"?'
			)
		).toBeInTheDocument();
		expect( within( dialog ).getByText( 'pfl_123' ) ).toBeInTheDocument();
		expect( within( dialog ).getByText( 'org_123' ) ).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				/cannot create new Mollie payments .* until you reconnect\. Payments already in Mollie are not cancelled or refunded\./
			)
		).toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );

	it( 'falls back to "the connected Mollie account" when no identity is known', async () => {
		mockDisconnectFlow( {
			disconnect: () => Promise.resolve( {} ),
			overview: null,
			settings: {
				...CONNECTED_SETTINGS,
				fair_payment_organization_id: '',
				fair_payment_mollie_profile_id: '',
			},
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const dialog = await openDisconnectDialog();

		expect(
			within( dialog ).getByText(
				'Disconnect this site from the connected Mollie account?'
			)
		).toBeInTheDocument();
		expect( within( dialog ).queryByText( 'Profile ID:' ) ).toBeNull();

		expect( console ).toHaveLogged();
	} );

	it( 'cancelling sends nothing', async () => {
		mockDisconnectFlow( { disconnect: () => Promise.resolve( {} ) } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const dialog = await openDisconnectDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( disconnectCalls() ).toHaveLength( 0 );

		expect( console ).toHaveLogged();
	} );

	it( 'posts once to oauth/disconnect with no reason, staying busy until it answers', async () => {
		let resolveDisconnect;
		const onNotice = jest.fn();
		mockDisconnectFlow( {
			disconnect: () =>
				new Promise( ( resolve ) => {
					resolveDisconnect = resolve;
				} ),
		} );
		render(
			<ConnectionTab onNotice={ onNotice } shouldReload={ false } />
		);

		const dialog = await openDisconnectDialog();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Disconnect Mollie',
		} );
		fireEvent.click( confirm );
		fireEvent.click( confirm );

		expect(
			await within( dialog ).findByRole( 'button', {
				name: 'Disconnecting…',
			} )
		).toBeDisabled();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		expect( disconnectCalls() ).toHaveLength( 1 );
		expect( disconnectCalls()[ 0 ][ 0 ] ).not.toHaveProperty( 'data' );

		resolveDisconnect( { success: true } );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'success',
			message: 'Disconnected from Mollie.',
		} );
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/wp/v2/settings',
				method: 'POST',
			} )
		);

		expect( console ).toHaveLogged();
	} );

	it( 'keeps the dialog open with the error when disconnecting fails', async () => {
		mockDisconnectFlow( {
			disconnect: () =>
				Promise.reject( { code: 'oops', message: 'Server exploded' } ),
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		const dialog = await openDisconnectDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Mollie',
			} )
		);

		expect(
			await within( dialog ).findByText( 'Server exploded' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Mollie',
			} )
		).toBeEnabled();

		expect( console ).toHaveLogged();
	} );

	it( 'reports a missing audit entry as a completed disconnect, not a retry', async () => {
		const onNotice = jest.fn();
		mockDisconnectFlow( {
			disconnect: () =>
				Promise.reject( {
					code: 'audit_log_failed',
					message:
						'Disconnected, but the audit entry could not be recorded.',
				} ),
		} );
		render(
			<ConnectionTab onNotice={ onNotice } shouldReload={ false } />
		);

		const dialog = await openDisconnectDialog();
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Mollie',
			} )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'warning',
			message: 'Disconnected, but the audit entry could not be recorded.',
		} );
		// Settings are reloaded to show the disconnected state.
		await waitFor( () =>
			expect(
				apiFetch.mock.calls.filter(
					( [ options ] ) => options.path === '/wp/v2/settings'
				).length
			).toBeGreaterThan( 1 )
		);

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — stale overview', () => {
	it( 'ignores an overview answer for an earlier mode', async () => {
		const pending = [];
		let mode = 'test';
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/wp/v2/settings' ) {
				return Promise.resolve( {
					...CONNECTED_SETTINGS,
					fair_payment_mode: mode,
				} );
			}
			if ( path === '/fair-payments-connector/v1/settings' && method ) {
				mode = 'live';
				return Promise.resolve( {} );
			}
			if ( path === '/fair-payments-connector/v1/connection/overview' ) {
				return new Promise( ( resolve ) => pending.push( resolve ) );
			}
			return Promise.reject( new Error( 'No route' ) );
		} );

		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		fireEvent.click( await screen.findByLabelText( 'Live Mode' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save mode' } ) );
		await waitFor( () => expect( pending ).toHaveLength( 2 ) );

		pending[ 1 ]( { ...OVERVIEW, profile_name: 'Live profile' } );
		expect( await screen.findByText( 'Live profile' ) ).toBeInTheDocument();
		pending[ 0 ]( { ...OVERVIEW, profile_name: 'Old test profile' } );

		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect( screen.queryByText( 'Old test profile' ) ).toBeNull();
		expect( screen.getByText( 'Live profile' ) ).toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — overview after a mode change', () => {
	it( 'never shows the earlier mode’s overview next to the new mode', async () => {
		let mode = 'test';
		const pending = [];
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/wp/v2/settings' ) {
				return Promise.resolve( {
					...CONNECTED_SETTINGS,
					fair_payment_mode: mode,
				} );
			}
			if ( path === '/fair-payments-connector/v1/settings' && method ) {
				mode = 'live';
				return Promise.resolve( {} );
			}
			if ( path === '/fair-payments-connector/v1/connection/overview' ) {
				return 'test' === mode
					? Promise.resolve( {
							...OVERVIEW,
							profile_name: 'Test profile',
						} )
					: new Promise( ( resolve ) => pending.push( resolve ) );
			}
			return Promise.reject( new Error( 'No route' ) );
		} );

		// Checked after every commit, before effects run.
		const stale = [];
		const onRender = () => {
			const text = document.body.textContent;
			if (
				text.includes( 'Live mode: this creates' ) &&
				text.includes( 'Test profile' )
			) {
				stale.push( 'Test profile' );
			}
		};
		render(
			<Profiler id="connection" onRender={ onRender }>
				<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
			</Profiler>
		);
		expect( await screen.findByText( 'Test profile' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByLabelText( 'Live Mode' ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save mode' } ) );
		expect(
			await screen.findByText( /Live mode: this creates/ )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Test profile' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( 'Loading payment methods…' )
		).toBeInTheDocument();

		await waitFor( () => expect( pending ).toHaveLength( 1 ) );
		pending[ 0 ]( { ...OVERVIEW, profile_name: 'Live profile' } );
		expect( await screen.findByText( 'Live profile' ) ).toBeInTheDocument();
		expect( stale ).toEqual( [] );

		expect( console ).toHaveLogged();
	} );
} );

describe( 'buildAuthorizeUrl — requested permissions (#1693)', () => {
	it( 'does not mention settlement access unless the site asks for it', () => {
		const url = new URL(
			buildAuthorizeUrl( {
				state: 'abc',
				requestSettlementAccess: false,
			} )
		);

		expect( url.origin + url.pathname ).toBe(
			'https://fair-event-plugins.com/oauth/authorize'
		);
		expect( url.searchParams.get( 'state' ) ).toBe( 'abc' );
		expect( url.searchParams.has( 'settlement_access' ) ).toBe( false );
		expect( url.searchParams.has( 'scope' ) ).toBe( false );
	} );

	it( 'passes a bounded flag, not a scope list, when settlement access is wanted', () => {
		const url = new URL(
			buildAuthorizeUrl( { state: 'abc', requestSettlementAccess: true } )
		);

		expect( url.searchParams.get( 'settlement_access' ) ).toBe( '1' );
		expect( url.searchParams.has( 'scope' ) ).toBe( false );
		expect( url.searchParams.get( 'return_url' ) ).toMatch(
			/\?page=fair-payments-connector-settings$/
		);
	} );
} );

describe( 'ConnectionTab — settlement access (#1693)', () => {
	const SETTLEMENT_NOTICE =
		'Mollie has not authorized this site to read settlements yet.';
	// A Notice also announces its text through an a11y live region.
	const NOTICE_CONTENT = {
		exact: false,
		selector: '.components-notice__content',
	};

	it( 'explains the missing permission and reconnects without disconnecting', async () => {
		mockApiFetchFor( {
			connected: true,
			overview: OVERVIEW,
			oauthStatus: {
				connected: true,
				settlement_access: false,
				settlement_access_requested: true,
			},
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect(
			await screen.findByText( SETTLEMENT_NOTICE, NOTICE_CONTENT )
		).toBeInTheDocument();
		// The existing connection is still shown as usable.
		expect( screen.getByText( 'Connected to Mollie' ) ).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Reconnect to Mollie' } )
		);

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/state',
					method: 'POST',
				} )
			);
		} );
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-payments-connector/v1/oauth/disconnect',
			} )
		);

		expect( console ).toHaveLogged();
		// jsdom can't follow the redirect to the authorization page.
		expect( console ).toHaveErrored();
	} );

	it( 'always offers Reconnect on a connected site, without disconnecting', async () => {
		mockApiFetchFor( {
			connected: true,
			overview: OVERVIEW,
			oauthStatus: {
				connected: true,
				settlement_access: false,
				settlement_access_requested: false,
			},
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Reconnect' } )
		);

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/state',
				} )
			);
		} );
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-payments-connector/v1/oauth/disconnect',
			} )
		);
		// Nothing on this site wants settlement access, so nothing asks for it.
		expect(
			screen.queryByText( SETTLEMENT_NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();

		expect( console ).toHaveLogged();
		expect( console ).toHaveErrored();
	} );

	it( 'shows the permission as authorized once Mollie granted it', async () => {
		mockApiFetchFor( {
			connected: true,
			overview: OVERVIEW,
			oauthStatus: {
				connected: true,
				settlement_access: true,
				settlement_access_requested: true,
			},
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect(
			await screen.findByText( 'Settlement access: authorized' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( SETTLEMENT_NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );

	it( 'keeps the connected controls when the status cannot be loaded', async () => {
		mockApiFetchFor( { connected: true, overview: OVERVIEW } );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);

		expect(
			await screen.findByRole( 'button', { name: 'Disconnect Mollie' } )
		).toBeInTheDocument();
		expect(
			screen.queryByText( SETTLEMENT_NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();

		expect( console ).toHaveLogged();
	} );
} );

describe( 'ConnectionTab — stored credentials that cannot be read (#1318)', () => {
	const SUPPORT_LOST =
		'Payments are paused: the Mollie connection is stored encrypted';
	const UNRECOVERABLE =
		'Payments are paused: the stored Mollie connection can no longer be read';
	// Notices repeat their text in an a11y live region; match the notice.
	const IN_NOTICE = {
		exact: false,
		selector: '.components-notice__content',
	};

	function renderWithCredentialStatus( credentialStatus ) {
		mockApiFetchFor( {
			connected: true,
			overview: OVERVIEW,
			oauthStatus: {
				connected: true,
				credential_status: credentialStatus,
				settlement_access: false,
				settlement_access_requested: false,
			},
		} );
		render(
			<ConnectionTab onNotice={ () => {} } shouldReload={ false } />
		);
	}

	function overviewRequests() {
		return apiFetch.mock.calls.filter(
			( [ { path } ] ) =>
				path === '/fair-payments-connector/v1/connection/overview'
		);
	}

	it( 'explains lost encryption support and pauses actions that need the tokens', async () => {
		renderWithCredentialStatus( 'encryption_unavailable' );

		expect(
			await screen.findByText( SUPPORT_LOST, IN_NOTICE )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Connected to Mollie', IN_NOTICE )
		).not.toBeInTheDocument();
		await waitFor( () =>
			expect( screen.queryByText( 'My Webshop' ) ).not.toBeInTheDocument()
		);

		expect(
			screen.getByRole( 'button', { name: 'Create test payment' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Refresh Connection' } )
		).toBeDisabled();
		// Reconnecting would store plaintext over the encrypted tokens.
		expect(
			screen.getByRole( 'button', { name: 'Reconnect' } )
		).toBeDisabled();
		expect(
			screen.getByText(
				'Reconnect and Refresh Connection are unavailable until encryption support is restored.',
				{ exact: false }
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Test payments are paused until the stored Mollie connection can be read again.'
			)
		).toBeInTheDocument();
		// Disconnecting stays possible.
		expect(
			screen.getByRole( 'button', { name: 'Disconnect Mollie' } )
		).toBeEnabled();

		expect( console ).toHaveLogged();
	} );

	it( 'offers a reconnect for an unrecoverable connection', async () => {
		renderWithCredentialStatus( 'unrecoverable' );

		const notice = (
			await screen.findByText( UNRECOVERABLE, IN_NOTICE )
		).closest( '.components-notice' );
		expect(
			screen.getByRole( 'button', { name: 'Create test payment' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Refresh Connection' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Reconnect' } )
		).toBeEnabled();

		fireEvent.click(
			within( notice ).getByRole( 'button', {
				name: 'Reconnect to Mollie',
			} )
		);
		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/oauth/state',
				} )
			)
		);
		// Reconnecting never disconnects first.
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-payments-connector/v1/oauth/disconnect',
			} )
		);

		expect( console ).toHaveLogged();
		// jsdom can't follow the redirect to the authorization page.
		expect( console ).toHaveErrored();
	} );

	it( 'shows the usual connected state when the tokens are available', async () => {
		renderWithCredentialStatus( 'available' );

		expect( await screen.findByText( 'My Webshop' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Connected to Mollie', IN_NOTICE )
		).toBeInTheDocument();
		expect(
			screen.queryByText( SUPPORT_LOST, IN_NOTICE )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Create test payment' } )
		).toBeEnabled();
		expect( overviewRequests().length ).toBeGreaterThan( 0 );

		expect( console ).toHaveLogged();
	} );
} );
