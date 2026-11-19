/**
 * @jest-environment jsdom
 *
 * The Instagram tab while Fair Audience holds the connection (#2427):
 * connecting moved to Fair Events → Instagram, so the tab offers no token
 * entry, shows whether a stored connection must be reconnected, and keeps
 * the confirmed disconnect (#1776): an in-page popup naming the account,
 * never the browser's confirm box; a failure stays in the popup; a second
 * click while disconnecting sends nothing more.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import InstagramTab from '../InstagramTab.js';
import { loadInstagramSettings, saveSettings } from '../settings-api.js';

jest.mock( '../settings-api.js' );

const CONNECTED = {
	connected: true,
	credentialStatus: 'available',
	credentialMessage: '',
	reconnectRequired: false,
	username: 'fair_demo_studio',
	userId: '17840000000000000',
	tokenExpires: null,
};

const CLEARED = {
	fair_audience_instagram_access_token: '',
	fair_audience_instagram_user_id: '',
	fair_audience_instagram_username: '',
	fair_audience_instagram_token_expires: 0,
	fair_audience_instagram_connected: false,
};

async function renderTab( settings = CONNECTED, props = {} ) {
	loadInstagramSettings.mockResolvedValue( settings );
	const onNotice = jest.fn();
	render( <InstagramTab onNotice={ onNotice } { ...props } /> );
	await screen.findByText( 'Instagram Connection' );
	return { onNotice };
}

async function openDisconnect( settings = CONNECTED ) {
	const { onNotice } = await renderTab( settings );
	fireEvent.click( screen.getByRole( 'button', { name: 'Disconnect' } ) );
	const dialog = await screen.findByRole( 'dialog', {
		name: 'Disconnect Instagram?',
	} );
	return { dialog, onNotice };
}

beforeEach( () => {
	jest.spyOn( window, 'confirm' ).mockImplementation( () => true );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.resetAllMocks();
} );

describe( 'InstagramTab', () => {
	it( 'offers no way to enter a token and says where to connect', async () => {
		await renderTab(
			{ ...CONNECTED, connected: false, username: '', userId: '' },
			{
				setupUrl:
					'/wp-admin/admin.php?page=fair-events-settings&tab=experimental',
			}
		);

		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /Connect/ } )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( 'No Instagram account is connected.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'Open Fair Events → Settings → Experimental',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-settings&tab=experimental'
		);
	} );

	it( 'asks a connection from before Unified Login to reconnect', async () => {
		await renderTab( { ...CONNECTED, reconnectRequired: true } );

		expect(
			screen.getAllByText( /Instagram needs to be reconnected/ )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Connected to Instagram as @fair_demo_studio.' )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( 'Stored account: @fair_demo_studio' )
		).toBeInTheDocument();
	} );

	it( 'shows a usable connection', async () => {
		await renderTab();

		expect(
			screen.getAllByText(
				'Connected to Instagram as @fair_demo_studio.'
			)[ 0 ]
		).toBeInTheDocument();
	} );
} );

describe( 'InstagramTab disconnect', () => {
	it( 'names the account in an in-page popup', async () => {
		const { dialog } = await openDisconnect();

		expect(
			within( dialog ).getByText(
				'Disconnect the Instagram account @fair_demo_studio from this site?'
			)
		).toBeInTheDocument();
		expect( window.confirm ).not.toHaveBeenCalled();
	} );

	it( 'falls back to the account ID', async () => {
		const { dialog } = await openDisconnect( {
			...CONNECTED,
			username: '',
		} );

		expect(
			within( dialog ).getByText(
				'Disconnect the Instagram account with ID 17840000000000000 from this site?'
			)
		).toBeInTheDocument();
	} );

	it( 'keeping the connection changes nothing', async () => {
		const { dialog } = await openDisconnect();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Keep connected' } )
		);

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
		expect( saveSettings ).not.toHaveBeenCalled();
	} );

	it( 'clears the connection once, even on a double click', async () => {
		let resolve;
		saveSettings.mockImplementation(
			() =>
				new Promise( ( done ) => {
					resolve = done;
				} )
		);
		const { dialog, onNotice } = await openDisconnect();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Disconnect Instagram',
		} );

		fireEvent.click( confirm );
		fireEvent.click( confirm );

		expect( saveSettings ).toHaveBeenCalledTimes( 1 );
		expect( saveSettings ).toHaveBeenCalledWith( CLEARED );

		resolve( {} );
		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message: 'Disconnected from Instagram.',
			} )
		);
		expect( loadInstagramSettings ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps the popup open with the error on failure', async () => {
		saveSettings.mockRejectedValue( { message: 'Forbidden.' } );
		const { dialog } = await openDisconnect();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Instagram',
			} )
		);

		expect(
			await within( dialog ).findByText(
				'Instagram could not be disconnected: Forbidden.'
			)
		).toBeInTheDocument();
		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
	} );
} );
