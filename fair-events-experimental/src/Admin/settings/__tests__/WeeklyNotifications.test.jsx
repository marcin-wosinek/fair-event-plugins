/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import WeeklyNotifications from '../WeeklyNotifications.js';

jest.mock( '@wordpress/api-fetch' );

const PATH = '/fair-events-experimental/v1/weekly-notifications';

function config( overrides ) {
	return {
		enabled: false,
		source_slug: 'city',
		page_id: 12,
		day_of_week: 1,
		time_of_day: '09:00',
		week_scope: 'current',
		telegram_enabled: true,
		telegram_chat_ids: [ '@fair_channel' ],
		telegram_token_configured: true,
		configuration_error: null,
		sources: [ { slug: 'city', name: 'City events' } ],
		pages: [ { id: 12, title: 'Calendar', url: 'https://example.test/' } ],
		next_run: null,
		runs: [],
		deliveries: [],
		...overrides,
	};
}

function mockApi( initial, handlers = {} ) {
	apiFetch.mockImplementation( ( options ) => {
		const key = `${ options.method || 'GET' } ${ options.path }`;
		if ( handlers[ key ] ) {
			return handlers[ key ]( options );
		}
		return Promise.resolve( initial );
	} );
}

afterEach( () => {
	jest.resetAllMocks();
} );

