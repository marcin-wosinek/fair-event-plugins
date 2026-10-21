/**
 * Loading the Instagram settings (#1319): the connection combines the stored
 * settings with the credential status, and never carries the access token.
 */
import apiFetch from '@wordpress/api-fetch';
import { loadInstagramSettings } from '../settings-api.js';

jest.mock( '@wordpress/api-fetch' );

function mockResponses( settings, credentials ) {
	apiFetch.mockImplementation( ( { path } ) =>
		Promise.resolve(
			path === '/fair-audience/v1/instagram/credentials'
				? credentials
				: settings
		)
	);
}

afterEach( () => {
	jest.resetAllMocks();
} );

describe( 'loadInstagramSettings', () => {
	it( 'combines the stored settings with the credential status', async () => {
		mockResponses(
			{
				fair_audience_instagram_connected: true,
				fair_audience_instagram_username: 'fair_demo_studio',
				fair_audience_instagram_user_id: '17840000000000000',
				fair_audience_instagram_token_expires: 0,
			},
			{
				connected: true,
				usable: false,
				credential_status: 'unrecoverable',
				message: 'Instagram needs to be reconnected.',
			}
		);

		const settings = await loadInstagramSettings();

		expect( settings ).toEqual( {
			connected: true,
			credentialStatus: 'unrecoverable',
			credentialMessage: 'Instagram needs to be reconnected.',
			username: 'fair_demo_studio',
			userId: '17840000000000000',
			tokenExpires: null,
		} );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/instagram/credentials',
		} );
	} );

	it( 'treats a missing status as available', async () => {
		mockResponses( { fair_audience_instagram_connected: false }, {} );

		const settings = await loadInstagramSettings();

		expect( settings.credentialStatus ).toBe( 'available' );
		expect( settings.credentialMessage ).toBe( '' );
		expect( settings ).not.toHaveProperty( 'accessToken' );
	} );
} );
