/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	configure,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
// React comes with @wordpress/element, which does not re-export Profiler.
// eslint-disable-next-line import/no-extraneous-dependencies
import { Profiler } from 'react';
import apiFetch from '@wordpress/api-fetch';
import { getSettings, setSettings } from '@wordpress/date';
import EventNotifications, { mergeRead } from '../EventNotifications.js';
import { tokenStatus } from '../TelegramChannel.js';
import { dayStartUtc } from '../historyFormat.js';
import { TelegramMessage } from '../TelegramPreview.js';

jest.mock( '@wordpress/api-fetch' );

// A Notice's text is mirrored into the a11y-speak live region, which
// outlives each test; queries look at the page only.
configure( { defaultIgnore: 'script, style, .a11y-speak-region' } );

// jsdom does not scroll; opening a view scrolls to the top.
window.scrollTo = () => {};

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

// The configuration each kind started with: its ID is the kind.
function configuration( type, overrides ) {
	const build = {
		telegram,
		bulk_email: bulkEmail,
		individual_email: individualEmail,
	}[ type ];
	return { id: type, type, name: '', ...build( overrides ) };
}

function payload( channels = {}, extra = [] ) {
	return {
		sources: [
			{ slug: 'city', name: 'City events' },
			{ slug: 'members', name: 'Member events' },
		],
		pages: [ { id: 12, title: 'Calendar' } ],
		types: {
			telegram: { state: 'active', state_message: '' },
			bulk_email: { state: 'active', state_message: '' },
			individual_email: { state: 'active', state_message: '' },
		},
		configurations: [
			configuration( 'telegram', channels.telegram ),
			configuration( 'bulk_email', channels.bulk_email ),
			configuration( 'individual_email', channels.individual_email ),
			...extra,
		],
	};
}

const SAVE_ROUTE = /\/configurations\/([a-z0-9_-]+)$/;

// A save answers with the configuration it saved; handlers may describe
// it as the whole page it belongs to.
function savedConfiguration( response, id ) {
	return response?.configurations
		? response.configurations.find( ( shown ) => shown.id === id )
		: response;
}

// A paginated history response, read without parsing for its headers.
function historyResponse( items, total = items.length, totalPages = 1 ) {
	const headers = {
		'X-WP-Total': String( total ),
		'X-WP-TotalPages': String( totalPages ),
	};
	return Promise.resolve( {
		json: () => Promise.resolve( items ),
		headers: { get: ( name ) => headers[ name ] ?? null },
	} );
}

// A refused history request, as apiFetch rejects one read without parsing.
function historyRefusal( body ) {
	return Promise.reject( { json: () => Promise.resolve( body ) } );
}

function execution( overrides = {} ) {
	return {
		id: 7,
		configuration: {
			id: 'telegram',
			name: '',
			name_source: 'snapshot',
			exists: true,
		},
		channel: 'telegram',
		origin: 'scheduled',
		occurrence: '2026-W42',
		week_start: '2026-10-12',
		week_end: '2026-10-18',
		lifecycle: 'completed',
		outcome: 'partial',
		reason_code: '',
		counts: {
			unit: 'message_parts',
			accepted: 1,
			failed: 1,
			skipped: 0,
			unknown: 0,
		},
		completeness: 'complete',
		legacy: null,
		started_at: '2026-10-12T08:30:00Z',
		finished_at: '2026-10-12T08:31:00Z',
		...overrides,
	};
}

function delivery( overrides = {} ) {
	return {
		id: 1,
		recipient: '@fair_channel',
		recipient_name: '',
		part: 1,
		part_count: 2,
		outcome: 'accepted',
		reason_code: '',
		legacy: false,
		attempted_at: '2026-10-12T08:30:10Z',
		finished_at: '2026-10-12T08:30:11Z',
		...overrides,
	};
}

/**
 * Answers each request by its method and path without the query: a
 * handler receives the request, and `query( options )` reads its query.
 * History routes are read without parsing; unhandled ones are empty.
 *
 * @param {Object} initial  Page payload.
 * @param {Object} handlers Responses by "METHOD /path".
 */
function mockApi( initial, handlers = {} ) {
	apiFetch.mockImplementation( ( options ) => {
		const [ path ] = options.path.split( '?' );
		const key = `${ options.method || 'GET' } ${ path }`;
		if ( handlers[ key ] ) {
			const result = handlers[ key ]( options );
			const saved = path.match( SAVE_ROUTE );
			return 'POST' === options.method && saved
				? result.then( ( response ) =>
						savedConfiguration( response, saved[ 1 ] )
					)
				: result;
		}
		if ( false === options.parse ) {
			return historyResponse( [] );
		}
		return Promise.resolve( initial );
	} );
}

function query( options ) {
	return Object.fromEntries(
		new URLSearchParams( options.path.split( '?' )[ 1 ] || '' )
	);
}

const ADMIN = '/wp-admin/admin.php?page=fair-events-event-notifications';

function visit( search = '' ) {
	window.history.replaceState( null, '', `${ ADMIN }${ search }` );
}

function currentSearch() {
	return Object.fromEntries( new URLSearchParams( window.location.search ) );
}

/**
 * Render the page on one notification's editor, by ID, or on the list.
 *
 * @param {Object}      initial  Page payload.
 * @param {Object}      handlers Responses by "METHOD /path".
 * @param {string|null} open     Configuration ID to open, or null for the list.
 */
async function renderPage(
	initial = payload(),
	handlers = {},
	open = 'telegram'
) {
	visit( open ? `&configuration=${ open }` : '' );
	mockApi( initial, handlers );
	render( <EventNotifications sourcesUrl={ null } /> );
	if ( open ) {
		await screen.findByRole( 'navigation', {
			name: 'Notification sections',
		} );
	} else {
		await screen.findByRole( 'textbox', { name: 'Search notifications' } );
	}
}

/**
 * The open notification's view, after checking it is the named one.
 *
 * @param {string} name Name the view is headed with.
 * @return {HTMLElement} The page.
 */
function section( name ) {
	expect(
		screen.getByRole( 'heading', {
			level: 2,
			name: new RegExp( `^${ name }( |$)` ),
		} )
	).toBeInTheDocument();
	return document.querySelector( '.fair-events-notifications' );
}

// Through the list, as an administrator would.
async function openNotification( name ) {
	const back = screen.queryByRole( 'link', {
		name: '← All notifications',
	} );
	if ( back ) {
		fireEvent.click( back );
	}
	const table = within( await screen.findByRole( 'table' ) );
	fireEvent.click( table.getAllByRole( 'link', { name } )[ 0 ] );
	await screen.findByRole( 'navigation', {
		name: 'Notification sections',
	} );
	return within( section( name ) );
}

function calls( method, path ) {
	return apiFetch.mock.calls.filter(
		( [ options ] ) =>
			( options.method || 'GET' ) === method && options.path === path
	);
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( yes, no ) => {
		resolve = yes;
		reject = no;
	} );
	return { promise, resolve, reject };
}

// Coming back to the tab re-reads the page.
async function returnToPage() {
	await act( async () => {
		window.dispatchEvent( new Event( 'focus' ) );
	} );
}

function leavingIsGuarded() {
	const event = new Event( 'beforeunload', { cancelable: true } );
	window.dispatchEvent( event );
	return event.defaultPrevented;
}

/**
 * Open a list row's action menu.
 *
 * @param {HTMLElement} row  The row.
 * @param {string}      name The notification's name, as the menu names it.
 * @return {Promise<Object>} Queries within the open menu.
 */
async function rowMenu( row, name ) {
	fireEvent.click(
		within( row ).getByRole( 'button', {
			name: `More actions for “${ name }”`,
			hidden: true,
		} )
	);
	return within( await screen.findByRole( 'menu' ) );
}

/**
 * Click a link and tell whether the page left the click to the browser,
 * without letting jsdom try to follow it.
 *
 * @param {HTMLElement} link The link.
 * @param {Object}      init Event properties, e.g. `{ ctrlKey: true }`.
 * @return {boolean} Whether the browser would follow the link.
 */
function clickLeftToBrowser( link, init ) {
	let left = null;
	const listener = ( event ) => {
		left = ! event.defaultPrevented;
		event.preventDefault();
	};
	document.addEventListener( 'click', listener );
	fireEvent.click( link, init );
	document.removeEventListener( 'click', listener );
	return left;
}

async function waitForMenuToClose() {
	await waitFor( () =>
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument()
	);
}

/**
 * Choose an action from a list row's menu.
 *
 * @param {HTMLElement} row    The row.
 * @param {string}      name   The notification's name.
 * @param {string}      action Menu item label.
 */
async function chooseAction( row, name, action ) {
	const menu = await rowMenu( row, name );
	// The action's request may settle at once; let it inside act().
	await act( async () => {
		fireEvent.click( menu.getByRole( 'menuitem', { name: action } ) );
	} );
}

