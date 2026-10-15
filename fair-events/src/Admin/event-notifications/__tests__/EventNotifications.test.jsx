/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventNotifications from '../EventNotifications.js';
import { TelegramMessage, tokenStatus } from '../TelegramChannel.js';

jest.mock( '@wordpress/api-fetch' );

const PATH = '/fair-events/v1/event-notifications';

function telegram( overrides ) {
	return {
		state: 'active',
		state_message: '',
		enabled: false,
		source_slug: 'city',
		page_id: 12,
		day_of_week: 5,
		time_of_day: '10:30',
		week_scope: 'next',
		chat_ids: [ '@fair_channel' ],
		token_configured: true,
		token_valid: true,
		token_source: 'database',
		token_override_name: 'FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN',
		connectors_url: 'https://example.test/wp-admin/options-connectors.php',
		configuration_error: null,
		next_run: null,
		runs: [],
		deliveries: [],
		...overrides,
	};
}

function bulkEmail( overrides ) {
	return {
		state: 'active',
		state_message: '',
		enabled: false,
		source_slug: 'members',
		day_of_week: 1,
		time_of_day: '08:00',
		week_scope: 'current',
		skip_empty: true,
		subject: 'This week: {week_start}',
		intro: 'Hello',
		outro: '',
		test_recipient: 'admin@example.test',
		last_sent_week: '',
		next_run: null,
		runs: [],
		...overrides,
	};
}

function individualEmail( overrides ) {
	return {
		state: 'active',
		state_message: '',
		enabled: false,
		recipient: 'organizer@example.test',
		event_selection: '@local',
		day_of_week: 3,
		time_of_day: '07:15',
		week_scope: 'current',
		skip_empty: true,
		subject: 'Organizer update: {week_start}',
		intro: 'Team,',
		outro: '',
		configuration_error: null,
		last_sent_week: '',
		next_run: null,
		runs: [],
		...overrides,
	};
}

