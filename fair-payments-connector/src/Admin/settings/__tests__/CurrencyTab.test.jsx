/**
 * Component tests for the Currency tab's mandatory audit reason (#1575).
 *
 * Exercises:
 *   - Save is disabled while the reason is empty, even with a changed currency.
 *   - Save is enabled once a reason is entered, and posts the reason to the
 *     reason-required settings-write endpoint (not /wp/v2/settings).
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

describe( 'CurrencyTab — mandatory reason', () => {
	it( 'keeps Save disabled until a reason is entered', async () => {
		mockApiFetch();
		render( <CurrencyTab onNotice={ () => {} } /> );

		const saveButton = await screen.findByRole( 'button', {
			name: 'Save',
		} );
		expect( saveButton ).toBeDisabled();

		fireEvent.change( screen.getByLabelText( /Reason for this change/i ), {
			target: { value: 'Switching to USD pricing.' },
		} );

		expect( saveButton ).toBeEnabled();
	} );

	it( 'saves through the reason-required endpoint, not /wp/v2/settings', async () => {
		mockApiFetch();
		render( <CurrencyTab onNotice={ () => {} } /> );

		const saveButton = await screen.findByRole( 'button', {
			name: 'Save',
		} );

		fireEvent.change( screen.getByLabelText( /Reason for this change/i ), {
			target: { value: 'Switching to USD pricing.' },
		} );
		fireEvent.click( saveButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-payments-connector/v1/settings',
					method: 'POST',
					data: {
						settings: { fair_payment_currency: 'EUR' },
						reason: 'Switching to USD pricing.',
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
