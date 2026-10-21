/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import NotificationsTab from '../NotificationsTab.js';

jest.mock( '@wordpress/api-fetch' );

describe( 'NotificationsTab', () => {
	beforeEach( () => {
		jest.resetAllMocks();
	} );

	function mockInitialLoad( overrides = {} ) {
		apiFetch.mockImplementation( ( opts ) => {
			if (
				opts.path === '/wp/v2/settings' &&
				( ! opts.method || opts.method === 'GET' )
			) {
				return Promise.resolve( {
					fair_payment_telegram_bot_token: '',
					fair_payment_notification_routes: [],
					...overrides,
				} );
			}
			return Promise.resolve( {} );
		} );
	}

	test( 'loads existing settings and renders bot token field', async () => {
		mockInitialLoad( {
			fair_payment_telegram_bot_token: 'BOT:123',
		} );

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect( screen.getByDisplayValue( 'BOT:123' ) ).toBeInTheDocument()
		);
	} );

	test( 'renders existing routes from settings', async () => {
		mockInitialLoad( {
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'telegram',
					destination: '12345',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		} );

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect( screen.getByDisplayValue( '12345' ) ).toBeInTheDocument()
		);
	} );

	test( 'Add route button creates a new empty route row', async () => {
		mockInitialLoad();

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect( screen.getByText( 'Add route' ) ).toBeInTheDocument()
		);

		fireEvent.click( screen.getByText( 'Add route' ) );

		await waitFor( () => {
			expect( screen.getByText( 'Send test' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Remove' ) ).toBeInTheDocument();
		} );
	} );

	test( 'Remove button removes the route', async () => {
		mockInitialLoad( {
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'email',
					destination: 'test@example.com',
					frequency: 'daily',
					include_pii: false,
				},
			],
		} );

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect(
				screen.getByDisplayValue( 'test@example.com' )
			).toBeInTheDocument()
		);

		fireEvent.click( screen.getByText( 'Remove' ) );

		await waitFor( () =>
			expect(
				screen.queryByDisplayValue( 'test@example.com' )
			).not.toBeInTheDocument()
		);
	} );

	test( 'Save button posts routes and bot token to /wp/v2/settings', async () => {
		mockInitialLoad( {
			fair_payment_telegram_bot_token: 'BOT:abc',
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'telegram',
					destination: '99999',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		} );

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect( screen.getByDisplayValue( 'BOT:abc' ) ).toBeInTheDocument()
		);

		apiFetch.mockImplementation( ( opts ) => {
			if ( opts.method === 'POST' && opts.path === '/wp/v2/settings' ) {
				return Promise.resolve( {} );
			}
			return Promise.resolve( {} );
		} );

		fireEvent.click( screen.getByText( 'Save settings' ) );

		await waitFor( () => {
			const saveCall = apiFetch.mock.calls.find(
				( [ opts ] ) =>
					opts.method === 'POST' && opts.path === '/wp/v2/settings'
			);
			expect( saveCall ).toBeTruthy();
			expect( saveCall[ 0 ].data ).toMatchObject( {
				fair_payment_telegram_bot_token: 'BOT:abc',
				fair_payment_notification_routes: expect.arrayContaining( [
					expect.objectContaining( {
						channel: 'telegram',
						destination: '99999',
					} ),
				] ),
			} );
		} );
	} );

	describe( 'stored bot token encrypted at rest (#1319)', () => {
		const CREDENTIALS = '/fair-payments-connector/v1/telegram/credentials';
		const UNRECOVERABLE_MESSAGE =
			'Telegram notifications are paused: the stored bot token can no longer be read.';
		const ROUTE = {
			id: 'route-1',
			enabled: true,
			channel: 'telegram',
			destination: '99999',
			frequency: 'immediate',
			include_pii: true,
		};

		function mockLoad( settings, credentials ) {
			apiFetch.mockImplementation( ( opts ) => {
				if ( opts.path === CREDENTIALS ) {
					return Promise.resolve( credentials );
				}
				if ( opts.path === '/wp/v2/settings' && ! opts.method ) {
					return Promise.resolve( {
						fair_payment_notification_routes: [ ROUTE ],
						...settings,
					} );
				}
				return Promise.resolve( {} );
			} );
		}

		function saveCall() {
			return apiFetch.mock.calls.find(
				( [ opts ] ) =>
					opts.method === 'POST' && opts.path === '/wp/v2/settings'
			);
		}

		test( 'reads the decrypted token back into the field, without a notice', async () => {
			mockLoad(
				{ fair_payment_telegram_bot_token: '123456:decrypted' },
				{
					credential_status: 'available',
					credentials_encrypted: true,
					message: '',
				}
			);

			render( <NotificationsTab onNotice={ () => {} } /> );

			await waitFor( () =>
				expect(
					screen.getByDisplayValue( '123456:decrypted' )
				).toBeInTheDocument()
			);
			expect(
				apiFetch.mock.calls.some(
					( [ opts ] ) => opts.path === CREDENTIALS
				)
			).toBe( true );
			expect(
				document.querySelector( '.components-notice' )
			).not.toBeInTheDocument();
			expect(
				screen.getByText( /Stored encrypted in the site database/ )
			).toBeInTheDocument();
		} );

		test( 'saving the routes leaves an unreadable token alone', async () => {
			mockLoad(
				{ fair_payment_telegram_bot_token: '' },
				{
					credential_status: 'unrecoverable',
					message: UNRECOVERABLE_MESSAGE,
				}
			);

			render( <NotificationsTab onNotice={ () => {} } /> );

			await waitFor( () =>
				expect(
					document.querySelector( '.components-notice.is-error' )
				).toHaveTextContent( UNRECOVERABLE_MESSAGE )
			);

			fireEvent.click( screen.getByText( 'Save settings' ) );

			await waitFor( () => expect( saveCall() ).toBeTruthy() );
			expect( saveCall()[ 0 ].data ).toEqual( {
				fair_payment_notification_routes: [ ROUTE ],
			} );
		} );

		test( 'a token entered over an unreadable one is saved', async () => {
			mockLoad(
				{ fair_payment_telegram_bot_token: '' },
				{
					credential_status: 'unrecoverable',
					message: UNRECOVERABLE_MESSAGE,
				}
			);
			const onNotice = jest.fn();

			render( <NotificationsTab onNotice={ onNotice } /> );

			await waitFor( () =>
				expect(
					document.querySelector( '.components-notice.is-error' )
				).toBeInTheDocument()
			);

			fireEvent.change( screen.getByLabelText( 'Bot token' ), {
				target: { value: '123456:replacement' },
			} );
			mockLoad( {}, { credential_status: 'available', message: '' } );
			fireEvent.click( screen.getByText( 'Save settings' ) );

			await waitFor( () =>
				expect( onNotice ).toHaveBeenCalledWith( {
					status: 'success',
					message: 'Notification settings saved.',
				} )
			);
			expect( saveCall()[ 0 ].data ).toEqual( {
				fair_payment_telegram_bot_token: '123456:replacement',
				fair_payment_notification_routes: [ ROUTE ],
			} );
			// The status is reloaded, so the notice goes away.
			await waitFor( () =>
				expect(
					document.querySelector( '.components-notice' )
				).not.toBeInTheDocument()
			);
		} );

		test( 'explains a temporary encryption outage as a warning', async () => {
			mockLoad(
				{ fair_payment_telegram_bot_token: '' },
				{
					credential_status: 'encryption_unavailable',
					message: 'Telegram notifications are paused.',
				}
			);

			render( <NotificationsTab onNotice={ () => {} } /> );

			await waitFor( () =>
				expect(
					document.querySelector( '.components-notice.is-warning' )
				).toHaveTextContent( 'Telegram notifications are paused.' )
			);
		} );

		test( 'loads the settings when the token status cannot be loaded', async () => {
			apiFetch.mockImplementation( ( opts ) =>
				opts.path === CREDENTIALS
					? Promise.reject( new Error( 'Not found' ) )
					: Promise.resolve( {
							fair_payment_telegram_bot_token: 'BOT:abc',
							fair_payment_notification_routes: [],
						} )
			);
			const onNotice = jest.fn();

			render( <NotificationsTab onNotice={ onNotice } /> );

			await waitFor( () =>
				expect(
					screen.getByDisplayValue( 'BOT:abc' )
				).toBeInTheDocument()
			);
			expect( onNotice ).not.toHaveBeenCalled();
		} );
	} );

	test( 'Send test calls the notifications test endpoint', async () => {
		mockInitialLoad( {
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'email',
					destination: 'admin@example.com',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		} );

		render( <NotificationsTab onNotice={ () => {} } /> );

		await waitFor( () =>
			expect(
				screen.getByDisplayValue( 'admin@example.com' )
			).toBeInTheDocument()
		);

		apiFetch.mockImplementation( ( opts ) => {
			if (
				opts.path === '/fair-payments-connector/v1/notifications/test'
			) {
				return Promise.resolve( {
					success: true,
					message: 'Test notification sent.',
				} );
			}
			return Promise.resolve( {} );
		} );

		fireEvent.click( screen.getByText( 'Send test' ) );

		await waitFor( () => {
			const testCall = apiFetch.mock.calls.find(
				( [ opts ] ) =>
					opts.path ===
					'/fair-payments-connector/v1/notifications/test'
			);
			expect( testCall ).toBeTruthy();
			expect( testCall[ 0 ].method ).toBe( 'POST' );
			expect( testCall[ 0 ].data ).toEqual( {
				channel: 'email',
				destination: 'admin@example.com',
				include_pii: true,
			} );
		} );

		await waitFor( () => {
			const matches = screen.getAllByText( 'Test notification sent.' );
			expect( matches.length ).toBeGreaterThan( 0 );
		} );
	} );
} );
