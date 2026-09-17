/**
 * Component tests for the Currency tab (#1575: no administrator-supplied
 * audit reason is collected anymore).
 *
 * Exercises:
 *   - Save is enabled as soon as the tab loads.
 *   - Save posts to the reason-required settings-write endpoint (not
 *     /wp/v2/settings) with no reason in the payload.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import CurrencyTab from '../CurrencyTab.js';

jest.mock( '@wordpress/api-fetch' );

function mockApiFetch() {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( { fair_payment_currency: 'EUR' } );
		}
		return Promise.resolve( { success: true, settings: {} } );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'CurrencyTab', () => {
	it( 'Save is enabled as soon as the tab has loaded', async () => {
		mockApiFetch();
		render( <CurrencyTab onNotice={ () => {} } /> );

		const saveButton = await screen.findByRole( 'button', {
			name: 'Save',
		} );
		expect( saveButton ).toBeEnabled();
	} );

	it( 'saves through the connector settings endpoint with no reason, not /wp/v2/settings', async () => {
		mockApiFetch();
		render( <CurrencyTab onNotice={ () => {} } /> );

		const saveButton = await screen.findByRole( 'button', {
			name: 'Save',
		} );
		fireEvent.click( saveButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/settings',
					method: 'POST',
					data: {
						settings: { fair_payment_currency: 'EUR' },
					},
				} )
			);
		} );

		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/wp/v2/settings',
				method: 'POST',
			} )
		);
	} );
} );