afterEach( () => {
	jest.resetAllMocks();
	visit();
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

		const mail = await openNotification( 'Bulk email' );
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
			const view = await openNotification( name );
			expect(
				view.getByText(
					/Previews and tests select the week relative to today in the site timezone\. Scheduled sends select it relative to their scheduled week\./
				)
			).toBeInTheDocument();
		}
		expect(
			screen.queryByText( /next scheduled week/ )
		).not.toBeInTheDocument();
	} );

	it( 'saves only the Telegram settings and keeps the unsaved bulk email draft', async () => {
		let current = payload();
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `POST ${ PATH }/configurations/telegram` ]: () => {
					current = payload( { telegram: { time_of_day: '18:00' } } );
					return Promise.resolve( current );
				},
			},
			'bulk_email'
		);

		fireEvent.change(
			within( section( 'Bulk email' ) ).getByLabelText( 'Subject' ),
			{ target: { value: 'Draft subject' } }
		);
		const tg = await openNotification( 'Telegram' );
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '18:00' },
		} );
		expect( tg.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		fireEvent.click(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
		);

		expect(
			await tg.findByText( 'Telegram settings saved.' )
		).toBeInTheDocument();
		expect(
			calls( 'POST', `${ PATH }/configurations/telegram` )[ 0 ][ 0 ].data
		).toEqual( {
			name: '',
			enabled: false,
			source_slug: 'city',
			page_id: 12,
			day_of_week: 5,
			time_of_day: '18:00',
			week_scope: 'next',
			chat_ids: '@fair_channel',
		} );
		expect(
			calls( 'POST', `${ PATH }/configurations/bulk_email` )
		).toHaveLength( 0 );
		expect( tg.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();

		// The list marks the draft left behind, and it is there on return.
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		const bulkRow = ( await screen.findAllByRole( 'row' ) ).find( ( row ) =>
			within( row ).queryByRole( 'link', { name: 'Bulk email' } )
		);
		expect(
			within( bulkRow ).getByText( 'Unsaved changes' )
		).toBeInTheDocument();
		const mail = await openNotification( 'Bulk email' );
		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue(
			'Draft subject'
		);
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	it( 'saves the bulk email wording with its own button', async () => {
		const saved = payload( { bulk_email: { outro: 'See you' } } );
		await renderPage(
			payload(),
			{
				[ `POST ${ PATH }/configurations/bulk_email` ]: () =>
					Promise.resolve( saved ),
			},
			'bulk_email'
		);

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
			calls( 'POST', `${ PATH }/configurations/bulk_email` )[ 0 ][ 0 ]
				.data
		).toMatchObject( {
			source_slug: 'members',
			subject: 'This week: {week_start}',
			intro: 'Hello',
			outro: 'See you',
			skip_empty: true,
		} );
		expect(
			calls( 'POST', `${ PATH }/configurations/telegram` )
		).toHaveLength( 0 );
	} );

	it( 'shows a failed save in the editor it belongs to', async () => {
		await renderPage( payload(), {
			[ `POST ${ PATH }/configurations/telegram` ]: () =>
				Promise.reject( { message: 'Choose an event feed.' } ),
		} );

		const tg = within( section( 'Telegram' ) );
		fireEvent.click(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
		);

		expect(
			await tg.findByText( 'Choose an event feed.' )
		).toBeInTheDocument();
		const mail = await openNotification( 'Bulk email' );
		expect(
			mail.queryByText( 'Choose an event feed.' )
		).not.toBeInTheDocument();
	} );

	it( 'names the Telegram test destinations and reports each result', async () => {
		await renderPage(
			payload( { telegram: { chat_ids: [ '@one', '@two' ] } } ),
			{
				[ `POST ${ PATH }/configurations/telegram/test` ]: () =>
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
		await renderPage(
			payload(),
			{
				[ `POST ${ PATH }/configurations/bulk_email/test` ]: () =>
					Promise.resolve( { sent_to: 'admin@example.test' } ),
			},
			'bulk_email'
		);

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
		await renderPage(
			payload(),
			{
				[ `GET ${ PATH }/configurations/bulk_email/preview` ]: () =>
					Promise.resolve( {
						subject: 'This week: 2026-10-12',
						html: '<p>Concert night</p>',
						empty: false,
						week_title: '12–18 Oct 2026',
					} ),
			},
			'bulk_email'
		);

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
		await renderPage( payload(), {}, 'bulk_email' );

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
			} ),
			{},
			'bulk_email'
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
		const tg = await openNotification( 'Telegram' );
		expect(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
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

	it( 'says what is missing when there is no event feed', async () => {
		mockApi( { ...payload(), sources: [] } );
		render( <EventNotifications sourcesUrl="/wp-admin/sources" /> );

		expect(
			await screen.findByRole( 'link', {
				name: 'Create an event feed',
			} )
		).toHaveAttribute( 'href', '/wp-admin/sources' );
	} );

	it( 'reports a failed load and loads again on request', async () => {
		apiFetch.mockRejectedValueOnce( { message: 'Sorry, not allowed.' } );
		apiFetch.mockResolvedValue( payload() );
		render( <EventNotifications sourcesUrl={ null } /> );

		// The notice text is also announced through the a11y speak region.
		expect(
			( await screen.findAllByText( 'Sorry, not allowed.' ) ).length
		).toBeGreaterThan( 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect(
			await screen.findByRole( 'textbox', {
				name: 'Search notifications',
			} )
		).toBeInTheDocument();
	} );

	it( 'warns before leaving with unsaved changes, also from another view', async () => {
		await renderPage();
		expect( leavingIsGuarded() ).toBe( false );

		fireEvent.change(
			within( section( 'Telegram' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '07:00' } }
		);
		await waitFor( () => expect( leavingIsGuarded() ).toBe( true ) );

		// The draft is kept while the list is shown, so leaving still warns.
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'textbox', { name: 'Search notifications' } );
		expect( leavingIsGuarded() ).toBe( true );
	} );
} );

describe( 'Independent editors', () => {
	it( 'keeps three drafts apart while one of them is saved', async () => {
		let current = payload();
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `POST ${ PATH }/configurations/bulk_email` ]: () => {
					current = payload( {
						bulk_email: { subject: 'Saved subject' },
					} );
					return Promise.resolve( current );
				},
			},
			'telegram'
		);

		fireEvent.change(
			within( section( 'Telegram' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '21:00' } }
		);
		const own = await openNotification( 'Individual email' );
		fireEvent.change( own.getByLabelText( 'Send to' ), {
			target: { value: 'a@example.test, b@example.test' },
		} );
		// Its validation blocks only its own save.
		expect(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		).toBeDisabled();

		const mail = await openNotification( 'Bulk email' );
		expect(
			mail.queryByText(
				'Enter exactly one email address, for example name@example.com.'
			)
		).not.toBeInTheDocument();
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Saved subject' },
		} );
		fireEvent.click(
			mail.getByRole( 'button', { name: 'Save bulk email settings' } )
		);
		expect(
			await mail.findByText( 'Bulk email settings saved.' )
		).toBeInTheDocument();
		expect( mail.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();

		const tg = await openNotification( 'Telegram' );
		expect( tg.getByLabelText( 'Send at' ) ).toHaveValue( '21:00' );
		expect( tg.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect( tg.queryByText( 'Bulk email settings saved.' ) ).toBeNull();
		const again = await openNotification( 'Individual email' );
		expect( again.getByLabelText( 'Send to' ) ).toHaveValue(
			'a@example.test, b@example.test'
		);
		expect( again.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect( leavingIsGuarded() ).toBe( true );
	} );

	it( 'keeps edits typed while a save is pending', async () => {
		const request = deferred();
		await renderPage( payload(), {
			[ `POST ${ PATH }/configurations/telegram` ]: () => request.promise,
		} );

		const tg = within( section( 'Telegram' ) );
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '18:00' },
		} );
		const save = tg.getByRole( 'button', {
			name: 'Save Telegram settings',
		} );
		fireEvent.click( save );
		fireEvent.click( save );

		// Pending: no second request, and the test waits for the save.
		expect(
			calls( 'POST', `${ PATH }/configurations/telegram` )
		).toHaveLength( 1 );
		expect( save ).toBeDisabled();
		expect(
			tg.getByRole( 'button', { name: 'Send test to the saved chats' } )
		).toBeDisabled();

		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '19:00' },
		} );
		await act( async () => {
			request.resolve(
				payload( { telegram: { time_of_day: '18:00' } } )
			);
		} );

		expect(
			await tg.findByText( 'Telegram settings saved.' )
		).toBeInTheDocument();
		expect( tg.getByLabelText( 'Send at' ) ).toHaveValue( '19:00' );
		expect( tg.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

		// Back to the value just saved: nothing is left unsaved.
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '18:00' },
		} );
		expect( tg.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the draft after a failed save and lets it be retried', async () => {
		let attempt = 0;
		await renderPage(
			payload(),
			{
				[ `POST ${ PATH }/configurations/bulk_email` ]: () =>
					0 === attempt++
						? Promise.reject( { message: 'Choose an event feed.' } )
						: Promise.resolve(
								payload( { bulk_email: { subject: 'Retry' } } )
							),
			},
			'bulk_email'
		);

		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Retry' },
		} );
		const save = mail.getByRole( 'button', {
			name: 'Save bulk email settings',
		} );
		fireEvent.click( save );
		expect(
			await mail.findByText( 'Choose an event feed.' )
		).toBeInTheDocument();
		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue( 'Retry' );
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect( save ).toBeEnabled();

		fireEvent.click( save );
		expect(
			await mail.findByText( 'Bulk email settings saved.' )
		).toBeInTheDocument();
		expect(
			mail.queryByText( 'Choose an event feed.' )
		).not.toBeInTheDocument();
	} );

	it( 'updates connector availability on return without losing edits', async () => {
		let current = payload( {
			telegram: { token_configured: false, token_valid: false },
		} );
		await renderPage( current, {
			[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
		} );

		const tg = within( section( 'Telegram' ) );
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '07:00' },
		} );
		expect(
			tg.getByText( /No bot token is configured/ )
		).toBeInTheDocument();

		current = payload();
		await returnToPage();

		expect(
			await tg.findByText( /A bot token is saved in Connectors/ )
		).toBeInTheDocument();
		expect( tg.getByLabelText( 'Send at' ) ).toHaveValue( '07:00' );
		expect( tg.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect(
			tg.queryByText(
				'Fix the bot token in Connectors before sending a test message.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'keeps unsaved edits while a channel is unavailable and restores them', async () => {
		const paused = {
			state: 'inactive',
			state_message:
				'The weekly email is paused because Fair Audience is not active.',
		};
		let current = payload();
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
			},
			'bulk_email'
		);

		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'Kept draft' },
		} );

		current = payload( { bulk_email: paused } );
		await returnToPage();
		expect(
			await mail.findByText( /paused because Fair Audience/ )
		).toBeInTheDocument();
		expect( mail.queryByLabelText( 'Subject' ) ).not.toBeInTheDocument();
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
		expect(
			mail.getByText(
				'Your unsaved changes are kept and shown again here once this channel is available.'
			)
		).toBeInTheDocument();
		expect( leavingIsGuarded() ).toBe( true );

		// Its history stays available meanwhile.
		fireEvent.click( mail.getByRole( 'link', { name: 'History' } ) );
		expect(
			await screen.findByText( 'Nothing has been sent or tested yet.' )
		).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'link', { name: 'Settings' } ) );

		current = payload();
		await returnToPage();
		expect( await screen.findByLabelText( 'Subject' ) ).toHaveValue(
			'Kept draft'
		);
		expect( mail.getByText( 'Unsaved changes' ) ).toBeInTheDocument();
	} );

	it( 'shows the saved settings once an unavailable channel becomes active', async () => {
		let current = payload( {
			bulk_email: {
				state: 'inactive',
				state_message:
					'The weekly email is paused because Fair Audience is not active.',
			},
		} );
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
			},
			'bulk_email'
		);

		const mail = within( section( 'Bulk email' ) );
		expect( mail.queryByLabelText( 'Subject' ) ).not.toBeInTheDocument();

		current = payload( { bulk_email: { subject: 'Changed meanwhile' } } );
		await returnToPage();

		expect( await mail.findByLabelText( 'Subject' ) ).toHaveValue(
			'Changed meanwhile'
		);
		expect( mail.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect(
			mail.getByRole( 'button', { name: 'Save bulk email settings' } )
		).toBeEnabled();
	} );

	it( 'follows saved settings changed elsewhere unless the form holds edits', async () => {
		let current = payload();
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
			},
			'bulk_email'
		);

		const mail = within( section( 'Bulk email' ) );
		fireEvent.change( mail.getByLabelText( 'Subject' ), {
			target: { value: 'My draft' },
		} );

		current = payload( {
			telegram: { time_of_day: '12:00' },
			bulk_email: { subject: 'Saved in another tab' },
		} );
		await returnToPage();

		// The dirty form keeps its draft and warns before replacing them.
		expect( mail.getByLabelText( 'Subject' ) ).toHaveValue( 'My draft' );
		expect(
			await mail.findByText(
				'These settings were saved somewhere else, for example in another tab, after you started editing. Saving replaces them with the values shown here.'
			)
		).toBeInTheDocument();

		// A clean one follows the saved settings.
		const tg = await openNotification( 'Telegram' );
		expect( await tg.findByDisplayValue( '12:00' ) ).toBeInTheDocument();
		expect( tg.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect(
			tg.queryByText( /These settings were saved somewhere else/ )
		).not.toBeInTheDocument();
	} );

	it( 'ignores a read that started before a save finished', async () => {
		const read = deferred();
		let reads = 0;
		await renderPage( payload(), {
			[ `GET ${ PATH }` ]: () =>
				0 === reads++ ? Promise.resolve( payload() ) : read.promise,
			[ `POST ${ PATH }/configurations/telegram` ]: () =>
				Promise.resolve(
					payload( { telegram: { time_of_day: '18:00' } } )
				),
		} );

		const tg = within( section( 'Telegram' ) );
		await returnToPage();
		fireEvent.change( tg.getByLabelText( 'Send at' ), {
			target: { value: '18:00' },
		} );
		fireEvent.click(
			tg.getByRole( 'button', { name: 'Save Telegram settings' } )
		);
		expect(
			await tg.findByText( 'Telegram settings saved.' )
		).toBeInTheDocument();

		// The older read still has the previous time.
		await act( async () => {
			read.resolve( payload() );
		} );

		expect( tg.getByLabelText( 'Send at' ) ).toHaveValue( '18:00' );
		expect( tg.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
		expect(
			tg.queryByText( /These settings were saved somewhere else/ )
		).not.toBeInTheDocument();
	} );

	it( 'drops a preview that no longer matches the saved settings', async () => {
		const preview = deferred();
		let current = payload();
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `GET ${ PATH }/configurations/bulk_email/preview` ]: () =>
					preview.promise,
			},
			'bulk_email'
		);

		const mail = within( section( 'Bulk email' ) );
		fireEvent.click(
			mail.getByRole( 'button', { name: 'Preview next email' } )
		);
		current = payload( { bulk_email: { subject: 'Saved elsewhere' } } );
		await returnToPage();
		expect(
			await mail.findByDisplayValue( 'Saved elsewhere' )
		).toBeVisible();

		await act( async () => {
			preview.resolve( {
				subject: 'Old subject',
				html: '<p>Old</p>',
				empty: false,
				week_title: '12–18 Oct 2026',
			} );
		} );

		expect( mail.queryByText( 'Old subject' ) ).not.toBeInTheDocument();
		expect(
			mail.getByRole( 'button', { name: 'Preview next email' } )
		).toBeEnabled();
	} );

	it( 'clears a shown preview once the settings are saved', async () => {
		await renderPage(
			payload(),
			{
				[ `GET ${ PATH }/configurations/individual_email/preview` ]:
					() =>
						Promise.resolve( {
							recipient: 'organizer@example.test',
							subject: 'Organizer update: 2026-10-12',
							html: '<p>Concert night</p>',
							empty: false,
							skip_empty: true,
							week_title: '12–18 Oct 2026',
						} ),
				[ `POST ${ PATH }/configurations/individual_email` ]: () =>
					Promise.resolve(
						payload( { individual_email: { subject: 'New' } } )
					),
			},
			'individual_email'
		);

		const own = within( section( 'Individual email' ) );
		fireEvent.click(
			own.getByRole( 'button', { name: 'Preview next email' } )
		);
		expect(
			await own.findByText( 'Organizer update: 2026-10-12' )
		).toBeInTheDocument();

		fireEvent.change( own.getByLabelText( 'Subject' ), {
			target: { value: 'New' },
		} );
		fireEvent.click(
			own.getByRole( 'button', {
				name: 'Save individual email settings',
			} )
		);
		expect(
			await own.findByText( 'Individual email settings saved.' )
		).toBeInTheDocument();
		expect(
			own.queryByText( 'Organizer update: 2026-10-12' )
		).not.toBeInTheDocument();
	} );
} );