describe( 'WeeklyNotifications', () => {
	const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345';

	const clickSave = () =>
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Save weekly notification settings',
			} )
		);

	it( 'says a token is saved without rendering a token field', async () => {
		mockApi( config() );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		expect(
			await screen.findByText(
				'A bot token is saved. It is not shown here.'
			)
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'New bot token' ) ).toBeNull();
		expect( document.querySelector( 'input[type="password"]' ) ).toBeNull();
		expect(
			screen.getByRole( 'button', { name: 'Replace bot token' } )
		).toBeInTheDocument();
	} );

	it( 'saves the schedule and chats without sending a token', async () => {
		const onNotice = jest.fn();
		const save = jest.fn( () =>
			Promise.resolve(
				config( {
					enabled: true,
					day_of_week: 7,
					week_scope: 'next',
					telegram_chat_ids: [ '@fair_channel', '-100200' ],
				} )
			)
		);
		mockApi( config(), { [ `POST ${ PATH }` ]: save } );

		render( <WeeklyNotifications onNotice={ onNotice } /> );

		fireEvent.click(
			await screen.findByLabelText( 'Send weekly event notifications' )
		);
		fireEvent.change( screen.getByLabelText( 'Send on' ), {
			target: { value: '7' },
		} );
		fireEvent.change( screen.getByLabelText( 'Which week to include' ), {
			target: { value: 'next' },
		} );
		fireEvent.change( screen.getByLabelText( 'Chats and channels' ), {
			target: { value: '@fair_channel\n-100200' },
		} );
		clickSave();

		await waitFor( () => expect( save ).toHaveBeenCalled() );
		const data = save.mock.calls[ 0 ][ 0 ].data;
		expect( data ).toMatchObject( {
			enabled: true,
			source_slug: 'city',
			page_id: 12,
			day_of_week: 7,
			week_scope: 'next',
			telegram_chat_ids: '@fair_channel\n-100200',
		} );
		expect( data ).not.toHaveProperty( 'telegram_bot_token' );
		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message: 'Weekly notification settings saved.',
			} )
		);
	} );

	it( 'discards a replacement draft when keeping the saved token', async () => {
		const save = jest.fn( () => Promise.resolve( config() ) );
		mockApi( config(), { [ `POST ${ PATH }` ]: save } );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Replace bot token' } )
		);
		const field = screen.getByLabelText( 'New bot token' );
		expect( field ).toHaveAttribute( 'type', 'password' );
		fireEvent.change( field, { target: { value: TOKEN } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Keep saved token' } )
		);

		expect( screen.queryByLabelText( 'New bot token' ) ).toBeNull();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Replace bot token' } )
		);
		expect( screen.getByLabelText( 'New bot token' ) ).toHaveValue( '' );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Keep saved token' } )
		);

		clickSave();
		await waitFor( () => expect( save ).toHaveBeenCalled() );
		expect( save.mock.calls[ 0 ][ 0 ].data ).not.toHaveProperty(
			'telegram_bot_token'
		);
	} );

	it( 'saves a deliberate replacement, then closes the field', async () => {
		const save = jest.fn( () => Promise.resolve( config() ) );
		mockApi( config(), { [ `POST ${ PATH }` ]: save } );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Replace bot token' } )
		);
		fireEvent.change( screen.getByLabelText( 'New bot token' ), {
			target: { value: TOKEN },
		} );
		clickSave();

		await waitFor( () => expect( save ).toHaveBeenCalled() );
		expect( save.mock.calls[ 0 ][ 0 ].data.telegram_bot_token ).toBe(
			TOKEN
		);
		await waitFor( () =>
			expect( screen.queryByLabelText( 'New bot token' ) ).toBeNull()
		);
		expect(
			screen.getByRole( 'button', { name: 'Replace bot token' } )
		).toBeInTheDocument();
	} );

	it( 'keeps a rejected replacement open with the server’s message', async () => {
		const onNotice = jest.fn();
		mockApi( config(), {
			[ `POST ${ PATH }` ]: () =>
				Promise.reject( {
					code: 'invalid_bot_token',
					message:
						'That does not look like a Telegram bot token. Copy the full token from @BotFather, for example 123456789:AAE….',
				} ),
		} );

		render( <WeeklyNotifications onNotice={ onNotice } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Replace bot token' } )
		);
		fireEvent.change( screen.getByLabelText( 'New bot token' ), {
			target: { value: 'not-a-token' },
		} );
		clickSave();

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'error',
				message:
					'That does not look like a Telegram bot token. Copy the full token from @BotFather, for example 123456789:AAE….',
			} )
		);
		expect( screen.getByLabelText( 'New bot token' ) ).toHaveValue(
			'not-a-token'
		);
	} );

	it( 'shows the token field for the first token and sends it', async () => {
		const save = jest.fn( () => Promise.resolve( config() ) );
		mockApi( config( { telegram_token_configured: false } ), {
			[ `POST ${ PATH }` ]: save,
		} );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		const field = await screen.findByLabelText( 'Bot token' );
		expect( field ).toHaveAttribute( 'type', 'password' );
		expect(
			screen.queryByRole( 'button', { name: 'Replace bot token' } )
		).toBeNull();
		fireEvent.change( field, { target: { value: TOKEN } } );
		clickSave();

		await waitFor( () => expect( save ).toHaveBeenCalled() );
		expect( save.mock.calls[ 0 ][ 0 ].data.telegram_bot_token ).toBe(
			TOKEN
		);
		expect(
			await screen.findByText(
				'A bot token is saved. It is not shown here.'
			)
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Bot token' ) ).toBeNull();
	} );

	it( 'saves any listed page as the heading link', async () => {
		const save = jest.fn( () =>
			Promise.resolve( config( { page_id: 34 } ) )
		);
		mockApi(
			config( {
				pages: [
					{ id: 12, title: 'Calendar', url: 'https://example.test/' },
					{
						id: 34,
						title: 'About us',
						url: 'https://example.test/about/',
					},
				],
			} ),
			{ [ `POST ${ PATH }` ]: save }
		);

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		const pageField = await screen.findByLabelText(
			'Page linked in the heading'
		);
		expect(
			screen.getByText(
				'Any published, public page. Its title and link head the message. The event source decides which events are listed.'
			)
		).toBeInTheDocument();
		fireEvent.change( pageField, { target: { value: '34' } } );
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Save weekly notification settings',
			} )
		);

		await waitFor( () => expect( save ).toHaveBeenCalled() );
		expect( save.mock.calls[ 0 ][ 0 ].data ).toMatchObject( {
			source_slug: 'city',
			page_id: 34,
		} );
	} );

	it( 'shows the server’s validation message when saving fails', async () => {
		const onNotice = jest.fn();
		mockApi( config(), {
			[ `POST ${ PATH }` ]: () =>
				Promise.reject( {
					message: 'These are not Telegram chat IDs: channel',
				} ),
		} );

		render( <WeeklyNotifications onNotice={ onNotice } /> );

		fireEvent.change(
			await screen.findByLabelText( 'Chats and channels' ),
			{
				target: { value: 'channel' },
			}
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Save weekly notification settings',
			} )
		);

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'error',
				message: 'These are not Telegram chat IDs: channel',
			} )
		);
	} );

	it( 'blocks the test send with a reason until changes are saved', async () => {
		mockApi( config() );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		const testButton = await screen.findByRole( 'button', {
			name: 'Send test summary to Telegram',
		} );
		expect( testButton ).toBeEnabled();

		fireEvent.change( screen.getByLabelText( 'Send at' ), {
			target: { value: '10:30' },
		} );

		expect( testButton ).toBeDisabled();
		expect(
			screen.getByText(
				'Save your changes first — the test uses the saved settings.'
			)
		).toBeInTheDocument();
	} );

	it( 'explains why the test send is unavailable without a token', async () => {
		mockApi( config( { telegram_token_configured: false } ) );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		expect(
			await screen.findByRole( 'button', {
				name: 'Send test summary to Telegram',
			} )
		).toBeDisabled();
		expect(
			screen.getByText(
				'Save a bot token and at least one chat or channel before sending a test message.'
			)
		).toBeInTheDocument();
	} );

	it( 'reports a result for every destination of a test send', async () => {
		const onNotice = jest.fn();
		mockApi( config( { telegram_chat_ids: [ '@ok_chat', '@bad_chat' ] } ), {
			[ `POST ${ PATH }/test` ]: () =>
				Promise.resolve( {
					success: false,
					results: [
						{ destination: '@ok_chat', state: 'sent', message: '' },
						{
							destination: '@bad_chat',
							state: 'failed',
							message: 'Bad Request: chat not found',
						},
					],
				} ),
		} );

		render( <WeeklyNotifications onNotice={ onNotice } /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Send test summary to Telegram',
			} )
		);

		expect( await screen.findByText( '@bad_chat' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Bad Request: chat not found' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Delivered' ) ).toBeInTheDocument();
		expect( onNotice ).toHaveBeenCalledWith(
			expect.objectContaining( { status: 'error' } )
		);
	} );

	it( 'shows the next send, recent runs and per-destination results', async () => {
		mockApi(
			config( {
				configuration_error:
					'The selected page must be published and publicly visible.',
				next_run: {
					time_local: 'September 21, 2026 9:00 am',
					week_title: '21–27 Sep 2026',
				},
				runs: [
					{
						week_start: '2026-09-14',
						week_title: '14–20 Sep 2026',
						status: 'partial',
						message: 'Delivered: 1. Failed: 1. Unknown outcome: 0.',
						time_local: 'September 14, 2026 9:01 am',
					},
				],
				deliveries: [
					{
						week_start: '2026-09-14',
						provider: 'telegram',
						destination: '@bad_chat',
						part: 1,
						part_count: 2,
						state: 'uncertain',
						error_code: 'transport_error',
						error_message: 'Operation timed out',
						updated_at_local: 'September 14, 2026 9:01 am',
					},
				],
			} )
		);

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		expect(
			await screen.findByText(
				'Next send: September 21, 2026 9:00 am, with events for 21–27 Sep 2026.'
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByText(
				'The selected page must be published and publicly visible.'
			)[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByText( 'Partly sent' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Part 1 of 2' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Unknown — check the chat before resending' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Operation timed out' ) ).toBeInTheDocument();
	} );

	it( 'previews the next message', async () => {
		mockApi( config(), {
			[ `GET ${ PATH }/preview` ]: () =>
				Promise.resolve( {
					text: 'Calendar (https://example.test/), 21–27 Sep 2026:\n* Mon, 18:00, Workshop',
					occurrence_count: 1,
					telegram_parts: 1,
					telegram_messages: [
						{
							text: 'Calendar 🎉\n21–27 Sep 2026\n\n• Mon, 18:00, <b>Workshop</b>\n• Tue, Unlinked',
							entities: [
								{ type: 'bold', offset: 0, length: 11 },
								{
									type: 'text_link',
									offset: 0,
									length: 11,
									url: 'https://example.test/',
								},
								{
									type: 'text_link',
									offset: 42,
									length: 15,
									url: 'https://example.test/workshop/',
								},
								{
									type: 'text_link',
									offset: 65,
									length: 8,
									url: 'javascript:alert(1)',
								},
							],
						},
					],
				} ),
		} );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Preview next message',
			} )
		);

		expect(
			await screen.findByText( 'Telegram: sent as 1 message.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Calendar 🎉' } )
		).toHaveAttribute( 'href', 'https://example.test/' );
		expect(
			screen.getByRole( 'link', { name: '<b>Workshop</b>' } )
		).toHaveAttribute( 'href', 'https://example.test/workshop/' );
		expect( screen.getByText( 'Calendar 🎉' ).tagName ).toBe( 'STRONG' );
		expect( screen.queryByText( /\* Mon/ ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'link' ) ).toHaveLength( 2 );
		expect(
			screen.getByRole( 'group', { name: 'Telegram message 1 of 1' } )
		).toHaveTextContent( '• Tue, Unlinked' );
	} );
} );
