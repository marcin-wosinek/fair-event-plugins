/**
 * @jest-environment jsdom
 */
import apiFetch from '@wordpress/api-fetch';
import { loadStoredTicketing, saveTicketing } from '../settings-api.js';

jest.mock( '@wordpress/api-fetch' );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'loadStoredTicketing', () => {
	test.each( [
		[ { ticketing: true }, true ],
		[ { ticketing: false }, false ],
		[ { 'bundled-translations': true }, null ],
		[ undefined, null ],
	] )( 'reads %p as %p', async ( features, expected ) => {
		apiFetch.mockResolvedValue( { fair_events_features: features } );

		await expect( loadStoredTicketing() ).resolves.toBe( expected );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/settings',
		} );
	} );
} );

describe( 'saveTicketing', () => {
	test( 'sends only the Ticketing key', async () => {
		apiFetch.mockResolvedValue( {
			fair_events_features: {
				ticketing: false,
				'bundled-translations': true,
			},
		} );

		await expect( saveTicketing( false ) ).resolves.toBe( false );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_events_features: { ticketing: false } },
		} );
	} );

	test( 'resolves null when the response omits the value', async () => {
		apiFetch.mockResolvedValue( {} );

		await expect( saveTicketing( true ) ).resolves.toBeNull();
	} );
} );
