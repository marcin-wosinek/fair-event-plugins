/**
 * @jest-environment jsdom
 *
 * Disconnecting Instagram (#1776): the confirmation is an in-page popup
 * naming the account, never the browser's confirm box, and never shows the
 * access token. Keeping the connection changes nothing; a failure stays in
 * the popup; a second click while disconnecting sends nothing more.
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
import {
	loadInstagramSettings,
	saveSettings,
	testInstagramConnection,
} from '../settings-api.js';

jest.mock( '../settings-api.js' );

const CONNECTED = {
	connected: true,
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

async function openDisconnect( settings = CONNECTED ) {
	loadInstagramSettings.mockResolvedValue( settings );
	const onNotice = jest.fn();
	render( <InstagramTab onNotice={ onNotice } shouldReload={ false } /> );
	fireEvent.click(
		await screen.findByRole( 'button', { name: 'Disconnect' } )
	);
	const dialog = await screen.findByRole( 'dialog', {
		name: 'Disconnect Instagram?',
	} );
	return { dialog, onNotice };
}

beforeEach( () => {
	jest.spyOn( window, 'confirm' ).mockImplementation( () => true );
	testInstagramConnection.mockResolvedValue( {} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'InstagramTab — disconnect confirmation (#1776)', () => {
	it( 'names the account and explains what is removed and kept', async () => {
		const { dialog } = await openDisconnect();

		expect( window.confirm ).not.toHaveBeenCalled();
		expect( dialog ).toHaveTextContent(
			'Disconnect the Instagram account @fair_demo_studio from this site?'
		);
		expect( dialog ).toHaveTextContent(
			'The access token and connection details stored on this site are removed.'
		);
		expect( dialog ).toHaveTextContent(
			'Posts already published on Instagram, and the post records on this site, are kept.'
		);
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Instagram',
			} )
		).toBeInTheDocument();
	} );

	it( 'falls back to the account ID without a username', async () => {
		const { dialog } = await openDisconnect( {
			...CONNECTED,
			username: '',
		} );

		expect( dialog ).toHaveTextContent(
			'Disconnect the Instagram account with ID 17840000000000000 from this site?'
		);
	} );

	it( 'says the account identity is unavailable without username and ID', async () => {
		const { dialog } = await openDisconnect( {
			...CONNECTED,
			username: '',
			userId: '',
		} );

		expect( dialog ).toHaveTextContent(
			'Disconnect the Instagram account connected to this site? Its username and ID are not available.'
		);
	} );

	it( 'keeps the connection when the organizer changes their mind', async () => {
		const { dialog } = await openDisconnect();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Keep connected' } )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( saveSettings ).not.toHaveBeenCalled();
	} );

	it( 'disconnects once, reloads and reports it', async () => {
		let finish;
		saveSettings.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
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
		expect(
			within( dialog ).getByRole( 'button', { name: 'Keep connected' } )
		).toBeDisabled();

		loadInstagramSettings.mockResolvedValue( {
			connected: false,
			username: '',
			userId: '',
			tokenExpires: null,
		} );
		finish( {} );

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'success',
			message: 'Disconnected from Instagram.',
		} );
		expect( loadInstagramSettings ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps the popup open with the error when disconnecting fails', async () => {
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
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Instagram',
			} )
		).toBeEnabled();
	} );
} );

describe( 'InstagramTab — unreadable stored token (#1319)', () => {
	const UNRECOVERABLE_MESSAGE =
		'Instagram needs to be reconnected: the stored access token can no longer be read.';
	const PAUSED_MESSAGE =
		'Instagram is paused: the access token is stored encrypted.';

	function renderWith( settings ) {
		loadInstagramSettings.mockResolvedValue( settings );
		const onNotice = jest.fn();
		render( <InstagramTab onNotice={ onNotice } shouldReload={ false } /> );
		return { onNotice };
	}

	it( 'offers reconnection and manual entry when the token is unrecoverable', async () => {
		saveSettings.mockResolvedValue( {} );
		const { onNotice } = renderWith( {
			...CONNECTED,
			credentialStatus: 'unrecoverable',
			credentialMessage: UNRECOVERABLE_MESSAGE,
		} );

		// Notice also announces its text in a live region.
		expect(
			await screen.findAllByText( UNRECOVERABLE_MESSAGE )
		).not.toHaveLength( 0 );
		expect(
			screen.queryByText( 'Connected to Instagram' )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Disconnect' } )
		).toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Access Token' ), {
			target: { value: ' new-token ' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save Token' } ) );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message: 'Instagram token saved successfully.',
			} )
		);
		expect( saveSettings ).toHaveBeenCalledWith(
			expect.objectContaining( {
				fair_audience_instagram_access_token: 'new-token',
				fair_audience_instagram_connected: true,
			} )
		);
	} );

	it( 'disconnects an unrecoverable token through the confirmation popup', async () => {
		saveSettings.mockResolvedValue( {} );
		renderWith( {
			...CONNECTED,
			credentialStatus: 'unrecoverable',
			credentialMessage: UNRECOVERABLE_MESSAGE,
		} );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Disconnect' } )
		);
		const dialog = await screen.findByRole( 'dialog', {
			name: 'Disconnect Instagram?',
		} );
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Disconnect Instagram',
			} )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( saveSettings ).toHaveBeenCalledWith( CLEARED );
	} );

	it( 'explains a temporary encryption outage without offering a new token', async () => {
		renderWith( {
			...CONNECTED,
			credentialStatus: 'encryption_unavailable',
			credentialMessage: PAUSED_MESSAGE,
		} );

		expect( await screen.findAllByText( PAUSED_MESSAGE ) ).not.toHaveLength(
			0
		);
		expect(
			screen.queryByText( 'Connected to Instagram' )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save Token' } )
		).not.toBeInTheDocument();
		expect( screen.getByText( '@fair_demo_studio' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Disconnect' } )
		).toBeInTheDocument();
	} );

	it( 'shows a readable connection as connected', async () => {
		renderWith( { ...CONNECTED, credentialStatus: 'available' } );

		expect(
			await screen.findAllByText( 'Connected to Instagram' )
		).not.toHaveLength( 0 );
	} );
} );
