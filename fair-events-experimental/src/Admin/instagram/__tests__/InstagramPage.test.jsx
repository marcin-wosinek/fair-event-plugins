/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import InstagramPage from '../InstagramPage.js';

jest.mock( '@wordpress/api-fetch' );

function details( overrides ) {
	return {
		connected: true,
		usable: true,
		credential_status: 'available',
		credentials_encrypted: true,
		message: '',
		user_id: '17841400123456789',
		username: 'demo_events',
		token_expires: 1900000000,
		managed_here: true,
		legacy_manage_url: null,
		...overrides,
	};
}

async function renderPage() {
	await act( async () => {
		render( <InstagramPage /> );
	} );
}

describe( 'InstagramPage', () => {
	beforeEach( () => {
		window.fairEventsInstagramData = {
			pageUrl:
				'http://localhost/wp-admin/admin.php?page=fair-events-instagram',
			authorizeUrl:
				'https://fair-event-plugins.com/oauth/instagram/authorize',
		};
		window.history.replaceState(
			{},
			'',
			'/wp-admin/admin.php?page=fair-events-instagram'
		);
		apiFetch.mockReset();
	} );

	it( 'shows the connected account without asking to reconnect', async () => {
		apiFetch.mockResolvedValueOnce( details() );
		await renderPage();

		expect(
			screen.getAllByText(
				'Connected to Instagram as @demo_events.'
			)[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Instagram user ID' ) ).toHaveValue(
			'17841400123456789'
		);
		expect(
			screen.queryByRole( 'button', { name: 'Connect with Instagram' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers OAuth and a manual token when not connected', async () => {
		apiFetch.mockResolvedValueOnce(
			details( { connected: false, usable: false, username: '' } )
		);
		await renderPage();

		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save access token' } )
		).toBeDisabled();
		expect(
			screen.getByText( 'Enter a token to save it.' )
		).toBeInTheDocument();
	} );

	it( 'saves a manual token through the connection API', async () => {
		apiFetch
			.mockResolvedValueOnce(
				details( { connected: false, usable: false } )
			)
			.mockResolvedValueOnce( details( { username: '' } ) );
		await renderPage();

		fireEvent.change( screen.getByLabelText( 'Access token' ), {
			target: { value: ' IGtoken ' },
		} );
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Save access token' } )
			);
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/instagram/connection',
			method: 'POST',
			data: {
				access_token: 'IGtoken',
				user_id: '',
				username: '',
				expires_in: null,
			},
		} );
		expect(
			screen.getByText(
				'Access token saved. Test the connection to load the account details.'
			)
		).toBeInTheDocument();
	} );

	it( 'stores an OAuth return and removes the token from the address bar', async () => {
		window.history.replaceState(
			{},
			'',
			'/wp-admin/admin.php?page=fair-events-instagram&instagram_access_token=IGoauth&instagram_user_id=178&instagram_username=demo_events&instagram_expires_in=5184000'
		);
		apiFetch.mockResolvedValueOnce( details() );
		await renderPage();

		expect( window.location.search ).toBe( '?page=fair-events-instagram' );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events-experimental/v1/instagram/connection',
			method: 'POST',
			data: {
				access_token: 'IGoauth',
				user_id: '178',
				username: 'demo_events',
				expires_in: 5184000,
			},
		} );
		expect(
			screen.getByText( 'Connected to Instagram.' )
		).toBeInTheDocument();
	} );

	it( 'explains an older Fair Audience still manages the connection', async () => {
		apiFetch.mockResolvedValueOnce(
			details( {
				managed_here: false,
				legacy_manage_url:
					'/wp-admin/admin.php?page=fair-audience-settings',
			} )
		);
		await renderPage();

		expect(
			screen.getByRole( 'link', {
				name: 'Open Fair Audience → Settings → Instagram',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-audience-settings'
		);
		expect(
			screen.queryByRole( 'button', { name: 'Disconnect' } )
		).not.toBeInTheDocument();
	} );

	it( 'asks for reconnection when the token is unreadable', async () => {
		apiFetch.mockResolvedValueOnce(
			details( {
				usable: false,
				credential_status: 'unrecoverable',
				message: 'Instagram needs to be reconnected.',
			} )
		);
		await renderPage();

		expect(
			screen.getAllByText( 'Instagram needs to be reconnected.' )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Disconnect' } )
		).toBeInTheDocument();
	} );

	it( 'names the account before disconnecting and keeps the dialog on failure', async () => {
		apiFetch
			.mockResolvedValueOnce( details() )
			.mockRejectedValueOnce( { message: 'Server unavailable.' } );
		await renderPage();

		fireEvent.click( screen.getByRole( 'button', { name: 'Disconnect' } ) );
		expect(
			screen.getByText( 'Disconnect @demo_events from this site?' )
		).toBeInTheDocument();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Disconnect Instagram' } )
			);
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/instagram/connection',
			method: 'DELETE',
		} );
		expect(
			screen.getAllByText( 'Server unavailable.' )[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Disconnect Instagram' } )
		).toBeEnabled();
	} );

	it( 'shows a failed test with Instagram’s details', async () => {
		apiFetch.mockResolvedValueOnce( details() ).mockRejectedValueOnce( {
			message: 'Instagram refused the access token.',
			data: { details: 'Invalid OAuth access token' },
		} );
		await renderPage();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Test connection' } )
			);
		} );

		expect(
			screen.getByText( 'Instagram refused the access token.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Invalid OAuth access token' )
		).toBeInTheDocument();
	} );
} );
