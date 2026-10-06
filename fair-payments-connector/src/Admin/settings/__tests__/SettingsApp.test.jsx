/**
 * Component tests for the OAuth callback handled by the settings page
 * (#1693): a completed authorization is saved together with the permissions
 * Mollie granted, a cancelled or failed one saves nothing, and the callback
 * parameters never stay in the address bar.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	act,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SettingsApp from '../SettingsApp.js';

jest.mock( '@wordpress/api-fetch' );
// The tabs load their own data; the callback handling is what's under test.
// The page's pre-existing tab-selection logging is expected in every test.
jest.mock( '../ConnectionTab', () => () => <div>Connection tab</div> );
jest.mock( '../ApiTokensTab.js', () => () => <div>API tokens tab</div> );

const CALLBACK_PATH = '/fair-payments-connector/v1/oauth/callback';
const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-payments-connector-settings';

function openSettingsWith( params ) {
	window.history.replaceState(
		{},
		'',
		SETTINGS_URL + '&' + new URLSearchParams( params ).toString()
	);
	render( <SettingsApp /> );
}

// A Notice also announces its text through an a11y live region.
function findNotice( text ) {
	return screen.findByText( text, {
		selector: '.components-notice__content',
	} );
}

function callbackCalls() {
	return apiFetch.mock.calls.filter(
		( [ options ] ) => options.path === CALLBACK_PATH
	);
}

const TOKENS = {
	mollie_access_token: 'access_new',
	mollie_refresh_token: 'refresh_new',
	mollie_expires_in: '3600',
	mollie_organization_id: 'org_1',
	mollie_profile_id: 'pfl_1',
	mollie_test_mode: '1',
	state: 'state-1',
};

afterEach( () => {
	jest.clearAllMocks();
	window.history.replaceState( {}, '', SETTINGS_URL );
	delete window.fairPaymentsConnectorSettings;
} );

// TabPanel selects its first tab asynchronously after mounting.
async function renderSettled() {
	render( <SettingsApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Connection' } )
		).toHaveAttribute( 'aria-selected', 'true' )
	);
}

describe( 'SettingsApp — API Tokens tab (#1747)', () => {
	it( 'appends the tab when this plugin serves API tokens', async () => {
		window.fairPaymentsConnectorSettings = { apiTokensEnabled: '1' };

		await renderSettled();

		expect(
			screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent )
		).toEqual( [
			'Connection',
			'Payment Methods',
			'Currency',
			'Audit Log',
			'API Tokens',
		] );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'tab', { name: 'API Tokens' } )
			);
		} );
		expect(
			await screen.findByText( 'API tokens tab' )
		).toBeInTheDocument();
		expect( console ).toHaveLogged();
	} );

	it.each( [
		[ 'another plugin owns API tokens', { apiTokensEnabled: '' } ],
		[ 'the page was given no bootstrap data', undefined ],
	] )( 'leaves the tab out when %s', async ( _reason, bootstrap ) => {
		window.fairPaymentsConnectorSettings = bootstrap;

		await renderSettled();

		expect(
			screen.queryByRole( 'tab', { name: 'API Tokens' } )
		).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 4 );
		expect( console ).toHaveLogged();
	} );
} );

describe( 'SettingsApp — OAuth callback (#1693)', () => {
	it( 'saves the tokens with the granted scope and cleans the address bar', async () => {
		apiFetch.mockResolvedValue( { success: true } );

		openSettingsWith( {
			...TOKENS,
			mollie_scope: 'payments.read settlements.read',
		} );

		expect(
			await findNotice( 'Successfully connected to Mollie!' )
		).toBeInTheDocument();

		expect( callbackCalls() ).toHaveLength( 1 );
		expect( callbackCalls()[ 0 ][ 0 ] ).toEqual( {
			path: CALLBACK_PATH,
			method: 'POST',
			data: {
				state: 'state-1',
				access_token: 'access_new',
				refresh_token: 'refresh_new',
				expires_in: 3600,
				organization_id: 'org_1',
				profile_id: 'pfl_1',
				test_mode: true,
				scope: 'payments.read settlements.read',
			},
		} );
		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-settings'
		);
		expect( console ).toHaveLogged();
	} );

	it( 'sends an empty scope when the platform reported none', async () => {
		apiFetch.mockResolvedValue( { success: true } );

		openSettingsWith( TOKENS );

		await waitFor( () => expect( callbackCalls() ).toHaveLength( 1 ) );
		expect( callbackCalls()[ 0 ][ 0 ].data.scope ).toBe( '' );
		expect( console ).toHaveLogged();
	} );

	it( 'saves nothing when the authorization was cancelled', async () => {
		openSettingsWith( {
			error: 'access_denied',
			error_description: 'The user cancelled',
			state: 'state-1',
		} );

		expect(
			await findNotice(
				'Authorization cancelled. Nothing was changed, so an existing Mollie connection keeps working.'
			)
		).toBeInTheDocument();
		expect( callbackCalls() ).toHaveLength( 0 );
		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-settings'
		);
		expect( console ).toHaveLogged();
	} );

	it( 'reports another authorization error by its code only', async () => {
		openSettingsWith( {
			error: 'token_exchange_failed',
			error_description: 'Click https://example.test to fix',
			state: 'state-1',
		} );

		expect(
			await findNotice(
				'Mollie authorization failed (token_exchange_failed). Nothing was changed, so an existing Mollie connection keeps working.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'https://example.test', { exact: false } )
		).not.toBeInTheDocument();
		expect( callbackCalls() ).toHaveLength( 0 );
		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-settings'
		);
		expect( console ).toHaveLogged();
	} );

	it( 'shows the server rejection and still cleans the address bar', async () => {
		apiFetch.mockRejectedValue(
			new Error( 'Invalid or expired OAuth state.' )
		);

		openSettingsWith( TOKENS );

		expect(
			await findNotice(
				'Failed to save OAuth tokens: Invalid or expired OAuth state.'
			)
		).toBeInTheDocument();
		expect( window.location.search ).toBe(
			'?page=fair-payments-connector-settings'
		);
		expect( console ).toHaveLogged();
	} );
} );