describe( 'Save completion', () => {
	const kinds = [
		{
			id: 'telegram',
			name: 'Telegram',
			previewButton: 'Preview next Telegram message',
			preview: {
				occurrence_count: 1,
				week_title: '12–18 Oct 2026',
				messages: [ { text: 'Shown before the save', entities: [] } ],
			},
			field: 'Send at',
			value: '18:00',
			changes: { time_of_day: '18:00' },
			saveButton: 'Save Telegram settings',
			saved: 'Telegram settings saved.',
		},
		{
			id: 'bulk_email',
			name: 'Bulk email',
			previewButton: 'Preview next email',
			preview: {
				subject: 'Shown before the save',
				html: '<p>Concert night</p>',
				empty: false,
				week_title: '12–18 Oct 2026',
			},
			field: 'Subject',
			value: 'New',
			changes: { subject: 'New' },
			saveButton: 'Save bulk email settings',
			saved: 'Bulk email settings saved.',
		},
		{
			id: 'individual_email',
			name: 'Individual email',
			previewButton: 'Preview next email',
			preview: {
				recipient: 'organizer@example.test',
				subject: 'Shown before the save',
				html: '<p>Concert night</p>',
				empty: false,
				skip_empty: true,
				week_title: '12–18 Oct 2026',
			},
			field: 'Subject',
			value: 'New',
			changes: { subject: 'New' },
			saveButton: 'Save individual email settings',
			saved: 'Individual email settings saved.',
		},
	];

	// After every commit, before effects or the next assertion: a screen
	// that says "saved" must not show what the save replaced.
	function watchCommits( savedText ) {
		const stale = [];
		const onRender = () => {
			const page = document.querySelector( '.fair-events-notifications' );
			if ( ! page?.textContent.includes( savedText ) ) {
				return;
			}
			if (
				page.querySelector( 'h2 .fair-events-notifications__unsaved' )
			) {
				stale.push( 'Unsaved changes' );
			}
			if ( page.textContent.includes( 'Shown before the save' ) ) {
				stale.push( 'preview' );
			}
		};
		return { stale, onRender };
	}

	it.each( kinds )(
		'shows the $name notice without the old preview or unsaved marker',
		async ( kind ) => {
			visit( `&configuration=${ kind.id }` );
			mockApi( payload(), {
				[ `GET ${ PATH }/configurations/${ kind.id }/preview` ]: () =>
					Promise.resolve( kind.preview ),
				[ `POST ${ PATH }/configurations/${ kind.id }` ]: () =>
					Promise.resolve( payload( { [ kind.id ]: kind.changes } ) ),
			} );
			const commits = watchCommits( kind.saved );
			render(
				<Profiler id="page" onRender={ commits.onRender }>
					<EventNotifications sourcesUrl={ null } />
				</Profiler>
			);
			await screen.findByRole( 'navigation', {
				name: 'Notification sections',
			} );

			const editor = within( section( kind.name ) );
			fireEvent.click(
				editor.getByRole( 'button', { name: kind.previewButton } )
			);
			expect(
				await editor.findByText( /Shown before the save/ )
			).toBeInTheDocument();
			fireEvent.change( editor.getByLabelText( kind.field ), {
				target: { value: kind.value },
			} );
			expect( editor.getByText( 'Unsaved changes' ) ).toBeInTheDocument();

			fireEvent.click(
				editor.getByRole( 'button', { name: kind.saveButton } )
			);

			expect( await editor.findByText( kind.saved ) ).toBeInTheDocument();
			expect(
				editor.queryByText( /Shown before the save/ )
			).not.toBeInTheDocument();
			expect(
				editor.queryByText( 'Unsaved changes' )
			).not.toBeInTheDocument();
			expect( leavingIsGuarded() ).toBe( false );
			expect( commits.stale ).toEqual( [] );
		}
	);
} );

