/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { navigate } from '../navigate.js';
import InstagramPage, {
	expiryText,
	ownershipNotice,
} from '../InstagramPage.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../navigate.js', () => ( { navigate: jest.fn() } ) );

function details( overrides ) {
	return {
		connected: true,
		usable: true,
		credential_status: 'available',
		credentials_encrypted: true,
		message: '',
		user_id: '17841400123456789',
		username: 'demo_events',
		connection_format: 'unified_login',
		token_type: 'system_user',
		scopes: [ 'instagram_basic', 'instagram_content_publish' ],
		token_expiry: 'never',
		token_expires: null,
		managed_here: true,
		ownership_reason: 'managed_here',
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
		expect(
			screen.getByText( 'Instagram account ID: 17841400123456789' )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'The access token does not expire. It stops working if the business removes the app in Meta Business Settings.'
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Connect with Instagram' } )
		).not.toBeInTheDocument();
	} );

	it( 'offers only the Unified Login connection when not connected', async () => {
		apiFetch.mockResolvedValueOnce(
			details( { connected: false, usable: false, username: '' } )
		);
		await renderPage();

		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save access token' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'textbox' ) ).not.toBeInTheDocument();
	} );

	it( 'starts connecting through the server and leaves for the authorize URL', async () => {
		apiFetch
			.mockResolvedValueOnce(
				details( { connected: false, usable: false } )
			)
			.mockResolvedValueOnce( {
				authorize_url:
					'https://fair-event-plugins.com/oauth/instagram/authorize?protocol=2',
			} );
		await renderPage();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Connect with Instagram' } )
			);
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/instagram/connection/authorize',
			method: 'POST',
		} );
		expect( navigate ).toHaveBeenCalledWith(
			'https://fair-event-plugins.com/oauth/instagram/authorize?protocol=2'
		);
	} );

	it( 'shows why connecting could not start and allows a retry', async () => {
		apiFetch
			.mockResolvedValueOnce(
				details( { connected: false, usable: false } )
			)
			.mockRejectedValueOnce( {
				message: 'Fair Events Experimental did not take over.',
			} );
		await renderPage();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Connect with Instagram' } )
			);
		} );

		expect(
			screen.getAllByText(
				'Fair Events Experimental did not take over.'
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeEnabled();
	} );

	it( 'completes a return on the server and removes the handoff code from the address bar', async () => {
		window.history.replaceState(
			{},
			'',
			'/wp-admin/admin.php?page=fair-events-instagram&instagram_handoff=hand-off_code&state=client-state'
		);
		apiFetch.mockResolvedValueOnce( details() );
		await renderPage();

		expect( window.location.search ).toBe( '?page=fair-events-instagram' );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events-experimental/v1/instagram/connection/complete',
			method: 'POST',
			data: {
				state: 'client-state',
				handoff: 'hand-off_code',
				error: '',
			},
		} );
		expect(
			screen.getAllByText( 'Connected to Instagram as @demo_events.' )
				.length
		).toBeGreaterThan( 0 );
	} );

	it( 'reports a cancelled authorization from the server and keeps the page usable', async () => {
		window.history.replaceState(
			{},
			'',
			'/wp-admin/admin.php?page=fair-events-instagram&instagram_error=cancelled&state=client-state'
		);
		apiFetch
			.mockRejectedValueOnce( {
				code: 'instagram_authorization_failed',
				message:
					'Instagram authorization was cancelled. Nothing was changed.',
			} )
			.mockResolvedValueOnce(
				details( { connected: false, usable: false } )
			);
		await renderPage();

		expect( window.location.search ).toBe( '?page=fair-events-instagram' );
		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/fair-events-experimental/v1/instagram/connection/complete',
			method: 'POST',
			data: { state: 'client-state', handoff: '', error: 'cancelled' },
		} );
		expect(
			screen.getAllByText(
				'Instagram authorization was cancelled. Nothing was changed.'
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
	} );

	it( 'asks a pre-upgrade connection to reconnect', async () => {
		apiFetch.mockResolvedValueOnce(
			details( {
				usable: false,
				credential_status: 'reconnect_required',
				connection_format: null,
				token_expiry: null,
				message:
					'Instagram needs to be reconnected: Meta replaced the way sites connect to Instagram.',
			} )
		);
		await renderPage();

		expect(
			screen.getAllByText(
				'Instagram needs to be reconnected: Meta replaced the way sites connect to Instagram.'
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Connect with Instagram' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Test connection' } )
		).not.toBeInTheDocument();
	} );

	it( 'describes each token lifetime', () => {
		expect( expiryText( { token_expiry: 'never' } ) ).toMatch(
			/does not expire/
		);
		expect(
			expiryText( {
				token_expiry: 'expires',
				token_expires: 1900000000,
			} )
		).toMatch( /not renewed automatically/ );
		expect( expiryText( { token_expiry: null } ) ).toBe(
			'The access token’s expiry is not known.'
		);
	} );

	it( 'explains an older Fair Audience still manages the connection', async () => {
		apiFetch.mockResolvedValueOnce(
			details( {
				managed_here: false,
				ownership_reason: 'audience_handoff_missing',
				legacy_manage_url:
					'/wp-admin/admin.php?page=fair-audience-settings',
			} )
		);
		await renderPage();

		expect(
			screen.getAllByText(
				/Fair Audience is older than this plugin/
			)[ 0 ]
		).toBeInTheDocument();

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

	it( 'does not blame Fair Audience when its update has not loaded', async () => {
		apiFetch.mockResolvedValueOnce(
			details( {
				managed_here: false,
				ownership_reason: 'audience_update_not_loaded',
				legacy_manage_url:
					'/wp-admin/admin.php?page=fair-audience-settings',
			} )
		);
		await renderPage();

		expect(
			screen.getAllByText(
				/Clear the PHP opcode cache or restart PHP/
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.queryByText( /older than this plugin/ )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'Open Fair Audience → Settings → Instagram',
			} )
		).toBeInTheDocument();
	} );

	it( 'treats a response without managed_here as incomplete', async () => {
		apiFetch.mockResolvedValueOnce( { connected: true } );
		await renderPage();

		expect(
			screen.getAllByText(
				/The site did not say who manages the Instagram connection/
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.queryByText( /older than this plugin/ )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Disconnect' } )
		).not.toBeInTheDocument();
	} );

	describe( 'ownershipNotice', () => {
		const notOwned = ( overrides ) => ( {
			managed_here: false,
			legacy_manage_url:
				'/wp-admin/admin.php?page=fair-audience-settings',
			...overrides,
		} );

		it( 'recommends updating Fair Audience only for a missing handoff', () => {
			const recommendsUpdate = ( connection ) =>
				ownershipNotice( connection ).messages.some( ( message ) =>
					message.includes( 'Update Fair Audience' )
				);

			expect(
				recommendsUpdate(
					notOwned( { ownership_reason: 'audience_handoff_missing' } )
				)
			).toBe( true );
			for ( const connection of [
				notOwned( { ownership_reason: 'audience_update_not_loaded' } ),
				notOwned( { ownership_reason: 'not_claimed' } ),
				notOwned( { ownership_reason: 'feature_disabled' } ),
				notOwned( { ownership_reason: 'something_new' } ),
				notOwned( {} ),
				{ ownership_reason: 'audience_handoff_missing' },
				{ managed_here: 'no' },
				null,
			] ) {
				expect( recommendsUpdate( connection ) ).toBe( false );
			}
		} );

		it( 'reports an absent or unknown reason as an error', () => {
			expect( ownershipNotice( notOwned( {} ) ).status ).toBe( 'error' );
			expect(
				ownershipNotice( notOwned( { ownership_reason: 42 } ) ).status
			).toBe( 'error' );
			expect(
				ownershipNotice(
					notOwned( { ownership_reason: 'not_claimed' } )
				).status
			).toBe( 'warning' );
		} );

		it( 'links to Fair Audience only with a usable link', () => {
			expect(
				ownershipNotice(
					notOwned( { ownership_reason: 'not_claimed' } )
				).showLegacyLink
			).toBe( true );
			expect(
				ownershipNotice(
					notOwned( {
						ownership_reason: 'not_claimed',
						legacy_manage_url: null,
					} )
				).showLegacyLink
			).toBe( false );
		} );
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

	it( 'keeps the controls after repeated successful tests', async () => {
		const testResult = ( username ) => ( {
			success: true,
			...details( { username } ),
			message: `The connection works: Meta confirmed the account @${ username }.`,
		} );
		apiFetch
			.mockResolvedValueOnce( details() )
			.mockResolvedValueOnce( testResult( 'renamed_events' ) )
			.mockResolvedValueOnce( testResult( 'renamed_again' ) );
		await renderPage();

		for ( const username of [ 'renamed_events', 'renamed_again' ] ) {
			await act( async () => {
				fireEvent.click(
					screen.getByRole( 'button', { name: 'Test connection' } )
				);
			} );

			expect( apiFetch ).toHaveBeenLastCalledWith( {
				path: '/fair-events-experimental/v1/instagram/connection/test',
				method: 'POST',
			} );
			expect(
				screen.getByText(
					`The connection works: Meta confirmed the account @${ username }.`
				)
			).toBeInTheDocument();
			expect(
				screen.getAllByText(
					`Connected to Instagram as @${ username }.`
				)[ 0 ]
			).toBeInTheDocument();
			expect(
				screen.queryByText(
					/The site did not say who manages the Instagram connection/
				)
			).not.toBeInTheDocument();
			expect(
				screen.getByRole( 'button', { name: 'Test connection' } )
			).toBeEnabled();
			expect(
				screen.getByRole( 'button', { name: 'Disconnect' } )
			).toBeEnabled();
		}
	} );

	it( 'shows a failed test with Meta’s details', async () => {
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

	describe( 'choosing between shared accounts', () => {
		const CHOICE = {
			id: 'choice-id-0123456789abcdef',
			expires_at: 2000000000,
			accounts: [
				{ id: '17841400000000001', username: 'first_club' },
				{ id: '17841400000000002', username: 'second_club' },
			],
		};

		async function returnWithChoice( current ) {
			window.history.replaceState(
				{},
				'',
				'/wp-admin/admin.php?page=fair-events-instagram&instagram_handoff=hand-off_code&state=client-state'
			);
			apiFetch.mockResolvedValueOnce(
				details( { ...current, pending_choice: CHOICE } )
			);
			await renderPage();
		}

		async function click( name ) {
			await act( async () => {
				fireEvent.click( screen.getByRole( 'button', { name } ) );
			} );
		}

		it( 'lists each account once with nothing selected and no connected notice', async () => {
			await returnWithChoice( {
				connected: false,
				usable: false,
				username: '',
				user_id: '',
			} );

			const radios = screen.getAllByRole( 'radio' );
			expect( radios ).toHaveLength( 2 );
			expect( screen.getByLabelText( '@first_club' ) ).not.toBeChecked();
			expect( screen.getByLabelText( '@second_club' ) ).not.toBeChecked();
			expect(
				screen.getByRole( 'button', {
					name: 'Connect selected account',
				} )
			).toBeDisabled();
			expect(
				screen.getByText( 'Choose an account to connect it.' )
			).toBeInTheDocument();
			expect(
				screen.queryByText( /^Connected to Instagram/ )
			).not.toBeInTheDocument();
		} );

		it( 'connects only the account confirmed by the administrator', async () => {
			await returnWithChoice( {} );
			expect(
				screen.getByText(
					'This site stays connected to @demo_events until you connect the selected account.'
				)
			).toBeInTheDocument();

			await act( async () => {
				fireEvent.click( screen.getByLabelText( '@second_club' ) );
			} );
			expect( apiFetch ).toHaveBeenCalledTimes( 1 );

			apiFetch.mockResolvedValueOnce(
				details( {
					user_id: '17841400000000002',
					username: 'second_club',
					pending_choice: null,
				} )
			);
			await click( 'Connect selected account' );

			expect( apiFetch ).toHaveBeenLastCalledWith( {
				path: '/fair-events-experimental/v1/instagram/connection/choice',
				method: 'POST',
				data: {
					choice: CHOICE.id,
					account_id: '17841400000000002',
				},
			} );
			expect(
				screen.getAllByText( 'Connected to Instagram as @second_club.' )
					.length
			).toBeGreaterThan( 0 );
			expect( screen.queryAllByRole( 'radio' ) ).toHaveLength( 0 );
		} );

		it( 'marks the currently connected account among the choices', async () => {
			await returnWithChoice( {
				user_id: '17841400000000001',
				username: 'first_club',
			} );

			expect(
				screen.getByLabelText( '@first_club (currently connected)' )
			).not.toBeChecked();
		} );

		it( 'keeps the choice and the selection when confirming fails', async () => {
			await returnWithChoice( {} );
			await act( async () => {
				fireEvent.click( screen.getByLabelText( '@first_club' ) );
			} );

			apiFetch.mockRejectedValueOnce( {
				code: 'instagram_choice_invalid',
				message:
					'Choose one of the Instagram accounts listed. Nothing was changed.',
			} );
			await click( 'Connect selected account' );

			expect(
				screen.getAllByText(
					'Choose one of the Instagram accounts listed. Nothing was changed.'
				)[ 0 ]
			).toBeInTheDocument();
			expect( screen.getByLabelText( '@first_club' ) ).toBeChecked();
			expect(
				screen.getByRole( 'button', {
					name: 'Connect selected account',
				} )
			).toBeEnabled();
		} );

		it( 'reloads the connection when the choice is gone', async () => {
			await returnWithChoice( {} );
			await act( async () => {
				fireEvent.click( screen.getByLabelText( '@first_club' ) );
			} );

			const gone =
				'This Instagram account choice expired, was cancelled, or was replaced by a newer connection attempt. Nothing was changed; connect again.';
			apiFetch
				.mockRejectedValueOnce( {
					code: 'instagram_choice_unknown',
					message: gone,
				} )
				.mockResolvedValueOnce( details( { pending_choice: null } ) );
			await click( 'Connect selected account' );

			expect( apiFetch ).toHaveBeenLastCalledWith( {
				path: '/fair-events-experimental/v1/instagram/connection',
			} );
			expect( screen.getAllByText( gone )[ 0 ] ).toBeInTheDocument();
			expect( screen.queryAllByRole( 'radio' ) ).toHaveLength( 0 );
			expect(
				screen.getAllByText( 'Connected to Instagram as @demo_events.' )
					.length
			).toBeGreaterThan( 0 );
		} );

		it( 'cancels the choice and keeps the connection', async () => {
			await returnWithChoice( {} );

			apiFetch.mockResolvedValueOnce(
				details( { pending_choice: null } )
			);
			await click( 'Cancel' );

			expect( apiFetch ).toHaveBeenLastCalledWith( {
				path: `/fair-events-experimental/v1/instagram/connection/choice?choice=${ CHOICE.id }`,
				method: 'DELETE',
			} );
			expect(
				screen.getAllByText(
					'The account choice was cancelled. Nothing was changed.'
				)[ 0 ]
			).toBeInTheDocument();
			expect( screen.queryAllByRole( 'radio' ) ).toHaveLength( 0 );
		} );
	} );
} );