function payload( channels = {} ) {
	return {
		sources: [
			{ slug: 'city', name: 'City events' },
			{ slug: 'members', name: 'Member events' },
		],
		pages: [ { id: 12, title: 'Calendar' } ],
		channels: {
			telegram: telegram( channels.telegram ),
			bulk_email: bulkEmail( channels.bulk_email ),
			individual_email: individualEmail( channels.individual_email ),
		},
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

async function renderPage( initial = payload(), handlers = {} ) {
	mockApi( initial, handlers );
	render( <EventNotifications sourcesUrl={ null } /> );
	await screen.findByRole( 'heading', { name: 'Telegram' } );
}

function section( name ) {
	return screen
		.getByRole( 'heading', { name } )
		.closest( '.fair-events-notifications__channel' );
}

function calls( method, path ) {
	return apiFetch.mock.calls.filter(
		( [ options ] ) =>
			( options.method || 'GET' ) === method && options.path === path
	);
}

afterEach( () => {
	jest.resetAllMocks();
} );

describe( 'EventNotifications', () => {
	it( 'shows each channel with its own schedule and event selection', async () => {
		await renderPage();

		const tg = within( section( 'Telegram' ) );
		expect( tg.getByLabelText( 'Events to include' ) ).toHaveValue(
			'city'
		);
		expect( tg.getByLabelText( 'Send on' ) ).toHaveValue( '5' );
		expect( tg.getByLabelText( 'Send at' ) ).toHaveValue( '10:30' );
		expect( tg.getByLabelText( 'Which week to include' ) ).toHaveValue(
			'next'
		);

		const mail = within( section( 'Bulk email' ) );
		expect( mail.getByLabelText( 'Events to include' ) ).toHaveValue(
			'members'
		);
		expect( mail.getByLabelText( 'Send on' ) ).toHaveValue( '1' );
		expect( mail.getByLabelText( 'Send at' ) ).toHaveValue( '08:00' );
		expect( mail.getByLabelText( 'Which week to include' ) ).toHaveValue(
			'current'
		);
	} );

	it( 'explains today versus the scheduled week in every channel', async () => {
		await renderPage();
		for ( const name of [ 'Telegram', 'Bulk email', 'Individual email' ] ) {
			expect(
				within( section( name ) ).getByText(
					/Previews and tests select the week relative to today in the site timezone\. Scheduled sends select it relative to their scheduled week\./
				)
			).toBeInTheDocument();
		}
		expect(
			screen.queryByText( /next scheduled week/ )
		).not.toBeInTheDocument();
	} );

	it( 'saves only the Telegram section and keeps unsaved bulk email edits', async () => {
		const saved = payload( { telegram: { time_of_day: '18:00' } } );
		await renderPage( payload(), {
			[ `POST ${ PATH }/telegram` ]: () => Promise.resolve( saved ),
		} );

		const tg = within( section( 'Telegram' ) );
		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Draft subject' },
		} );
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '18:00' },
		} );
		expect( tg.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		fireEvent.click(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
		);

		expect(
			await tg.findByText( 'Telegram settings saved.' )
		).toBeInTheDocument();
		expect( calls( 'POST', `${ PATH }/telegram` )[ 0 ][ 0 ].data ).toEqual(
			{
				enabled: false,
				source_slug: 'city',
				page_id: 12,
				day_of_week: 5,
				time_of_day: '18:00',
				week_scope: 'next',
				chat_ids: '@fair_channel',
			}
		);
		expect( calls( 'POST', `${ PATH }/bulk-email` ) ).toHaveLength( 0 );
		expect( tg.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue(
			'Draft subject'
		);
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	it( 'saves the bulk email wording with its own button', async () => {
		const saved = payload( { bulk_email: { outro: 'See you' } } );
		await renderPage( payload(), {
			[ `POST ${ PATH }/bulk-email` ]: () => Promise.resolve( saved ),
		} );

		const mail = within( section( 'Bulk email' ) );
		fireEvent.change(
			mail.getByLabelText( 'Text below the list of events' ),
			{ target: { value: 'See you' } }
		);
		fireEvent.click(
			mail.getByRole( 'button', { name: 'Save bulk email settings' } )
		);

		expect(
			await mail.findByText( 'Bulk email settings saved.' )
		).toBeInTheDocument();
		expect(
			calls( 'POST', `${ PATH }/bulk-email` )[ 0 ][ 0 ].data
		).toMatchObject( {
			source_slug: 'members',
			subject: 'This week: {week_start}',
			intro: 'Hello',
			outro: 'See you',
			skip_empty: true,
		} );
		expect( calls( 'POST', `${ PATH }/telegram` ) ).toHaveLength( 0 );
	} );

	it( 'shows a failed save inside the section it belongs to', async () => {
		await renderPage( payload(), {
			[ `POST ${ PATH }/telegram` ]: () =>
				Promise.reject( { message: 'Choose an event feed.' } ),
		} );

		const tg = within( section( 'Telegram' ) );
		fireEvent.click(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
		);

		expect(
			await tg.findByText( 'Choose an event feed.' )
		).toBeInTheDocument();
		expect(
			within( section( 'Bulk email' ) ).queryByText(
				'Choose an event feed.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'names the Telegram test destinations and reports each result', async () => {
		await renderPage(
			payload( { telegram: { chat_ids: [ '@one', '@two' ] } } ),
			{
				[ `POST ${ PATH }/telegram/test` ]: () =>
					Promise.resolve( {
						success: false,
						results: [
							{ destination: '@one', state: 'sent', message: '' },
							{
								destination: '@two',
								state: 'failed',
								message: 'Forbidden: bot is not a member',
							},
						],
					} ),
			}
		);

		const tg = within( section( 'Telegram' ) );
		expect(
			tg.getByText( /summary to: @one, @two\./ )
		).toBeInTheDocument();

		fireEvent.click(
			tg.getByRole( 'button', { name: 'Send test to the saved chats' } )
		);

		expect(
			await tg.findByText( 'Forbidden: bot is not a member' )
		).toBeInTheDocument();
		expect(
			tg.getByText(
				'The test summary did not reach every chat. See the results below.'
			)
		).toBeInTheDocument();
		// The other channel stays usable.
		expect(
			within( section( 'Bulk email' ) ).getByRole( 'button', {
				name: 'Save bulk email settings',
			} )
		).toBeEnabled();
	} );

	it( 'explains why a Telegram test is unavailable without a token', async () => {
		await renderPage(
			payload( {
				telegram: { token_configured: false, token_valid: false },
			} )
		);

		const tg = within( section( 'Telegram' ) );
		expect(
			tg.getByRole( 'button', { name: 'Send test to the saved chats' } )
		).toBeDisabled();
		expect(
			tg.getByText(
				'Fix the bot token in Connectors before sending a test message.'
			)
		).toBeInTheDocument();
		expect(
			tg.getByRole( 'link', { name: /Manage in Connectors/ } )
		).toHaveAttribute(
			'href',
			'https://example.test/wp-admin/options-connectors.php'
		);
	} );

	it( 'sends the bulk email test to the administrator only', async () => {
		await renderPage( payload(), {
			[ `POST ${ PATH }/bulk-email/test` ]: () =>
				Promise.resolve( { sent_to: 'admin@example.test' } ),
		} );

		const mail = within( section( 'Bulk email' ) );
		fireEvent.click(
			mail.getByRole( 'button', {
				name: 'Send test email to admin@example.test',
			} )
		);

		expect(
			await mail.findByText(
				'Test email sent to admin@example.test. No subscriber received it.'
			)
		).toBeInTheDocument();
	} );

	it( 'previews the next email with its subject', async () => {
		await renderPage( payload(), {
			[ `GET ${ PATH }/bulk-email/preview` ]: () =>
				Promise.resolve( {
					subject: 'This week: 2026-10-12',
					html: '<p>Concert night</p>',
					empty: false,
					week_title: '12–18 Oct 2026',
				} ),
		} );

		const mail = within( section( 'Bulk email' ) );
		fireEvent.click(
			mail.getByRole( 'button', { name: 'Preview next email' } )
		);

		expect(
			await mail.findByText( 'This week: 2026-10-12' )
		).toBeInTheDocument();
		expect(
			within(
				mail.getByRole( 'group', { name: 'Email preview' } )
			).getByText( 'Concert night' )
		).toBeInTheDocument();
	} );

	it( 'makes preview and test wait for unsaved changes', async () => {
		await renderPage();

		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Changed' },
		} );

		expect(
			mail.getByRole( 'button', { name: 'Preview next email' } )
		).toBeDisabled();
		expect(
			mail.getByRole( 'button', {
				name: 'Send test email to admin@example.test',
			} )
		).toBeDisabled();
		expect(
			mail.getByText(
				'Save your changes first — the preview and the test use the saved settings.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps Telegram usable while bulk email is paused without Fair Audience', async () => {
		await renderPage(
			payload( {
				bulk_email: {
					state: 'inactive',
					state_message:
						'The weekly email is paused because Fair Audience is not active.',
				},
			} )
		);

		const mail = within( section( 'Bulk email' ) );
		expect(
			mail.getByText(
				'The weekly email is paused because Fair Audience is not active.'
			)
		).toBeInTheDocument();
		expect(
			mail.queryByRole( 'button', { name: 'Save bulk email settings' } )
		).not.toBeInTheDocument();
		expect(
			within( section( 'Telegram' ) ).getByRole( 'button', {
				name: 'Save Telegram settings',
			} )
		).toBeEnabled();
	} );

	it( 'asks for an update instead of offering Telegram settings an older plugin still owns', async () => {
		await renderPage(
			payload( {
				telegram: {
					state: 'update_required',
					state_message: 'Update Fair Events Experimental.',
				},
			} )
		);

		const tg = within( section( 'Telegram' ) );
		expect(
			tg.getByText( 'Update Fair Events Experimental.' )
		).toBeInTheDocument();
		expect(
			tg.queryByRole( 'button', { name: 'Save Telegram settings' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows delivery status per channel', async () => {
		await renderPage(
			payload( {
				telegram: {
					next_run: {
						time_local: 'October 16, 2026 10:30 am',
						week_title: '19–25 Oct 2026',
					},
					runs: [
						{
							week_start: '2026-10-05',
							week_title: '5–11 Oct 2026',
							status: 'partial',
							message:
								'Delivered: 1. Failed: 1. Unknown outcome: 0.',
							time_local: 'October 2, 2026 10:30 am',
						},
					],
					deliveries: [
						{
							week_start: '2026-10-05',
							destination: '@fair_channel',
							part: 1,
							part_count: 1,
							state: 'uncertain',
							error_message: 'Operation timed out',
							updated_at_local: 'October 2, 2026 10:30 am',
						},
					],
				},
				bulk_email: {
					runs: [
						{
							send_week: '2026-W41',
							week_title: '',
							status: 'sent',
							message: 'Sent: 12. Failed: 0. Skipped: 3.',
							time_local: 'October 5, 2026 8:00 am',
						},
					],
				},
			} )
		);

		const tg = within( section( 'Telegram' ) );
		expect(
			tg.getByText(
				'Next send: October 16, 2026 10:30 am, with events for 19–25 Oct 2026.'
			)
		).toBeInTheDocument();
		expect( tg.getByText( 'Partly sent' ) ).toBeInTheDocument();
		expect(
			tg.getByText( 'Unknown — check the chat before resending' )
		).toBeInTheDocument();
		expect( tg.getByText( 'Operation timed out' ) ).toBeInTheDocument();

		const mail = within( section( 'Bulk email' ) );
		expect( mail.getByText( '2026-W41' ) ).toBeInTheDocument();
		expect(
			mail.getByText( 'Sent: 12. Failed: 0. Skipped: 3.' )
		).toBeInTheDocument();
	} );

	it( 'says what is missing when there is no event feed', async () => {
		mockApi( { ...payload(), sources: [] } );
		render( <EventNotifications sourcesUrl="/wp-admin/sources" /> );

		expect(
			await screen.findByRole( 'link', {
				name: 'Create an event feed',
			} )
		).toHaveAttribute( 'href', '/wp-admin/sources' );
	} );

	it( 'reports a failed load', async () => {
		apiFetch.mockRejectedValue( { message: 'Sorry, not allowed.' } );
		render( <EventNotifications sourcesUrl={ null } /> );

		// The notice text is also announced through the a11y speak region.
		expect(
			( await screen.findAllByText( 'Sorry, not allowed.' ) ).length
		).toBeGreaterThan( 0 );
	} );

	it( 'warns before leaving with unsaved changes', async () => {
		await renderPage();
		const event = new Event( 'beforeunload', { cancelable: true } );
		window.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );

		fireEvent.change(
			within( section( 'Telegram' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '07:00' } }
		);
		const dirtyEvent = new Event( 'beforeunload', { cancelable: true } );
		await waitFor( () => {
			window.dispatchEvent( dirtyEvent );
			expect( dirtyEvent.defaultPrevented ).toBe( true );
		} );
	} );
} );

describe( 'Individual email', () => {
	const INDIVIDUAL = `${ PATH }/individual-email`;

	it( 'has its own recipient, schedule and event selection', async () => {
		await renderPage();

		const own = within( section( 'Individual email' ) );
		expect( own.getByLabelText( 'Send to' ) ).toHaveValue(
			'organizer@example.test'
		);
		expect( own.getByLabelText( 'Events to include' ) ).toHaveValue(
			'@local'
		);
		expect( own.getByLabelText( 'Send on' ) ).toHaveValue( '3' );
		expect( own.getByLabelText( 'Send at' ) ).toHaveValue( '07:15' );
		expect(
			own.getByRole( 'option', { name: 'All published local events' } )
		).toBeInTheDocument();
		expect(
			own.getByRole( 'option', { name: 'City events' } )
		).toBeInTheDocument();
		// One typed address: no user or participant picker.
		expect( own.getByLabelText( 'Send to' ) ).toHaveAttribute(
			'type',
			'email'
		);
		expect(
			own.queryByRole( 'combobox', { name: /user|participant/i } )
		).not.toBeInTheDocument();
		// The other channels keep their own schedule.
		expect(
			within( section( 'Bulk email' ) ).getByLabelText( 'Send at' )
		).toHaveValue( '08:00' );
	} );

	it( 'saves only its own section and keeps unsaved bulk email edits', async () => {
		const saved = payload( {
			individual_email: {
				enabled: true,
				recipient: 'team@example.test',
				event_selection: 'city',
				time_of_day: '06:00',
			},
		} );
		await renderPage( payload(), {
			[ `POST ${ INDIVIDUAL }` ]: () => Promise.resolve( saved ),
		} );

		const own = within( section( 'Individual email' ) );
		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Draft subject' },
		} );
		fireEvent.click(
			own.getByLabelText( 'Email the weekly summary to this address' )
		);
		fireEvent.change( own.getByLabelText( 'Send to' ), {
			target: { value: ' team@example.test ' },
		} );
		fireEvent.change( own.getByLabelText( 'Events to include' ), {
			target: { value: 'city' },
		} );
		fireEvent.change( own.getByLabelText( 'Send at' ), {
			target: { value: '06:00' },
		} );
		expect( own.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		fireEvent.click(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		);

		expect(
			await own.findByText( 'Individual email settings saved.' )
		).toBeInTheDocument();
		expect( calls( 'POST', INDIVIDUAL )[ 0 ][ 0 ].data ).toEqual( {
			enabled: true,
			recipient: 'team@example.test',
			event_selection: 'city',
			day_of_week: 3,
			time_of_day: '06:00',
			week_scope: 'current',
			skip_empty: true,
			subject: 'Organizer update: {week_start}',
			intro: 'Team,',
			outro: '',
		} );
		expect( calls( 'POST', `${ PATH }/bulk-email` ) ).toHaveLength( 0 );
		expect( calls( 'POST', `${ PATH }/telegram` ) ).toHaveLength( 0 );
		expect( own.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue(
			'Draft subject'
		);
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	it( 'edits its wording without changing the bulk email wording', async () => {
		await renderPage();

		const own = within( section( 'Individual email' ) );
		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( own.getByLabelText( 'Subject' ), {
			target: { value: 'Just for me' },
		} );
		fireEvent.change(
			own.getByLabelText( 'Text above the list of events' ),
			{ target: { value: 'Hi team' } }
		);
		fireEvent.click(
			own.getByLabelText( 'Skip the email when the week has no events' )
		);

		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue(
			'This week: {week_start}'
		);
		expect(
			mail.getByLabelText( 'Text above the list of events' )
		).toHaveValue( 'Hello' );
		expect(
			mail.getByLabelText( 'Skip the email when the week has no events' )
		).toBeChecked();
		expect( mail.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect( own.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	it( 'starts off and cannot be turned on without a recipient', async () => {
		await renderPage( payload( { individual_email: { recipient: '' } } ) );

		const own = within( section( 'Individual email' ) );
		const toggle = own.getByLabelText(
			'Email the weekly summary to this address'
		);
		expect( toggle ).not.toBeChecked();
		const save = own.getByRole( 'button', {
			name: 'Save individual email settings',
		} );
		expect( save ).toBeEnabled();

		fireEvent.click( toggle );

		expect( save ).toBeDisabled();
		expect(
			own.getByText(
				'Enter the email address that receives the weekly email before turning it on.'
			)
		).toBeInTheDocument();
	} );

	it( 'refuses a list of addresses before saving', async () => {
		await renderPage();

		const own = within( section( 'Individual email' ) );
		fireEvent.change( own.getByLabelText( 'Send to' ), {
			target: { value: 'a@example.test, b@example.test' },
		} );

		expect(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		).toBeDisabled();
		expect(
			own.getByText(
				'Enter exactly one email address, for example name@example.com.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows a validation message from the server in its own section', async () => {
		await renderPage( payload(), {
			[ `POST ${ INDIVIDUAL }` ]: () =>
				Promise.reject( {
					message:
						'The selected event feed does not exist or is disabled.',
				} ),
		} );

		const own = within( section( 'Individual email' ) );
		fireEvent.click(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		);

		expect(
			await own.findByText(
				'The selected event feed does not exist or is disabled.'
			)
		).toBeInTheDocument();
		expect(
			within( section( 'Telegram' ) ).queryByText(
				'The selected event feed does not exist or is disabled.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'names the destination of the test and of the preview', async () => {
		await renderPage( payload(), {
			[ `POST ${ INDIVIDUAL }/test` ]: () =>
				Promise.resolve( { sent_to: 'organizer@example.test' } ),
			[ `GET ${ INDIVIDUAL }/preview` ]: () =>
				Promise.resolve( {
					recipient: 'organizer@example.test',
					subject: 'Organizer update: 2026-10-12',
					html: '<p>Concert night</p>',
					empty: false,
					skip_empty: true,
					week_title: '12–18 Oct 2026',
				} ),
		} );

		const own = within( section( 'Individual email' ) );
		fireEvent.click(
			own.getByRole( 'button', { name: 'Preview next email' } )
		);
		expect(
			await own.findByText( 'Organizer update: 2026-10-12' )
		).toBeInTheDocument();
		expect( own.getByText( 'To:' ).parentElement ).toHaveTextContent(
			'To: organizer@example.test'
		);
		expect(
			within(
				own.getByRole( 'group', { name: 'Email preview' } )
			).getByText( 'Concert night' )
		).toBeInTheDocument();

		// The test works while the weekly email is off.
		fireEvent.click(
			own.getByRole( 'button', {
				name: 'Send test email to organizer@example.test',
			} )
		);
		expect(
			await own.findByText(
				'Test email handed over for delivery to organizer@example.test. The schedule is unchanged.'
			)
		).toBeInTheDocument();
		expect( calls( 'POST', `${ PATH }/bulk-email/test` ) ).toHaveLength(
			0
		);
	} );

	it( 'explains the saved empty-week policy in the preview', async () => {
		let skipEmpty = true;
		await renderPage( payload(), {
			[ `GET ${ INDIVIDUAL }/preview` ]: () =>
				Promise.resolve( {
					recipient: 'organizer@example.test',
					subject: 'Organizer update',
					html: '<p>No events are scheduled for 12–18 Oct 2026.</p>',
					empty: true,
					skip_empty: skipEmpty,
					week_title: '12–18 Oct 2026',
				} ),
		} );

		const own = within( section( 'Individual email' ) );
		const previewButton = own.getByRole( 'button', {
			name: 'Preview next email',
		} );
		fireEvent.click( previewButton );
		expect(
			await own.findByText(
				'No events for 12–18 Oct 2026, so no email would be sent.'
			)
		).toBeInTheDocument();

		skipEmpty = false;
		fireEvent.click( previewButton );
		expect(
			await own.findByText(
				'No events for 12–18 Oct 2026. The email below would still be sent.'
			)
		).toBeInTheDocument();
	} );

	it( 'makes preview and test wait for unsaved changes and a saved address', async () => {
		await renderPage();

		const own = within( section( 'Individual email' ) );
		fireEvent.change( own.getByLabelText( 'Send to' ), {
			target: { value: 'other@example.test' },
		} );
		expect(
			own.getByRole( 'button', { name: 'Preview next email' } )
		).toBeDisabled();
		// Still names the saved address, which is where a test would go.
		expect(
			own.getByRole( 'button', {
				name: 'Send test email to organizer@example.test',
			} )
		).toBeDisabled();
		expect(
			own.getByText(
				'Save your changes first — the preview and the test use the saved settings.'
			)
		).toBeInTheDocument();
	} );

	it( 'offers no test without a saved address', async () => {
		await renderPage( payload( { individual_email: { recipient: '' } } ) );

		const own = within( section( 'Individual email' ) );
		expect(
			own.getByRole( 'button', { name: 'Send test email' } )
		).toBeDisabled();
		expect(
			own.getByText( 'Save an email address before sending a test.' )
		).toBeInTheDocument();
	} );

	it( 'keeps an unavailable event feed visible and reports it', async () => {
		await renderPage(
			payload( {
				individual_email: {
					event_selection: 'gone',
					configuration_error:
						'The selected event feed does not exist or is disabled.',
				},
			} )
		);

		const own = within( section( 'Individual email' ) );
		expect( own.getByLabelText( 'Events to include' ) ).toHaveValue(
			'gone'
		);
		expect(
			own.getByRole( 'option', { name: 'gone (unavailable)' } )
		).toBeInTheDocument();
		expect(
			own.getByText(
				'The selected event feed does not exist or is disabled.'
			)
		).toBeInTheDocument();
	} );

	it( 'shows its delivery status, including failures, with the destination', async () => {
		await renderPage(
			payload( {
				individual_email: {
					enabled: true,
					next_run: { time_local: 'October 21, 2026 7:15 am' },
					runs: [
						{
							send_week: '2026-W42',
							week_title: '12–18 Oct 2026',
							destination: 'organizer@example.test',
							status: 'failed',
							message:
								'The site could not hand the email over for delivery. It is not repeated automatically.',
							time_local: 'October 14, 2026 7:15 am',
						},
						{
							send_week: '2026-W41',
							week_title: '5–11 Oct 2026',
							destination: 'organizer@example.test',
							status: 'sent',
							message:
								'Handed over to the site’s mail system. This does not confirm that it reached the inbox.',
							time_local: 'October 7, 2026 7:15 am',
						},
					],
				},
			} )
		);

		const own = within( section( 'Individual email' ) );
		expect(
			own.getByText( 'Next send: October 21, 2026 7:15 am.' )
		).toBeInTheDocument();
		expect( own.getByText( 'Failed' ) ).toBeInTheDocument();
		expect(
			own.getByText( 'Handed over for delivery' )
		).toBeInTheDocument();
		expect( own.getAllByText( 'organizer@example.test' ) ).toHaveLength(
			2
		);
		expect(
			own.getByText(
				'The site could not hand the email over for delivery. It is not repeated automatically.'
			)
		).toBeInTheDocument();
		// A failure here leaves the other channels usable.
		expect(
			within( section( 'Telegram' ) ).getByRole( 'button', {
				name: 'Save Telegram settings',
			} )
		).toBeEnabled();
	} );

	it( 'stays usable without an event feed or Fair Audience', async () => {
		await renderPage( {
			...payload( {
				bulk_email: {
					state: 'inactive',
					state_message:
						'The weekly email is paused because Fair Audience is not active.',
				},
			} ),
			sources: [],
		} );

		expect(
			screen.getByText(
				/Individual email can send all published local events without one\./
			)
		).toBeInTheDocument();
		const own = within( section( 'Individual email' ) );
		expect( own.getByLabelText( 'Events to include' ) ).toHaveValue(
			'@local'
		);
		expect(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		).toBeEnabled();
	} );
} );

describe( 'tokenStatus', () => {
	it( 'never claims that a configured token works', () => {
		expect( tokenStatus( telegram() ) ).toEqual( {
			status: 'info',
			message:
				'A bot token is saved in Connectors. It is not shown here. Send a test to confirm Telegram accepts it.',
		} );
	} );

	it( 'names the override that holds an unusable token', () => {
		const status = tokenStatus(
			telegram( { token_valid: false, token_source: 'env' } )
		);
		expect( status.status ).toBe( 'warning' );
		expect( status.message ).toContain(
			'FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN environment variable'
		);
	} );
} );

describe( 'TelegramMessage', () => {
	it( 'renders bold and link entities and ignores unsafe links', () => {
		render(
			<div data-testid="message">
				<TelegramMessage
					message={ {
						text: 'Calendar\nMon, Concert, Bad',
						entities: [
							{ type: 'bold', offset: 0, length: 8 },
							{
								type: 'text_link',
								offset: 14,
								length: 7,
								url: 'https://example.test/concert',
							},
							{
								type: 'text_link',
								offset: 23,
								length: 3,
								// eslint-disable-next-line no-script-url
								url: 'javascript:alert(1)',
							},
						],
					} }
				/>
			</div>
		);

		const message = screen.getByTestId( 'message' );
		expect( within( message ).getByText( 'Calendar' ).tagName ).toBe(
			'STRONG'
		);
		expect(
			within( message ).getByRole( 'link', { name: 'Concert' } )
		).toHaveAttribute( 'href', 'https://example.test/concert' );
		expect( within( message ).getAllByRole( 'link' ) ).toHaveLength( 1 );
	} );
} );