describe( 'Individual email', () => {
	const INDIVIDUAL = `${ PATH }/configurations/individual_email`;

	async function renderIndividual( initial = payload(), handlers = {} ) {
		await renderPage( initial, handlers, 'individual_email' );
		return within( section( 'Individual email' ) );
	}

	it( 'has its own recipient, schedule and event selection', async () => {
		const own = await renderIndividual();

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
	} );

	it( 'saves only its own settings and keeps the unsaved bulk email draft', async () => {
		const saved = payload( {
			individual_email: {
				enabled: true,
				recipient: 'team@example.test',
				event_selection: 'city',
				time_of_day: '06:00',
			},
		} );
		await renderPage(
			payload(),
			{
				[ `POST ${ INDIVIDUAL }` ]: () => Promise.resolve( saved ),
			},
			'bulk_email'
		);

		fireEvent.change(
			within( section( 'Bulk email' ) ).getByLabelText( 'Subject' ),
			{ target: { value: 'Draft subject' } }
		);
		const own = await openNotification( 'Individual email' );
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
			name: '',
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
		expect(
			calls( 'POST', `${ PATH }/configurations/bulk_email` )
		).toHaveLength( 0 );
		expect(
			calls( 'POST', `${ PATH }/configurations/telegram` )
		).toHaveLength( 0 );
		expect( own.queryByText( 'Unsaved changes' ) ).not.toBeInTheDocument();
	} );

	it( 'edits its wording without changing the bulk email wording', async () => {
		const own = await renderIndividual();

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

		const mail = await openNotification( 'Bulk email' );
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
	} );

	it( 'starts off and cannot be turned on without a recipient', async () => {
		const own = await renderIndividual(
			payload( { individual_email: { recipient: '' } } )
		);

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
		const own = await renderIndividual();

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

	it( 'shows a validation message from the server', async () => {
		const own = await renderIndividual( payload(), {
			[ `POST ${ INDIVIDUAL }` ]: () =>
				Promise.reject( {
					message:
						'The selected event feed does not exist or is disabled.',
				} ),
		} );

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
	} );

	it( 'names the destination of the test and of the preview', async () => {
		const own = await renderIndividual( payload(), {
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
		expect(
			calls( 'POST', `${ PATH }/configurations/bulk_email/test` )
		).toHaveLength( 0 );
	} );

	it( 'explains the saved empty-week policy in the preview', async () => {
		let skipEmpty = true;
		const own = await renderIndividual( payload(), {
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
		const own = await renderIndividual();

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
		const own = await renderIndividual(
			payload( { individual_email: { recipient: '' } } )
		);

		expect(
			own.getByRole( 'button', { name: 'Send test email' } )
		).toBeDisabled();
		expect(
			own.getByText( 'Save an email address before sending a test.' )
		).toBeInTheDocument();
	} );

	it( 'keeps an unavailable event feed visible and reports it', async () => {
		const own = await renderIndividual(
			payload( {
				individual_email: {
					event_selection: 'gone',
					configuration_error:
						'The selected event feed does not exist or is disabled.',
				},
			} )
		);

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

	it( 'stays usable without an event feed or Fair Audience', async () => {
		const own = await renderIndividual( {
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
			screen.getAllByText(
				/Individual email can send all published local events without one\./
			).length
		).toBeGreaterThan( 0 );
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

describe( 'Several notifications of one kind', () => {
	const MEMBERS = `${ PATH }/configurations/members-id`;

	function members( overrides ) {
		return {
			...configuration( 'telegram', {
				source_slug: 'members',
				chat_ids: [ '@members' ],
				time_of_day: '07:00',
			} ),
			id: 'members-id',
			name: 'Members',
			...overrides,
		};
	}

	it( 'lists each one under its own name and kind', async () => {
		await renderPage( payload( {}, [ members() ] ), {}, null );

		const row = ( await screen.findAllByRole( 'row' ) ).find( ( shown ) =>
			within( shown ).queryByRole( 'link', { name: 'Members' } )
		);
		expect( within( row ).getByText( 'Telegram' ) ).toBeInTheDocument();
		expect( within( row ).getByText( '@members' ) ).toBeInTheDocument();

		const named = await openNotification( 'Members' );
		expect( named.getByLabelText( 'Name' ) ).toHaveValue( 'Members' );
		expect( named.getByLabelText( 'Send at' ) ).toHaveValue( '07:00' );
		const first = await openNotification( 'Telegram' );
		expect( first.getByLabelText( 'Send at' ) ).toHaveValue( '10:30' );
	} );

	it( 'saves and pauses one by its ID and keeps the other draft of the same kind', async () => {
		let current = payload( {}, [ members( { enabled: true } ) ] );
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `POST ${ MEMBERS }` ]: ( options ) => {
					const saved = members( {
						name: options.data.name,
						enabled: options.data.enabled,
						time_of_day: options.data.time_of_day,
					} );
					current = payload( {}, [ saved ] );
					return Promise.resolve( saved );
				},
			},
			'telegram'
		);

		fireEvent.change(
			within( section( 'Telegram' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '12:00' } }
		);
		const named = await openNotification( 'Members' );
		fireEvent.change( named.getByLabelText( 'Send at' ), {
			target: { value: '19:15' },
		} );
		fireEvent.change( named.getByLabelText( 'Name' ), {
			target: { value: 'Members only' },
		} );
		fireEvent.click(
			named.getByLabelText( 'Post the weekly summary to Telegram' )
		);
		fireEvent.click(
			named.getByRole( 'button', { name: 'Save Telegram settings' } )
		);

		expect(
			await screen.findByRole( 'heading', { name: /^Members only/ } )
		).toBeInTheDocument();
		expect( calls( 'POST', MEMBERS )[ 0 ][ 0 ].data ).toMatchObject( {
			name: 'Members only',
			enabled: false,
			time_of_day: '19:15',
		} );
		expect(
			calls( 'POST', `${ PATH }/configurations/telegram` )
		).toHaveLength( 0 );

		// The list shows it paused, and the other one untouched.
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		const rows = await screen.findAllByRole( 'row' );
		const row = ( name ) =>
			rows.find( ( shown ) =>
				within( shown ).queryByRole( 'link', { name } )
			);
		expect(
			within( row( 'Members only' ) ).getByText( 'Paused' )
		).toBeInTheDocument();
		expect(
			within( row( 'Telegram' ) ).getByText( 'Unsaved changes' )
		).toBeInTheDocument();
		const first = await openNotification( 'Telegram' );
		expect( first.getByLabelText( 'Send at' ) ).toHaveValue( '12:00' );
	} );

	it( 'adds a paused notification of the chosen kind and opens it', async () => {
		await renderPage(
			payload(),
			{
				[ `POST ${ PATH }/configurations` ]: ( options ) =>
					Promise.resolve(
						members( {
							name: options.data.name,
							enabled: false,
						} )
					),
			},
			null
		);

		const add = within(
			screen
				.getByRole( 'heading', { name: 'Add a notification' } )
				.closest( '.fair-events-notifications__channel' )
		);
		fireEvent.change( add.getByLabelText( 'Kind' ), {
			target: { value: 'telegram' },
		} );
		fireEvent.change( add.getByLabelText( 'Name' ), {
			target: { value: ' Members ' },
		} );
		fireEvent.click(
			add.getByRole( 'button', { name: 'Add notification' } )
		);

		expect(
			await screen.findByText(
				'“Members” was added. It is paused: set it up, turn it on and save it when it is ready.'
			)
		).toBeInTheDocument();
		const named = within( section( 'Members' ) );
		expect(
			named.getByLabelText( 'Post the weekly summary to Telegram' )
		).not.toBeChecked();
		expect( currentSearch() ).toMatchObject( {
			configuration: 'members-id',
		} );
		expect(
			calls( 'POST', `${ PATH }/configurations` )[ 0 ][ 0 ].data
		).toEqual( { type: 'telegram', name: 'Members' } );

		// The message belongs to the view it was shown in.
		fireEvent.click( named.getByRole( 'link', { name: 'History' } ) );
		expect(
			screen.queryByText( /“Members” was added/ )
		).not.toBeInTheDocument();
		// The history itself loads afterwards.
		expect(
			await screen.findByText( 'Nothing has been sent or tested yet.' )
		).toBeInTheDocument();
	} );

	it( 'explains why a kind cannot be added now', async () => {
		const page = payload();
		page.types.bulk_email = {
			state: 'inactive',
			state_message:
				'The weekly email is paused because Fair Audience is not active.',
		};
		await renderPage( page, {}, null );

		const add = within(
			screen
				.getByRole( 'heading', { name: 'Add a notification' } )
				.closest( '.fair-events-notifications__channel' )
		);
		fireEvent.change( add.getByLabelText( 'Kind' ), {
			target: { value: 'bulk_email' },
		} );

		expect(
			add.getByRole( 'button', { name: 'Add notification' } )
		).toBeDisabled();
		expect(
			add.getByText(
				'The weekly email is paused because Fair Audience is not active.'
			)
		).toBeInTheDocument();
	} );

	it( 'keeps a notification added after a read was issued', () => {
		const current = payload( {}, [ members() ] );
		const read = payload();

		const shown = mergeRead( current, read, 3, { 'members-id': 4 } );

		expect( shown.configurations.map( ( { id } ) => id ) ).toEqual( [
			'telegram',
			'bulk_email',
			'individual_email',
			'members-id',
		] );
		expect(
			mergeRead( current, read, 5, { 'members-id': 4 } ).configurations
		).toHaveLength( 3 );
	} );
} );

describe( 'Notification list', () => {
	function rowOf( name ) {
		return screen
			.getAllByRole( 'row' )
			.find( ( row ) => within( row ).queryByRole( 'link', { name } ) );
	}

	it( 'summarizes each notification with its audience, state, next and latest send', async () => {
		await renderPage(
			payload( {
				telegram: {
					enabled: true,
					next_run: { time_local: 'October 16, 2026 10:30 am' },
					latest_execution: execution( { id: 41 } ),
				},
				bulk_email: {
					state: 'inactive',
					state_message:
						'The weekly email is paused because Fair Audience is not active.',
				},
				individual_email: {
					latest_execution: execution( {
						id: 42,
						origin: 'test',
						channel: 'individual_email',
						outcome: 'success',
						configuration: {
							id: 'individual_email',
							name: '',
							name_source: 'snapshot',
							exists: true,
						},
					} ),
				},
			} ),
			{},
			null
		);

		const tg = within( rowOf( 'Telegram' ) );
		expect( tg.getByText( '@fair_channel' ) ).toBeInTheDocument();
		expect( tg.getByText( 'On' ) ).toBeInTheDocument();
		expect(
			tg.getByText( 'October 16, 2026 10:30 am' )
		).toBeInTheDocument();
		expect(
			tg.getByRole( 'link', { name: /^Scheduled, / } )
		).toHaveAttribute(
			'href',
			expect.stringContaining( 'configuration=telegram' )
		);
		expect(
			tg.getByRole( 'link', { name: /^Scheduled, / } )
		).toHaveAttribute( 'href', expect.stringContaining( 'execution=41' ) );
		expect( tg.getByText( 'Partly accepted' ) ).toBeInTheDocument();

		const mail = within( rowOf( 'Bulk email' ) );
		expect( mail.getByText( 'Paused' ) ).toBeInTheDocument();
		expect(
			mail.getByText( /paused because Fair Audience is not active/ )
		).toBeInTheDocument();
		expect(
			mail.getByText( /Subscribers of this event feed/ )
		).toBeInTheDocument();
		expect( mail.getByText( 'Nothing sent yet' ) ).toBeInTheDocument();
		expect( mail.getByText( 'Not scheduled' ) ).toBeInTheDocument();

		const own = within( rowOf( 'Individual email' ) );
		expect( own.getByText( 'organizer@example.test' ) ).toBeInTheDocument();
		expect(
			own.getByRole( 'link', { name: /^Test, / } )
		).toBeInTheDocument();
		expect( own.getByText( 'Accepted' ) ).toBeInTheDocument();
	} );

	it( 'gives every kind Edit and a menu of History, Duplicate and Delete', async () => {
		await renderPage( payload(), {}, null );

		for ( const name of [ 'Telegram', 'Bulk email', 'Individual email' ] ) {
			const row = rowOf( name );
			const edit = within( row ).getByRole( 'link', {
				name: `Edit “${ name }”`,
			} );
			expect( edit ).toHaveTextContent( /^Edit$/ );
			expect( edit ).toHaveAttribute(
				'href',
				within( row )
					.getByRole( 'link', { name } )
					.getAttribute( 'href' )
			);
			const menu = await rowMenu( row, name );
			expect(
				menu
					.getAllByRole( 'menuitem' )
					.map( ( item ) => item.firstChild.textContent )
			).toEqual( [ 'History', 'Duplicate', 'Delete' ] );
			fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'Escape' } );
			await waitForMenuToClose();
		}
	} );

	it( 'opens History in place, and leaves a modified click to the browser', async () => {
		await renderPage( payload(), {}, null );

		let menu = await rowMenu( rowOf( 'Telegram' ), 'Telegram' );
		const history = menu.getByRole( 'menuitem', { name: 'History' } );
		expect( history ).toHaveAttribute(
			'href',
			expect.stringContaining( 'configuration=telegram&tab=history' )
		);
		// A new tab opens; this one stays on the list.
		expect( clickLeftToBrowser( history, { ctrlKey: true } ) ).toBe( true );
		expect( currentSearch() ).not.toHaveProperty( 'configuration' );
		await waitForMenuToClose();

		menu = await rowMenu( rowOf( 'Telegram' ), 'Telegram' );
		const item = menu.getByRole( 'menuitem', { name: 'History' } );
		await act( async () => {
			expect( clickLeftToBrowser( item ) ).toBe( false );
		} );
		expect( currentSearch() ).toMatchObject( {
			configuration: 'telegram',
			tab: 'history',
		} );
	} );

	it( 'opens the editor in place from the name and from Edit', async () => {
		await renderPage( payload(), {}, null );

		const edit = within( rowOf( 'Telegram' ) ).getByRole( 'link', {
			name: 'Edit “Telegram”',
		} );
		expect( clickLeftToBrowser( edit, { metaKey: true } ) ).toBe( true );
		expect( currentSearch() ).not.toHaveProperty( 'configuration' );
		fireEvent.click( edit );
		await screen.findByRole( 'navigation', {
			name: 'Notification sections',
		} );
		expect( currentSearch() ).toMatchObject( {
			configuration: 'telegram',
		} );
	} );

	it( 'keeps the rows when a refresh fails and offers to try again', async () => {
		let fail = false;
		await renderPage(
			payload( {}, [] ),
			{
				[ `GET ${ PATH }` ]: () =>
					fail
						? Promise.reject( { message: 'Server unreachable.' } )
						: Promise.resolve( payload() ),
			},
			null
		);

		fail = true;
		await returnToPage();
		expect(
			await screen.findByText(
				/could not be refreshed, so what is shown may be out of date\. Your unsaved changes are kept\. Server unreachable\./
			)
		).toBeInTheDocument();
		expect( rowOf( 'Telegram' ) ).toBeDefined();

		fail = false;
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Try again' } )
			);
		} );
		expect(
			screen.queryByText( /could not be refreshed/ )
		).not.toBeInTheDocument();
		expect( rowOf( 'Telegram' ) ).toBeDefined();
	} );

	it( 'clears a search that matches nothing', async () => {
		await renderPage( payload(), {}, null );

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Search notifications' } ),
			{ target: { value: 'nothing like it' } }
		);
		// Offered both in the toolbar and in the no-results message.
		const [ inToolbar, inMessage ] = screen.getAllByRole( 'button', {
			name: 'Clear filters',
		} );
		expect(
			inToolbar.closest( '.fair-admin-list-toolbar' )
		).not.toBeNull();
		fireEvent.click( inMessage );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 4 );
		expect( currentSearch() ).not.toHaveProperty( 's' );
		expect(
			screen.queryByRole( 'button', { name: 'Clear filters' } )
		).not.toBeInTheDocument();
		// Focus stays in the list, on its first control.
		expect(
			screen.getByRole( 'textbox', { name: 'Search notifications' } )
		).toHaveFocus();
	} );

	it( 'summarizes the applied search and counts the matches', async () => {
		await renderPage( payload(), {}, null );

		expect( screen.getByText( '3 notifications' ) ).toHaveAttribute(
			'role',
			'status'
		);
		expect(
			screen.queryByText( 'Applied filters:' )
		).not.toBeInTheDocument();

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Search notifications' } ),
			{ target: { value: 'organizer@' } }
		);
		expect( screen.getByText( 'Applied filters:' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Search: organizer@' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 notification' ) ).toBeInTheDocument();
	} );

	it( 'moves from the header’s Add a notification to the add form', async () => {
		await renderPage( payload(), {}, null );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add a notification' } )
		);
		expect(
			screen.getByRole( 'combobox', { name: 'Kind' } )
		).toHaveFocus();
	} );

	it( 'reports a missing bot token as a problem of the notification', async () => {
		await renderPage(
			payload( {
				telegram: { token_configured: false, token_valid: false },
			} ),
			{},
			null
		);

		expect(
			within( rowOf( 'Telegram' ) ).getByText(
				/No bot token is configured/
			)
		).toBeInTheDocument();
	} );

	it( 'searches by name, kind or address and says when nothing matches', async () => {
		await renderPage( payload(), {}, null );

		const search = screen.getByRole( 'textbox', {
			name: 'Search notifications',
		} );
		fireEvent.change( search, { target: { value: 'organizer@' } } );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 2 );
		expect( rowOf( 'Individual email' ) ).toBeDefined();
		expect( currentSearch() ).toMatchObject( { s: 'organizer@' } );

		fireEvent.change( search, { target: { value: 'nothing like it' } } );
		expect(
			screen.getByText( 'No notification matches “nothing like it”.' )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
	} );

	it( 'shows a long list in pages', async () => {
		const many = Array.from( { length: 22 }, ( unused, index ) => ( {
			...configuration( 'individual_email' ),
			id: `extra-${ index }`,
			name: `Digest ${ index + 1 }`,
		} ) );
		await renderPage( payload( {}, many ), {}, null );

		// 25 notifications: 20 rows and a header on the first page.
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 21 );
		expect( screen.getByText( 'Page 1 of 2' ) ).toBeInTheDocument();
		expect(
			screen.getByText( '1–20 of 25 notifications' )
		).toBeInTheDocument();
		const pages = screen.getByRole( 'navigation', {
			name: 'Notification pages',
		} );
		expect(
			within( pages ).getByRole( 'button', { name: 'Previous page' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( screen.getByRole( 'link', { name: 'Next page' } ) );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 6 );
		expect( rowOf( 'Digest 22' ) ).toBeDefined();
		expect( currentSearch() ).toMatchObject( { list_page: '2' } );
		expect(
			screen.getByText( '21–25 of 25 notifications' )
		).toBeInTheDocument();
	} );
} );

describe( 'Notification list by event feed', () => {
	function rowOf( name ) {
		return screen
			.getAllByRole( 'row' )
			.find( ( row ) => within( row ).queryByRole( 'link', { name } ) );
	}

	// Names of the listed notifications, in order.
	function listed() {
		return screen
			.queryAllByRole( 'row' )
			.slice( 1 )
			.map(
				( row ) => within( row ).getAllByRole( 'link' )[ 0 ].textContent
			);
	}

	function feedSelect() {
		return screen.getByRole( 'combobox', { name: 'Event feed' } );
	}

	function chooseFeed( slug ) {
		fireEvent.change( feedSelect(), { target: { value: slug } } );
	}

	async function popTo( search ) {
		visit( search );
		await act( async () => {
			window.dispatchEvent( new PopStateEvent( 'popstate' ) );
		} );
	}

	// Telegram sends City events, bulk email Member events, individual
	// email all local events; a second individual email sends City events.
	function feeds( extra = [] ) {
		const page = payload( {}, [
			{
				...configuration( 'individual_email', {
					event_selection: 'city',
					recipient: 'city-team@example.test',
				} ),
				id: 'city-digest',
				name: 'City digest',
			},
			...extra,
		] );
		page.sources.push( { slug: 'quiet', name: 'Quiet events' } );
		return page;
	}

	async function renderList( search = '', page = feeds() ) {
		visit( search );
		mockApi( page );
		render( <EventNotifications sourcesUrl={ null } /> );
		await screen.findByRole( 'combobox', { name: 'Event feed' } );
	}

	it( 'offers every enabled feed, with all feeds by default', async () => {
		await renderList();

		expect( feedSelect() ).toHaveValue( '' );
		expect(
			within( feedSelect() )
				.getAllByRole( 'option' )
				.map( ( option ) => option.textContent )
		).toEqual( [
			'All feeds',
			'City events',
			'Member events',
			'Quiet events',
		] );
		expect( listed() ).toEqual( [
			'Telegram',
			'Bulk email',
			'Individual email',
			'City digest',
		] );
	} );

	it( 'shows only the notifications of the chosen feed, of every kind, combined with the search', async () => {
		await renderList();

		chooseFeed( 'city' );
		expect( listed() ).toEqual( [ 'Telegram', 'City digest' ] );
		expect( currentSearch() ).toMatchObject( { feed: 'city' } );

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Search notifications' } ),
			{ target: { value: 'city-team' } }
		);
		expect( listed() ).toEqual( [ 'City digest' ] );
		expect( currentSearch() ).toMatchObject( {
			feed: 'city',
			s: 'city-team',
		} );

		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Search notifications' } ),
			{ target: { value: 'organizer@' } }
		);
		expect(
			screen.getByText(
				'No notification of “City events” matches “organizer@”.'
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();

		// Clearing the feed keeps the search.
		chooseFeed( '' );
		expect( listed() ).toEqual( [ 'Individual email' ] );
		expect( currentSearch() ).not.toHaveProperty( 'feed' );
		expect( currentSearch() ).toMatchObject( { s: 'organizer@' } );
	} );

	it( 'summarizes the feed and search, and clears both at once', async () => {
		await renderList();

		chooseFeed( 'city' );
		fireEvent.change(
			screen.getByRole( 'textbox', { name: 'Search notifications' } ),
			{ target: { value: 'city-team' } }
		);
		expect( screen.getByText( 'Search: city-team' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Event feed: City events' )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Clear filters' } )
		);
		expect( currentSearch() ).not.toHaveProperty( 'feed' );
		expect( currentSearch() ).not.toHaveProperty( 's' );
		expect( feedSelect() ).toHaveValue( '' );
		expect(
			screen.queryByText( 'Applied filters:' )
		).not.toBeInTheDocument();
	} );

	it( 'leaves out notifications of all local events and without a feed once a feed is chosen', async () => {
		await renderList(
			'',
			feeds( [
				{
					...configuration( 'telegram', { source_slug: '' } ),
					id: 'no-feed',
					name: 'Feedless',
				},
			] )
		);
		expect( rowOf( 'Feedless' ) ).toBeDefined();

		chooseFeed( 'members' );
		expect( listed() ).toEqual( [ 'Bulk email' ] );
	} );

	it( 'filters before paging and starts again from the first page', async () => {
		const many = Array.from( { length: 22 }, ( unused, index ) => ( {
			...configuration( 'telegram' ),
			id: `city-${ index }`,
			name: `City ${ index + 1 }`,
		} ) );
		await renderList( '&list_page=2', feeds( many ) );
		expect( screen.getByText( 'Page 2 of 2' ) ).toBeInTheDocument();

		chooseFeed( 'members' );
		expect( listed() ).toEqual( [ 'Bulk email' ] );
		expect( currentSearch() ).not.toHaveProperty( 'list_page' );
		expect( screen.queryByText( /^Page / ) ).not.toBeInTheDocument();

		// Telegram, City digest and 22 more: 24 of City events.
		chooseFeed( 'city' );
		expect( screen.getByText( 'Page 1 of 2' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'link', { name: 'Next page' } ) );
		expect( listed() ).toEqual( [
			'City 19',
			'City 20',
			'City 21',
			'City 22',
		] );
		expect( currentSearch() ).toMatchObject( {
			feed: 'city',
			list_page: '2',
		} );

		chooseFeed( '' );
		expect( currentSearch() ).not.toHaveProperty( 'list_page' );
		expect( screen.getByText( 'Page 1 of 2' ) ).toBeInTheDocument();
	} );

	it( 'restores the feed of a direct link and follows Back and Forward', async () => {
		await renderList( '&feed=members' );

		expect( feedSelect() ).toHaveValue( 'members' );
		expect( listed() ).toEqual( [ 'Bulk email' ] );

		chooseFeed( 'city' );
		expect( listed() ).toEqual( [ 'Telegram', 'City digest' ] );

		await popTo( '&feed=members' );
		expect( feedSelect() ).toHaveValue( 'members' );
		expect( listed() ).toEqual( [ 'Bulk email' ] );

		await popTo( '&feed=city' );
		expect( feedSelect() ).toHaveValue( 'city' );
		expect( listed() ).toEqual( [ 'Telegram', 'City digest' ] );

		await popTo( '' );
		expect( feedSelect() ).toHaveValue( '' );
		expect( listed() ).toHaveLength( 4 );
	} );

	it( 'keeps the feed when coming back from a notification', async () => {
		await renderList( '&feed=city' );

		fireEvent.click(
			within( rowOf( 'Telegram' ) ).getAllByRole( 'link', {
				name: 'Telegram',
			} )[ 0 ]
		);
		await screen.findByRole( 'navigation', {
			name: 'Notification sections',
		} );
		await popTo( '&feed=city' );
		expect( feedSelect() ).toHaveValue( 'city' );
		expect( listed() ).toEqual( [ 'Telegram', 'City digest' ] );
	} );

	it( 'says when the chosen feed has no notification', async () => {
		await renderList();

		chooseFeed( 'quiet' );
		expect(
			screen.getByText(
				'No notification sends events from “Quiet events”.'
			)
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
	} );

	it( 'shows nothing for an unavailable feed and offers to show all feeds', async () => {
		await renderList( '&feed=gone' );

		expect(
			screen.getByText( /The event feed “gone” is not available/ )
		).toBeInTheDocument();
		expect( feedSelect() ).toHaveValue( 'gone' );
		expect(
			within( feedSelect() ).getByRole( 'option', {
				name: 'gone (unavailable)',
			} )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( /There is no notification yet/ )
		).not.toBeInTheDocument();
		expect( currentSearch() ).toMatchObject( { feed: 'gone' } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Show all feeds' } )
		);
		expect( listed() ).toHaveLength( 4 );
		expect( currentSearch() ).not.toHaveProperty( 'feed' );
	} );

	it( 'treats a feed that is turned off as unavailable', async () => {
		const page = feeds();
		page.sources = page.sources.filter(
			( source ) => 'members' !== source.slug
		);
		await renderList( '&feed=members', page );

		expect(
			screen.getByText( /The event feed “members” is not available/ )
		).toBeInTheDocument();
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
	} );

	it( 'lists a notification by its saved feed while a draft changes it', async () => {
		await renderList();

		const telegramView = await openNotification( 'Telegram' );
		fireEvent.change(
			telegramView.getByRole( 'combobox', { name: 'Events to include' } ),
			{ target: { value: 'members' } }
		);
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'combobox', { name: 'Event feed' } );

		chooseFeed( 'city' );
		expect( listed() ).toEqual( [ 'Telegram', 'City digest' ] );
		expect(
			within( rowOf( 'Telegram' ) ).getByText( 'Unsaved changes' )
		).toBeInTheDocument();
		chooseFeed( 'members' );
		expect( listed() ).toEqual( [ 'Bulk email' ] );
	} );
} );

describe( 'Navigation', () => {
	it( 'opens a notification from a direct link', async () => {
		await renderPage( payload(), {}, 'bulk_email' );

		expect(
			within( section( 'Bulk email' ) ).getByLabelText( 'Subject' )
		).toHaveValue( 'This week: {week_start}' );
		expect(
			screen.getByRole( 'link', { name: 'Settings' } )
		).toHaveAttribute( 'aria-current', 'page' );
	} );

	it( 'explains a link to a notification that does not exist', async () => {
		visit( '&configuration=gone-id' );
		mockApi( payload() );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			(
				await screen.findAllByText(
					/This notification does not exist\./
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getByRole( 'link', { name: '← All notifications' } )
		).toBeInTheDocument();
	} );

	it( 'follows the browser’s Back and Forward buttons', async () => {
		await renderPage( payload(), {}, null );

		await openNotification( 'Bulk email' );
		expect( currentSearch() ).toMatchObject( {
			configuration: 'bulk_email',
		} );

		visit();
		await act( async () => {
			window.dispatchEvent( new PopStateEvent( 'popstate' ) );
		} );
		expect(
			await screen.findByRole( 'textbox', {
				name: 'Search notifications',
			} )
		).toBeInTheDocument();

		visit( '&configuration=bulk_email&tab=history' );
		await act( async () => {
			window.dispatchEvent( new PopStateEvent( 'popstate' ) );
		} );
		expect(
			await screen.findByText( 'Nothing has been sent or tested yet.' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'History' } )
		).toHaveAttribute( 'aria-current', 'page' );
	} );
} );

describe( 'Notification history', () => {
	const SCOPED = `${ PATH }/configurations/telegram/executions`;
	const GLOBAL = `${ PATH }/executions`;

	it( 'shows only the notification’s own history, without a notification filter', async () => {
		visit( '&configuration=telegram&tab=history' );
		mockApi( payload(), {
			[ `GET ${ SCOPED }` ]: () =>
				historyResponse( [ execution( { id: 41 } ) ] ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText(
				'Message parts: 1 accepted, 1 failed, 0 skipped, 0 unknown.'
			)
		).toBeInTheDocument();
		const table = within( screen.getByRole( 'table' ) );
		expect( table.getByText( 'Partly accepted' ) ).toBeInTheDocument();
		expect( table.getByText( 'Scheduled' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'combobox', { name: 'Notification' } )
		).not.toBeInTheDocument();
		expect(
			apiFetch.mock.calls.some( ( [ options ] ) =>
				options.path.startsWith( `${ GLOBAL }` )
			)
		).toBe( false );
		// The history of every notification is a separate, named view.
		expect(
			screen.getByRole( 'link', { name: 'All notification history' } )
		).toHaveAttribute( 'href', expect.stringContaining( 'view=history' ) );
	} );

	it( 'ignores a notification filter in a notification’s own history', async () => {
		visit(
			'&configuration=telegram&tab=history&filter_configuration=bulk_email'
		);
		mockApi( payload(), {
			[ `GET ${ SCOPED }` ]: () => historyResponse( [] ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText( 'Nothing has been sent or tested yet.' )
		).toBeInTheDocument();
		const [ request ] = apiFetch.mock.calls.filter( ( [ options ] ) =>
			options.path.startsWith( SCOPED )
		);
		expect( query( request[ 0 ] ) ).not.toHaveProperty( 'configuration' );
	} );

	it( 'filters the history of every notification and keeps the filters in the URL', async () => {
		visit( '&view=history' );
		mockApi( payload(), {
			[ `GET ${ GLOBAL }` ]: ( options ) =>
				'test' === query( options ).origin
					? historyResponse( [
							execution( {
								id: 42,
								origin: 'test',
								outcome: 'success',
							} ),
						] )
					: historyResponse( [ execution() ] ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByRole( 'heading', {
				name: 'All notification history',
			} )
		).toBeInTheDocument();
		expect(
			within( await screen.findByRole( 'table' ) ).getByText(
				'Partly accepted'
			)
		).toBeVisible();

		await act( async () => {
			fireEvent.change(
				screen.getByRole( 'combobox', { name: 'Notification' } ),
				{ target: { value: 'telegram' } }
			);
		} );
		await act( async () => {
			fireEvent.change(
				screen.getByRole( 'combobox', { name: 'Scheduled or test' } ),
				{ target: { value: 'test' } }
			);
		} );
		await act( async () => {
			fireEvent.change(
				screen.getByRole( 'combobox', { name: 'Outcome' } ),
				{ target: { value: 'success' } }
			);
		} );
		await act( async () => {
			fireEvent.change(
				screen.getByRole( 'combobox', { name: 'Kind' } ),
				{ target: { value: 'telegram' } }
			);
		} );

		await waitFor( () =>
			expect(
				within( screen.getByRole( 'table' ) ).getByText( 'Accepted' )
			).toBeVisible()
		);
		const last = apiFetch.mock.calls
			.filter( ( [ options ] ) => options.path.startsWith( GLOBAL ) )
			.pop()[ 0 ];
		expect( query( last ) ).toMatchObject( {
			configuration: 'telegram',
			channel: 'telegram',
			origin: 'test',
			outcome: 'success',
			page: '1',
		} );
		expect( currentSearch() ).toMatchObject( {
			view: 'history',
			filter_configuration: 'telegram',
			filter_origin: 'test',
		} );

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Clear filters' } )
			);
		} );
		expect( currentSearch() ).not.toHaveProperty( 'filter_origin' );
	} );

	it( 'says when no entry matches the filters', async () => {
		visit( '&view=history&filter_outcome=failure' );
		mockApi( payload() );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText(
				'Nothing in the history matches these filters.'
			)
		).toBeInTheDocument();
	} );

	it( 'pages through the history with the totals from the response headers', async () => {
		visit( '&view=history' );
		mockApi( payload(), {
			[ `GET ${ GLOBAL }` ]: ( options ) =>
				historyResponse(
					[ execution( { id: Number( query( options ).page ) } ) ],
					45,
					3
				),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect( await screen.findByText( 'Page 1 of 3' ) ).toBeInTheDocument();
		expect( screen.getByText( /^45 entries\./ ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'link', { name: 'Next page' } ) );
		expect( await screen.findByText( 'Page 2 of 3' ) ).toBeInTheDocument();
		expect( currentSearch() ).toMatchObject( { history_page: '2' } );
	} );

	it( 'reports a failed history read and reads again on request', async () => {
		let attempt = 0;
		visit( '&view=history' );
		mockApi( payload(), {
			[ `GET ${ GLOBAL }` ]: () =>
				0 === attempt++
					? historyRefusal( { message: 'History is unavailable.' } )
					: historyResponse( [ execution() ] ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			( await screen.findAllByText( 'History is unavailable.' ) ).length
		).toBeGreaterThan( 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect(
			within( await screen.findByRole( 'table' ) ).getByText(
				'Partly accepted'
			)
		).toBeVisible();
	} );

	it( 'explains dates given in the wrong order instead of reading the history', async () => {
		visit( '&view=history&filter_from=2026-10-20&filter_to=2026-10-01' );
		mockApi( payload() );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText(
				'The first day is after the last day. Change one of them to see the history.'
			)
		).toBeInTheDocument();
		expect(
			apiFetch.mock.calls.some( ( [ options ] ) =>
				options.path.startsWith( GLOBAL )
			)
		).toBe( false );
	} );

	describe( 'in a site timezone that is not UTC', () => {
		let original;
		beforeEach( () => {
			original = getSettings();
			setSettings( {
				...original,
				timezone: {
					offset: 2,
					offsetFormatted: '+2',
					string: 'Europe/Madrid',
					abbr: 'CEST',
				},
			} );
		} );
		afterEach( () => setSettings( original ) );

		it( 'shows times and sends date filters as the site’s days', async () => {
			visit(
				'&view=history&filter_from=2026-10-25&filter_to=2026-10-25'
			);
			mockApi( payload(), {
				[ `GET ${ GLOBAL }` ]: () =>
					historyResponse( [
						execution( { started_at: '2026-10-24T23:30:00Z' } ),
					] ),
			} );
			render( <EventNotifications sourcesUrl={ null } /> );

			// 23:30 UTC is 1:30 the next morning in Madrid.
			expect(
				await screen.findByRole( 'link', {
					name: 'October 25, 2026 1:30 am',
				} )
			).toBeInTheDocument();
			const [ request ] = apiFetch.mock.calls.filter( ( [ options ] ) =>
				options.path.startsWith( GLOBAL )
			);
			// The day daylight saving time ends is 25 hours long.
			expect( query( request[ 0 ] ) ).toMatchObject( {
				after: '2026-10-24T22:00:00Z',
				before: '2026-10-25T23:00:00Z',
			} );
		} );
	} );
} );

describe( 'Execution details', () => {
	const SCOPED = `${ PATH }/configurations/telegram/executions/41`;

	it( 'shows the entry and its deliveries within the notification’s history', async () => {
		visit( '&configuration=telegram&tab=history&execution=41' );
		mockApi( payload(), {
			[ `GET ${ SCOPED }` ]: () =>
				historyResponse( execution( { id: 41 } ) ),
			[ `GET ${ SCOPED }/deliveries` ]: () =>
				historyResponse( [
					delivery(),
					delivery( {
						id: 2,
						part: 2,
						outcome: 'failed',
						reason_code: 'internal_error',
					} ),
				] ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText( 'Accepted by the provider' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Part 2 of 2' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'An error on this site stopped the send.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'October 12, 2026 to October 18, 2026' )
		).toBeInTheDocument();
		expect(
			screen.getAllByText( /does not confirm that anyone received it/ )
				.length
		).toBeGreaterThan( 0 );

		// Back to the history it was opened from.
		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'link', { name: '← Back to the history' } )
			);
		} );
		expect( currentSearch() ).toMatchObject( {
			configuration: 'telegram',
			tab: 'history',
		} );
		expect( currentSearch() ).not.toHaveProperty( 'execution' );
	} );

	it( 'refuses an entry of another notification without offering to retry', async () => {
		visit( '&configuration=telegram&tab=history&execution=41' );
		mockApi( payload(), {
			[ `GET ${ SCOPED }` ]: () =>
				historyRefusal( {
					code: 'unknown_execution',
					message: 'This notification history entry does not exist.',
				} ),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			(
				await screen.findAllByText(
					/It may belong to another notification/
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.queryByRole( 'button', { name: 'Try again' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps what older history did not record unknown', async () => {
		visit( '&view=history&execution=9' );
		mockApi( payload(), {
			[ `GET ${ PATH }/executions/9` ]: () =>
				historyResponse(
					execution( {
						id: 9,
						completeness: 'legacy',
						legacy: { status: 'sent', message: 'Sent: 12.' },
						week_start: null,
						week_end: null,
						finished_at: null,
						counts: {
							unit: 'recipients',
							accepted: 12,
							failed: 0,
							skipped: null,
							unknown: null,
						},
						configuration: {
							id: 'bulk_email',
							name: '',
							name_source: 'migration_fallback',
							exists: true,
						},
						channel: 'bulk_email',
						outcome: 'success',
					} )
				),
		} );
		render( <EventNotifications sourcesUrl={ null } /> );

		expect(
			await screen.findByText(
				'Recipients: 12 accepted, 0 failed, not recorded skipped, not recorded unknown.'
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByText( /Recorded before this history existed/ ).length
		).toBeGreaterThan( 0 );
		expect(
			screen.getAllByText( /Recorded status: Sent\./ ).length
		).toBeGreaterThan( 0 );
		expect( screen.getByText( 'Not recorded' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /The name was taken from the notification/ )
		).toBeInTheDocument();
		expect(
			await screen.findByText(
				'No recipient or chat was recorded for this entry.'
			)
		).toBeInTheDocument();
	} );
} );

describe( 'dayStartUtc', () => {
	const MADRID = { offset: 1, string: 'Europe/Madrid' };

	it( 'starts a day at local midnight across daylight saving changes', () => {
		expect( dayStartUtc( '2026-03-29', MADRID ) ).toBe(
			'2026-03-28T23:00:00Z'
		);
		expect( dayStartUtc( '2026-03-29', MADRID, 1 ) ).toBe(
			'2026-03-29T22:00:00Z'
		);
		expect( dayStartUtc( '2026-10-25', MADRID ) ).toBe(
			'2026-10-24T22:00:00Z'
		);
		expect( dayStartUtc( '2026-10-25', MADRID, 1 ) ).toBe(
			'2026-10-25T23:00:00Z'
		);
	} );

	it( 'uses a fixed offset when the site has no timezone name', () => {
		expect( dayStartUtc( '2026-01-10', { offset: 5.5, string: '' } ) ).toBe(
			'2026-01-09T18:30:00Z'
		);
		expect( dayStartUtc( '2026-01-10', { offset: 0, string: '' } ) ).toBe(
			'2026-01-10T00:00:00Z'
		);
	} );

	it( 'ignores a missing or malformed day', () => {
		expect( dayStartUtc( '', MADRID ) ).toBeNull();
		expect( dayStartUtc( '10/25/2026', MADRID ) ).toBeNull();
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

describe( 'Duplicating a notification', () => {
	const DUPLICATE = `${ PATH }/configurations/telegram/duplicate`;

	function copy( overrides ) {
		return {
			...configuration( 'telegram', { enabled: false } ),
			id: 'copy-id',
			name: 'Copy of Telegram',
			...overrides,
		};
	}

	function rowOf( name ) {
		return screen
			.getAllByRole( 'row' )
			.find( ( row ) => within( row ).queryByRole( 'link', { name } ) );
	}

	it( 'adds a paused copy once, however often it is clicked, and opens it', async () => {
		const request = deferred();
		const original = { telegram: { enabled: true } };
		let current = payload( original );
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `POST ${ DUPLICATE }` ]: () => request.promise,
			},
			null
		);

		await chooseAction( rowOf( 'Telegram' ), 'Telegram', 'Duplicate' );
		await waitForMenuToClose();
		// The progress stays in the row once the menu has closed.
		expect(
			within( rowOf( 'Telegram' ) ).getByRole( 'status' )
		).toHaveTextContent( 'Duplicating “Telegram”…' );
		const menu = await rowMenu( rowOf( 'Telegram' ), 'Telegram' );
		const pending = menu.getByRole( 'menuitem', {
			name: /^Duplicating…/,
		} );
		// Stays focusable while pending, but cannot be used.
		expect( pending ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( pending ).toHaveTextContent( 'A copy is being made.' );
		fireEvent.click( pending );
		expect( calls( 'POST', DUPLICATE ) ).toHaveLength( 1 );
		expect( calls( 'POST', DUPLICATE )[ 0 ][ 0 ] ).not.toHaveProperty(
			'data'
		);

		current = payload( original, [ copy() ] );
		await act( async () => request.resolve( copy() ) );

		expect(
			await screen.findByText(
				'“Copy of Telegram” was added as a copy of the saved settings. It is paused and has no history: check it, turn it on and save it when it is ready.'
			)
		).toBeInTheDocument();
		const named = within( section( 'Copy of Telegram' ) );
		expect( named.getByLabelText( 'Send at' ) ).toHaveValue( '10:30' );
		expect(
			named.getByLabelText( 'Post the weekly summary to Telegram' )
		).not.toBeChecked();
		expect( currentSearch() ).toMatchObject( {
			configuration: 'copy-id',
		} );

		// The original stays on, next to its copy.
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'table' );
		expect(
			within( rowOf( 'Telegram' ) ).getByText( 'On' )
		).toBeInTheDocument();
		expect(
			within( rowOf( 'Copy of Telegram' ) ).getByText( 'Paused' )
		).toBeInTheDocument();
	} );

	it( 'shows a failed copy in its row and lets it be retried', async () => {
		let attempts = 0;
		await renderPage(
			payload(),
			{
				[ `POST ${ DUPLICATE }` ]: () => {
					attempts++;
					return 1 === attempts
						? Promise.reject( {
								code: 'configuration_not_duplicated',
								message:
									'The notification could not be duplicated. Please try again.',
							} )
						: Promise.resolve( copy() );
				},
			},
			null
		);

		await chooseAction( rowOf( 'Telegram' ), 'Telegram', 'Duplicate' );
		expect(
			await within( rowOf( 'Telegram' ) ).findByText(
				'“Telegram” was not duplicated: The notification could not be duplicated. Please try again.'
			)
		).toBeInTheDocument();
		expect( screen.getByRole( 'table' ) ).toBeInTheDocument();

		// Retried from the error, next to the row.
		fireEvent.click(
			within( rowOf( 'Telegram' ) ).getByRole( 'button', {
				name: 'Try again',
			} )
		);
		expect(
			await screen.findByRole( 'heading', {
				name: /^Copy of Telegram/,
			} )
		).toBeInTheDocument();
		expect( attempts ).toBe( 2 );
	} );

	it( 'falls back to a general message when the failure has none', async () => {
		await renderPage(
			payload(),
			{ [ `POST ${ DUPLICATE }` ]: () => Promise.reject( {} ) },
			null
		);

		await chooseAction( rowOf( 'Telegram' ), 'Telegram', 'Duplicate' );

		expect(
			await screen.findByText(
				'“Telegram” was not duplicated: Failed to duplicate the notification. Please try again.'
			)
		).toBeInTheDocument();
	} );

	it( 'explains why a notification of an unavailable kind cannot be duplicated', async () => {
		const message =
			'The weekly email is paused because Fair Audience is not active.';
		await renderPage(
			payload( {
				bulk_email: { state: 'inactive', state_message: message },
			} ),
			{},
			null
		);

		// The reason stays visible next to the name, outside the menu.
		expect(
			within( rowOf( 'Bulk email' ) ).getByText( message )
		).toBeVisible();
		const menu = await rowMenu( rowOf( 'Bulk email' ), 'Bulk email' );
		const item = menu.getByRole( 'menuitem', { name: /^Duplicate/ } );
		expect( item ).toHaveAttribute( 'aria-disabled', 'true' );
		expect( item ).toHaveTextContent(
			'Cannot be duplicated now, see the warning next to its name.'
		);
		fireEvent.click( item );
		expect(
			calls( 'POST', `${ PATH }/configurations/bulk_email/duplicate` )
		).toHaveLength( 0 );
		fireEvent.keyDown( screen.getByRole( 'menu' ), { key: 'Escape' } );
		await waitForMenuToClose();
		expect(
			( await rowMenu( rowOf( 'Telegram' ), 'Telegram' ) ).getByRole(
				'menuitem',
				{ name: 'Duplicate' }
			)
		).toBeEnabled();
	} );

	it( 'copies the saved settings and keeps the original’s unsaved draft', async () => {
		await renderPage( payload(), {
			[ `POST ${ DUPLICATE }` ]: () => Promise.resolve( copy() ),
		} );

		fireEvent.change(
			within( section( 'Telegram' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '12:00' } }
		);
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'table' );
		await chooseAction( rowOf( 'Telegram' ), 'Telegram', 'Duplicate' );

		const named = within(
			( await screen.findByRole( 'heading', {
				name: /^Copy of Telegram/,
			} ) ) && section( 'Copy of Telegram' )
		);
		expect( named.getByLabelText( 'Send at' ) ).toHaveValue( '10:30' );
		const original = await openNotification( 'Telegram' );
		expect( original.getByLabelText( 'Send at' ) ).toHaveValue( '12:00' );
	} );

	it( 'keeps the copy when a read issued before it answers later', async () => {
		const read = deferred();
		let reads = 0;
		await renderPage(
			payload(),
			{
				[ `GET ${ PATH }` ]: () => {
					reads++;
					if ( 1 === reads ) {
						return Promise.resolve( payload() );
					}
					return 2 === reads
						? read.promise
						: Promise.resolve( payload( {}, [ copy() ] ) );
				},
				[ `POST ${ DUPLICATE }` ]: () => Promise.resolve( copy() ),
			},
			null
		);

		// Coming back to the tab issues a read that is still pending.
		await returnToPage();
		await chooseAction( rowOf( 'Telegram' ), 'Telegram', 'Duplicate' );
		await screen.findByRole( 'heading', { name: /^Copy of Telegram/ } );
		await act( async () => read.resolve( payload() ) );
		expect(
			screen.getByRole( 'heading', { name: /^Copy of Telegram/ } )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'table' );
		expect( rowOf( 'Copy of Telegram' ) ).toBeDefined();
	} );
} );

describe( 'Deleting a notification', () => {
	const ID = 'digest-id';
	const DELETE = `${ PATH }/configurations/${ ID }`;

	function digest( overrides ) {
		return {
			...configuration( 'individual_email', {
				enabled: true,
				recipient: 'team@example.test',
				next_run: { time_local: '14 October 2026 07:15' },
			} ),
			id: ID,
			name: 'Team digest',
			...overrides,
		};
	}

	// An open dialog hides the page behind it from assistive technology.
	function rowOf( name ) {
		return screen
			.getAllByRole( 'row', { hidden: true } )
			.find( ( row ) =>
				within( row ).queryByRole( 'link', { name, hidden: true } )
			);
	}

	async function openDialog( name = 'Team digest' ) {
		await chooseAction( rowOf( name ), name, 'Delete' );
		return within( await screen.findByRole( 'dialog' ) );
	}

	const deletedMessage =
		'“Team digest” was deleted. It will not send again; its history stays in All notification history.';

	it( 'names the notification and its consequences, and cancelling changes nothing', async () => {
		await renderPage( payload( {}, [ digest() ] ), {}, null );

		const dialog = await openDialog();

		expect(
			screen.getByRole( 'dialog', {
				name: 'Delete notification — Team digest',
			} )
		).toBeInTheDocument();
		expect(
			dialog.getByText(
				'Delete the notification “Team digest” (Individual email), which sends to: team@example.test?'
			)
		).toBeInTheDocument();
		expect(
			dialog.getByText(
				'Its next send, planned for 14 October 2026 07:15, and every later one are cancelled.'
			)
		).toBeInTheDocument();
		expect(
			dialog.getByText(
				'A send that has already started finishes and is recorded. Messages already delivered cannot be recalled.'
			)
		).toBeInTheDocument();
		expect(
			dialog.getByText(
				'Its past sends and tests stay in All notification history.'
			)
		).toBeInTheDocument();
		expect(
			dialog.getByText( 'This cannot be undone.' )
		).toBeInTheDocument();

		fireEvent.click( dialog.getByRole( 'button', { name: 'Cancel' } ) );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		// Focus goes back to the menu the dialog was opened from.
		expect(
			within( rowOf( 'Team digest' ) ).getByRole( 'button', {
				name: 'More actions for “Team digest”',
			} )
		).toHaveFocus();

		// Escape cancels too; the dialog closes once its animation ends.
		await openDialog();
		fireEvent.keyDown( screen.getByRole( 'dialog' ), {
			key: 'Escape',
			code: 'Escape',
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);

		expect( calls( 'DELETE', DELETE ) ).toHaveLength( 0 );
		expect( rowOf( 'Team digest' ) ).toBeDefined();
	} );

	it( 'names an unnamed notification by its kind', async () => {
		await renderPage( payload(), {}, null );

		const dialog = await openDialog( 'Telegram' );

		expect(
			screen.getByRole( 'dialog', {
				name: 'Delete notification — Telegram',
			} )
		).toBeInTheDocument();
		expect(
			dialog.getByText(
				'Delete the unnamed Telegram notification, which sends to: @fair_channel?'
			)
		).toBeInTheDocument();
		expect(
			dialog.getByText( 'It will never be scheduled again.' )
		).toBeInTheDocument();
	} );

	it( 'deletes once, blocks dismissal while pending, then removes only that row', async () => {
		const request = deferred();
		let current = payload( {}, [ digest() ] );
		await renderPage(
			current,
			{
				[ `GET ${ PATH }` ]: () => Promise.resolve( current ),
				[ `DELETE ${ DELETE }` ]: () => request.promise,
			},
			null
		);

		const dialog = await openDialog();
		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Delete notification' } )
		);
		const pending = dialog.getByRole( 'button', { name: 'Deleting…' } );
		fireEvent.click( pending );
		expect( calls( 'DELETE', DELETE ) ).toHaveLength( 1 );
		expect(
			dialog.getByRole( 'button', { name: 'Cancel' } )
		).toBeDisabled();
		fireEvent.keyDown( screen.getByRole( 'dialog' ), {
			key: 'Escape',
			code: 'Escape',
		} );
		expect( screen.getByRole( 'dialog' ) ).toBeInTheDocument();
		// The row stays until the server confirms.
		expect( rowOf( 'Team digest' ) ).toBeDefined();

		const readsBefore = calls( 'GET', PATH ).length;
		current = payload();
		await act( async () =>
			request.resolve( { deleted: true, previous: { id: ID } } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( rowOf( 'Team digest' ) ).toBeUndefined();
		expect( rowOf( 'Telegram' ) ).toBeDefined();
		expect( rowOf( 'Bulk email' ) ).toBeDefined();
		expect( screen.getByText( deletedMessage ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'textbox', { name: 'Search notifications' } )
		).toHaveFocus();
		// The list is read again, and the report stays.
		await waitFor( () =>
			expect( calls( 'GET', PATH ).length ).toBeGreaterThan( readsBefore )
		);
		expect( screen.getByText( deletedMessage ) ).toBeInTheDocument();
	} );

	it( 'keeps the row after a failure and lets it be retried in the dialog', async () => {
		let attempts = 0;
		await renderPage(
			payload( {}, [ digest() ] ),
			{
				[ `GET ${ PATH }` ]: () =>
					Promise.resolve(
						payload( {}, attempts > 1 ? [] : [ digest() ] )
					),
				[ `DELETE ${ DELETE }` ]: () => {
					attempts++;
					return 1 === attempts
						? Promise.reject( {
								code: 'configuration_not_deleted',
								message:
									'The notification could not be deleted because another change to notifications was being saved. Nothing was deleted. Please try again.',
							} )
						: Promise.resolve( { deleted: true } );
				},
			},
			null
		);

		const dialog = await openDialog();
		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Delete notification' } )
		);

		expect(
			await dialog.findByText(
				'“Team digest” was not deleted: The notification could not be deleted because another change to notifications was being saved. Nothing was deleted. Please try again.'
			)
		).toBeInTheDocument();
		expect( rowOf( 'Team digest' ) ).toBeDefined();

		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Delete notification' } )
		);
		expect( await screen.findByText( deletedMessage ) ).toBeInTheDocument();
		expect( attempts ).toBe( 2 );
		expect( rowOf( 'Team digest' ) ).toBeUndefined();
	} );

	it( 'falls back to a general message when the failure has none', async () => {
		await renderPage(
			payload( {}, [ digest() ] ),
			{ [ `DELETE ${ DELETE }` ]: () => Promise.reject( {} ) },
			null
		);

		const dialog = await openDialog();
		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Delete notification' } )
		);

		expect(
			await dialog.findByText(
				'“Team digest” was not deleted: Failed to delete the notification. Please try again.'
			)
		).toBeInTheDocument();
	} );

	it( 'treats a notification the server no longer has as deleted', async () => {
		let asked = false;
		await renderPage(
			payload( {}, [ digest() ] ),
			{
				[ `GET ${ PATH }` ]: () =>
					Promise.resolve( payload( {}, asked ? [] : [ digest() ] ) ),
				[ `DELETE ${ DELETE }` ]: () =>
					( asked = true ) &&
					Promise.reject( {
						code: 'unknown_configuration',
						message: 'This notification does not exist.',
					} ),
			},
			null
		);

		fireEvent.click(
			( await openDialog() ).getByRole( 'button', {
				name: 'Delete notification',
			} )
		);

		expect( await screen.findByText( deletedMessage ) ).toBeInTheDocument();
		expect( rowOf( 'Team digest' ) ).toBeUndefined();
	} );

	it( 'is offered for a notification whose kind cannot be delivered now', async () => {
		await renderPage(
			payload( {
				bulk_email: {
					state: 'inactive',
					state_message:
						'The weekly email is paused because Fair Audience is not active.',
				},
			} ),
			{},
			null
		);

		const menu = await rowMenu( rowOf( 'Bulk email' ), 'Bulk email' );
		expect(
			menu.getByRole( 'menuitem', { name: 'Delete' } )
		).toBeEnabled();
	} );

	it( 'does not bring the row back when a read issued before it answers later', async () => {
		const read = deferred();
		let reads = 0;
		await renderPage(
			payload( {}, [ digest() ] ),
			{
				[ `GET ${ PATH }` ]: () => {
					reads++;
					if ( 1 === reads ) {
						return Promise.resolve( payload( {}, [ digest() ] ) );
					}
					return 2 === reads
						? read.promise
						: Promise.resolve( payload() );
				},
				[ `DELETE ${ DELETE }` ]: () =>
					Promise.resolve( { deleted: true } ),
			},
			null
		);

		// Coming back to the tab issues a read that is still pending.
		await returnToPage();
		fireEvent.click(
			( await openDialog() ).getByRole( 'button', {
				name: 'Delete notification',
			} )
		);
		await screen.findByText( deletedMessage );
		await act( async () => read.resolve( payload( {}, [ digest() ] ) ) );

		expect( rowOf( 'Team digest' ) ).toBeUndefined();
	} );

	it( 'discards the deleted notification’s unsaved draft only', async () => {
		await renderPage(
			payload( {}, [ digest() ] ),
			{
				[ `DELETE ${ DELETE }` ]: () =>
					Promise.resolve( { deleted: true } ),
			},
			ID
		);

		fireEvent.change(
			within( section( 'Team digest' ) ).getByLabelText( 'Send at' ),
			{ target: { value: '12:00' } }
		);
		fireEvent.click(
			screen.getByRole( 'link', { name: '← All notifications' } )
		);
		await screen.findByRole( 'table' );
		expect(
			within( rowOf( 'Team digest' ) ).getByText( 'Unsaved changes' )
		).toBeInTheDocument();
		expect( leavingIsGuarded() ).toBe( true );

		const dialog = await openDialog();
		expect(
			dialog.getByText( 'Its unsaved changes are discarded.' )
		).toBeInTheDocument();
		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Delete notification' } )
		);
		await screen.findByText( deletedMessage );

		expect( leavingIsGuarded() ).toBe( false );
	} );

	it( 'leaves out a configuration deleted after a read was issued', () => {
		const shown = payload( {}, [ digest() ] );
		const read = payload( {}, [ digest() ] );

		expect(
			mergeRead( shown, read, 3, {}, { [ ID ]: 4 } ).configurations.map(
				( { id } ) => id
			)
		).toEqual( [ 'telegram', 'bulk_email', 'individual_email' ] );
		// A read issued after the deletion is taken as it is.
		expect(
			mergeRead( shown, read, 5, {}, { [ ID ]: 4 } ).configurations
		).toHaveLength( 4 );
	} );
} );
