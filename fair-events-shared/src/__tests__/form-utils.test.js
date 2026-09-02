/**
 * @jest-environment jsdom
 */
import apiFetch from '@wordpress/api-fetch';
import { wireNotYouButton } from '../form-utils';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

describe( 'wireNotYouButton', () => {
	beforeEach( () => {
		document.body.innerHTML = '<button type="button">Start fresh</button>';
		apiFetch.mockReset();
	} );

	test( 'successful deletion reloads without removing participant_token', async () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=stronger-identity'
		);
		apiFetch.mockResolvedValue( { success: true } );
		const button = document.querySelector( 'button' );
		const reload = jest.fn();
		wireNotYouButton( button, reload );

		button.click();
		await Promise.resolve();
		await Promise.resolve();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-audience/v1/session',
			method: 'DELETE',
		} );
		expect( reload ).toHaveBeenCalledTimes( 1 );
		expect( window.location.search ).toBe(
			'?participant_token=stronger-identity'
		);
	} );

	test( 'failed deletion retains state, re-enables the action, and shows the API error', async () => {
		apiFetch.mockRejectedValue(
			new Error( 'Session service unavailable' )
		);
		const button = document.querySelector( 'button' );
		const reload = jest.fn();
		wireNotYouButton( button, reload );

		button.click();
		expect( button.disabled ).toBe( true );
		await Promise.resolve();
		await Promise.resolve();

		expect( reload ).not.toHaveBeenCalled();
		expect( button.disabled ).toBe( false );
		expect(
			document.querySelector( '.fair-audience-notification-error' )
				.textContent
		).toBe( 'Session service unavailable' );
	} );

	test( 'failed deletion shows a fallback error when the API has no message', async () => {
		apiFetch.mockRejectedValue( {} );
		const button = document.querySelector( 'button' );
		wireNotYouButton( button, jest.fn() );

		button.click();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			document.querySelector( '.fair-audience-notification-error' )
				.textContent
		).toBe(
			'We could not clear the remembered identity. Please try again.'
		);
	} );
} );
