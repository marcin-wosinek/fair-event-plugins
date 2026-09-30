/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import NotificationsApp from '../NotificationsApp.js';

jest.mock( '@wordpress/api-fetch' );

describe( 'NotificationsApp', () => {
	beforeEach( () => {
		jest.resetAllMocks();
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		console.error.mockRestore();
	} );

	test( 'renders the Notifications page with its route editor', async () => {
		apiFetch.mockResolvedValue( {
			fair_payment_telegram_bot_token: '',
			fair_payment_notification_routes: [],
		} );

		render( <NotificationsApp /> );

		expect(
			screen.getByRole( 'heading', { level: 1, name: 'Notifications' } )
		).toBeInTheDocument();
		await waitFor( () =>
			expect( screen.getByText( 'Add route' ) ).toBeInTheDocument()
		);
	} );

	test( 'shows an error notice when the settings fail to load', async () => {
		apiFetch.mockRejectedValue( new Error( 'Forbidden' ) );

		render( <NotificationsApp /> );

		await waitFor( () =>
			expect(
				document.querySelector( '.components-notice.is-error' )
			).toHaveTextContent( 'Failed to load notification settings.' )
		);
	} );
} );

describe( 'Notifications page entry', () => {
	test( 'mounts into the Fair Payments Connector root element', async () => {
		apiFetch.mockResolvedValue( {
			fair_payment_telegram_bot_token: '',
			fair_payment_notification_routes: [],
		} );
		document.body.innerHTML =
			'<div id="fair-payments-connector-notifications-root"></div>';

		await act( async () => {
			jest.isolateModules( () => {
				require( '../index.js' );
			} );
		} );

		await waitFor( () =>
			expect(
				screen.getByRole( 'heading', {
					level: 1,
					name: 'Notifications',
				} )
			).toBeInTheDocument()
		);
	} );
} );
