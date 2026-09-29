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
	it( 'never shows a saved bot token and says one is saved', async () => {
		mockApi( config() );

		render( <WeeklyNotifications onNotice={ () => {} } /> );

		const token = await screen.findByLabelText( 'Replace bot token' );
		expect( token ).toHaveValue( '' );
		expect( token ).toHaveAttribute( 'type', 'password' );
		expect(
			screen.getByText(
				'A bot token is saved. Leave this empty to keep it.'
			)
		).toBeInTheDocument();
	} );

	it( 'saves the schedule, chats and a new token, then clears the token field', async () => {
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
		fireEvent.change( screen.getByLabelText( 'Replace bot token' ), {
			target: { value: '123456789:AAEabcdefghijklmnopqrstuvwxyz012345' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Save weekly notification settings',
			} )
		);

		await waitFor( () => expect( save ).toHaveBeenCalled() );
		expect( save.mock.calls[ 0 ][ 0 ].data ).toMatchObject( {
			enabled: true,
			source_slug: 'city',
			page_id: 12,
			day_of_week: 7,
			week_scope: 'next',
			telegram_chat_ids: '@fair_channel\n-100200',
			telegram_bot_token: '123456789:AAEabcdefghijklmnopqrstuvwxyz012345',
		} );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Replace bot token' ) ).toHaveValue(
				''
			)
		);
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'success',
			message: 'Weekly notification settings saved.',
		} );
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
			name: 'Send Telegram test message',
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
				name: 'Send Telegram test message',
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
				name: 'Send Telegram test message',
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
			screen.getByText( /\* Mon, 18:00, Workshop/ )
		).toBeInTheDocument();
	} );
} );
