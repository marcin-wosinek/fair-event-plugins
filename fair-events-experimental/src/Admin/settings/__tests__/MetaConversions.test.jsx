/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MetaConversions from '../MetaConversions.js';

jest.mock( '@wordpress/api-fetch' );

function config( overrides ) {
	return {
		dataset_id: '123',
		token_configured: true,
		token_source: 'database',
		token_override_name: 'FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN',
		connectors_url: 'http://example.test/wp-admin/options-connectors.php',
		test_event_code: 'TEST12345',
		diagnostics: { counts: {}, recent: [] },
		test_history: [],
		consent_api_available: true,
		...overrides,
	};
}

function testHistoryEntry( overrides ) {
	return {
		event_name: 'Purchase',
		accepted: true,
		outcome: 'received',
		code: '',
		type: '',
		http_status: 200,
		events_received: 1,
		messages: [],
		fbtrace_id: 'AbCtrace123',
		time: '2026-01-01 10:00:00',
		time_local: 'January 1, 2026 11:00 am',
		...overrides,
	};
}

function outcome( overrides ) {
	return {
		event_name: 'Purchase',
		state: 'received',
		result_category: 'received',
		attempt_count: 1,
		meta_error_code: '',
		meta_error_type: '',
		payment_mode: 'live',
		updated_at: '2026-01-01 10:00:00',
		updated_at_local: 'January 1, 2026 11:00 am',
		...overrides,
	};
}

describe( 'MetaConversions recent delivery outcomes', () => {
	it( 'shows a received outcome with its status, mode, time and attempt count', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { received: 1 },
					recent: [ outcome() ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Purchase' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Received by Meta' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Live' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'January 1, 2026 11:00 am' )
		).toBeInTheDocument();
		expect( screen.getByText( '1 attempt' ) ).toBeInTheDocument();
	} );

	it( 'does not relabel a legacy HTTP-only success as received', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [ outcome( { state: 'accepted' } ) ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'Delivered (not confirmed)' )
		).toBeInTheDocument();
		expect(
			screen.queryByText( 'Received by Meta' )
		).not.toBeInTheDocument();
	} );

	it( 'labels a test-mode outcome as Test', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [ outcome( { payment_mode: 'test' } ) ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Test' ) ).toBeInTheDocument();
	} );

	it( 'shows a retrying outcome with its safe failure detail', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { retry_pending: 1 },
					recent: [
						outcome( {
							state: 'retry_pending',
							attempt_count: 2,
							meta_error_type: 'transport',
							meta_error_code: 'network',
						} ),
					],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Retrying' ) ).toBeInTheDocument();
		expect( screen.getByText( '2 attempts' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Error: transport: network' )
		).toBeInTheDocument();
	} );

	it( 'shows a permanently failed outcome with its safe failure detail', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { retries_exhausted: 1 },
					recent: [
						outcome( {
							state: 'retries_exhausted',
							attempt_count: 5,
							meta_error_type: 'http',
							meta_error_code: '500',
						} ),
					],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'Failed — retries exhausted' )
		).toBeInTheDocument();
		expect( screen.getByText( '5 attempts' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Error: http: 500' ) ).toBeInTheDocument();
	} );

	it( 'does not show a failure detail for a successful outcome', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [ outcome() ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		await screen.findByText( 'Purchase' );
		expect( screen.queryByText( /^Error:/ ) ).not.toBeInTheDocument();
	} );

	it( 'shows readable labels for the summary counts', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { received: 3, retry_pending: 1 },
					recent: [ outcome() ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'Received by Meta: 3' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Retrying: 1' ) ).toBeInTheDocument();
	} );

	it( 'shows an empty state when there are no recent results', async () => {
		apiFetch.mockResolvedValue( config() );

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'No delivery attempts yet.' )
		).toBeInTheDocument();
	} );
} );

describe( 'MetaConversions consent API warning', () => {
	it( 'shows the dependency warning and setup link when the API is unavailable', async () => {
		apiFetch.mockResolvedValue(
			config( { consent_api_available: false } )
		);

		const { container } = render(
			<MetaConversions onNotice={ () => {} } />
		);
		const scope = within( container );

		expect(
			await scope.findByText( /WP Consent API is available/ )
		).toBeInTheDocument();
		expect(
			scope.getByText( /interoperability layer/ )
		).toBeInTheDocument();
		expect(
			scope.getByRole( 'link', {
				name: /Get the WP Consent API plugin/,
			} )
		).toHaveAttribute(
			'href',
			'https://wordpress.org/plugins/wp-consent-api/'
		);
	} );

	it( 'hides the warning when the API is available', async () => {
		apiFetch.mockResolvedValue( config( { consent_api_available: true } ) );

		const { container } = render(
			<MetaConversions onNotice={ () => {} } />
		);
		const scope = within( container );

		await scope.findByLabelText( 'Dataset / Pixel ID' );

		expect(
			scope.queryByText( /WP Consent API is available/ )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the test-event buttons available on their own credential rules when the API is unavailable', async () => {
		apiFetch.mockResolvedValue(
			config( { consent_api_available: false } )
		);

		const { container } = render(
			<MetaConversions onNotice={ () => {} } />
		);
		const scope = within( container );

		expect(
			await scope.findByRole( 'button', { name: 'Send PageView test' } )
		).toBeEnabled();
	} );
} );

describe( 'MetaConversions test event buttons', () => {
	it( 'sends the selected event name and names it in the success notice', async () => {
		apiFetch.mockResolvedValue( config() );
		const onNotice = jest.fn();

		render( <MetaConversions onNotice={ onNotice } /> );

		const button = await screen.findByRole( 'button', {
			name: 'Send InitiateCheckout test',
		} );
		apiFetch.mockResolvedValueOnce( {
			accepted: true,
			event_name: 'InitiateCheckout',
			outcome: 'received',
			diagnostics: {
				http_status: 200,
				events_received: 1,
				messages: [],
				fbtrace_id: 'AbCtrace123',
			},
		} );
		fireEvent.click( button );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message:
					'Meta confirmed receiving the InitiateCheckout test event.',
			} )
		);
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-events-experimental/v1/meta-conversions/test',
				method: 'POST',
				data: { event_name: 'InitiateCheckout' },
			} )
		);
	} );

	it( 'names the failed event type in the failure notice', async () => {
		apiFetch.mockResolvedValue( config() );
		const onNotice = jest.fn();

		render( <MetaConversions onNotice={ onNotice } /> );

		const button = await screen.findByRole( 'button', {
			name: 'Send Purchase test',
		} );
		apiFetch.mockRejectedValueOnce( new Error( 'rejected' ) );
		fireEvent.click( button );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'error',
				message:
					'Meta rejected the Purchase test event. Check the configuration and try again.',
			} )
		);
	} );

	it( 'disables every test button while missing configuration', async () => {
		apiFetch.mockResolvedValue( config( { test_event_code: '' } ) );

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Send InitiateCheckout test' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Send Purchase test' } )
		).toBeDisabled();
	} );

	it( 'disables every test button and explains when there are unsaved edits', async () => {
		apiFetch.mockResolvedValue( config() );

		render( <MetaConversions onNotice={ () => {} } /> );

		const datasetField =
			await screen.findByLabelText( 'Dataset / Pixel ID' );
		fireEvent.change( datasetField, { target: { value: '456' } } );

		// Named beside the standard tests and the calendar test.
		expect(
			await screen.findAllByText(
				/Save or discard your changes before sending/
			)
		).toHaveLength( 2 );
		expect(
			screen.getByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();
	} );

	it( 'disables the other test buttons while one is in flight, preventing duplicate sends', async () => {
		apiFetch.mockResolvedValue( config() );
		let resolveTest;
		render( <MetaConversions onNotice={ () => {} } /> );

		const pageViewButton = await screen.findByRole( 'button', {
			name: 'Send PageView test',
		} );
		const purchaseButton = screen.getByRole( 'button', {
			name: 'Send Purchase test',
		} );
		apiFetch.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					resolveTest = resolve;
				} )
		);
		fireEvent.click( pageViewButton );

		expect(
			await screen.findByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();
		expect( purchaseButton ).toBeDisabled();

		resolveTest( { accepted: true, event_name: 'PageView' } );
		await waitFor( () => expect( pageViewButton ).not.toBeDisabled() );
	} );
} );

describe( 'MetaConversions recent test sends', () => {
	it( 'shows an accepted test entry with its status and time', async () => {
		apiFetch.mockResolvedValue(
			config( { test_history: [ testHistoryEntry() ] } )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Purchase' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Received by Meta' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'January 1, 2026 11:00 am' )
		).toBeInTheDocument();
		expect( screen.getByText( 'HTTP 200' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Events received: 1' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Trace ID: AbCtrace123' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Messages: none' ) ).toBeInTheDocument();
	} );

	it( 'shows a legacy entry without diagnostics or a received claim', async () => {
		apiFetch.mockResolvedValue(
			config( {
				test_history: [
					{
						event_name: 'PageView',
						accepted: true,
						code: '',
						type: '',
						time: '2026-01-01 10:00:00',
						time_local: 'January 1, 2026 11:00 am',
					},
				],
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'Accepted (not confirmed)' )
		).toBeInTheDocument();
		expect( screen.queryByText( /^HTTP / ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /^Messages/ ) ).not.toBeInTheDocument();
	} );

	it( 'distinguishes zero events and unreported fields from empty messages', async () => {
		apiFetch.mockResolvedValue(
			config( {
				test_history: [
					testHistoryEntry( {
						event_name: 'FairEventCalendarClick',
						accepted: false,
						outcome: 'unconfirmed',
						type: 'unconfirmed',
						code: 'events_received_0',
						events_received: 0,
						messages: [ 'Event was dropped' ],
						fbtrace_id: null,
					} ),
					testHistoryEntry( {
						accepted: false,
						outcome: 'unconfirmed',
						type: 'unconfirmed',
						code: 'missing_events_received',
						events_received: null,
						messages: null,
						fbtrace_id: null,
					} ),
				],
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'Events received: 0' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Event was dropped' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Events received: not reported' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Messages: not reported' )
		).toBeInTheDocument();
		expect( screen.getAllByText( 'Not confirmed' ) ).toHaveLength( 2 );
		expect( screen.queryByText( /^Trace ID/ ) ).not.toBeInTheDocument();
	} );

	it( 'shows a rejected test entry with its safe failure detail', async () => {
		apiFetch.mockResolvedValue(
			config( {
				test_history: [
					testHistoryEntry( {
						accepted: false,
						type: 'configuration',
						code: 'missing_test_code',
					} ),
				],
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Rejected' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Error: configuration: missing_test_code' )
		).toBeInTheDocument();
	} );

	it( 'does not show a failure detail for an accepted test entry', async () => {
		apiFetch.mockResolvedValue(
			config( { test_history: [ testHistoryEntry() ] } )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		await screen.findByText( 'Received by Meta' );
		expect( screen.queryByText( /^Error:/ ) ).not.toBeInTheDocument();
	} );

	it( 'shows an empty state when no test events have been sent yet', async () => {
		apiFetch.mockResolvedValue( config() );

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( 'No test events sent yet.' )
		).toBeInTheDocument();
	} );

	it( 'reloads the settings after a test send so the new entry appears', async () => {
		apiFetch.mockResolvedValue( config() );

		render( <MetaConversions onNotice={ () => {} } /> );

		const button = await screen.findByRole( 'button', {
			name: 'Send PageView test',
		} );
		apiFetch.mockResolvedValueOnce( {
			accepted: true,
			event_name: 'PageView',
		} );
		apiFetch.mockResolvedValueOnce(
			config( {
				test_history: [
					testHistoryEntry( { event_name: 'PageView' } ),
				],
			} )
		);
		fireEvent.click( button );

		expect(
			await screen.findByText( 'Received by Meta' )
		).toBeInTheDocument();
	} );
} );

describe( 'MetaConversions calendar click test', () => {
	const FBP = 'fb.1.1712345678901.adminbrowser';
	const single = {
		id: 34,
		event_id: 12,
		title: 'Mix and Move',
		start_datetime: '2026-11-01 18:00:00',
		occurrence_type: 'single',
		status: 'active',
	};
	const series = {
		id: 50,
		event_id: 20,
		title: 'Weekly jam',
		start_datetime: '2026-11-02 19:00:00',
		occurrence_type: 'master',
		status: 'active',
		children: [
			{
				id: 51,
				event_id: 20,
				start_datetime: '2026-11-09 19:00:00',
				status: 'active',
			},
			{
				id: 52,
				event_id: 20,
				start_datetime: '2026-11-16 19:00:00',
				status: 'cancelled',
			},
		],
	};
	const withoutPage = {
		id: 99,
		event_id: null,
		title: 'Mix without page',
		status: 'active',
	};
	const cancelled = {
		id: 77,
		event_id: 30,
		title: 'Mix cancelled',
		start_datetime: '2026-11-03 18:00:00',
		status: 'cancelled',
	};
	let eventList;
	let testResponse;

	function searchOf( path ) {
		return new URLSearchParams( path.split( '?' )[ 1 ] ).get( 'search' );
	}

	function routeApi() {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path.startsWith( '/fair-events/v1/event-dates/all' ) ) {
				return eventList( searchOf( path ), path );
			}
			if ( method === 'POST' ) {
				return testResponse();
			}
			return Promise.resolve( config() );
		} );
	}

	function grantConsent() {
		window.wp_has_consent = () => true;
		document.cookie = `_fbp=${ FBP }`;
	}

	function combobox() {
		return screen.getByRole( 'combobox', { name: 'Event' } );
	}

	async function openEvents() {
		const input = await screen.findByRole( 'combobox', { name: 'Event' } );
		fireEvent.focus( input );
		return input;
	}

	async function selectEvent( name ) {
		await openEvents();
		const option = await screen.findByRole( 'option', { name } );
		await act( async () => {
			fireEvent.click( option );
		} );
	}

	function sendButton() {
		return screen.getByRole( 'button', {
			name: 'Send FairEventCalendarClick test',
		} );
	}

	function standardButtons() {
		return [ 'PageView', 'InitiateCheckout', 'Purchase' ].map( ( name ) =>
			screen.getByRole( 'button', { name: `Send ${ name } test` } )
		);
	}

	function expectStandardTestsEnabled() {
		standardButtons().forEach( ( button ) =>
			expect( button ).toBeEnabled()
		);
	}

	beforeAll( () => {
		// The open dropdown scrolls its selected option into view, which
		// jsdom does not implement.
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
	} );

	beforeEach( () => {
		eventList = ( search ) => {
			const all = [ single, series, withoutPage, cancelled ];
			return Promise.resolve(
				search
					? all.filter( ( item ) => item.title.includes( search ) )
					: all
			);
		};
		testResponse = () =>
			Promise.resolve( {
				accepted: true,
				event_name: 'FairEventCalendarClick',
				outcome: 'received',
				diagnostics: {
					http_status: 200,
					events_received: 1,
					messages: [],
					fbtrace_id: 'CalTrace1',
				},
			} );
		apiFetch.mockReset();
		routeApi();
	} );

	afterEach( () => {
		delete window.wp_has_consent;
		document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
	} );

	it( 'lists the latest events with a page without typing', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );

		await openEvents();
		expect(
			await screen.findByRole( 'option', { name: /^Mix and Move — / } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'option', { name: /^Weekly jam — / } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: /Mix without page/ } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: /Mix cancelled/ } )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( 'Select the event the test click belongs to.' )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();
	} );

	it( 'selects an event with the keyboard', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );

		const input = await openEvents();
		await screen.findByRole( 'option', { name: /^Mix and Move — / } );
		// The first match starts highlighted; move to the second and pick it.
		fireEvent.keyDown( input, { code: 'ArrowDown' } );
		await act( async () => {
			fireEvent.keyDown( input, { code: 'Enter' } );
		} );

		await waitFor( () =>
			expect( input.value ).toMatch( /^Weekly jam — / )
		);
		expect(
			screen.getByText( 'Select a date of this series.' )
		).toBeInTheDocument();
	} );

	it( 'searches by title after a pause and drops a slower earlier response', async () => {
		grantConsent();
		const pending = {};
		eventList = ( search ) =>
			search
				? new Promise( ( resolve ) => {
						pending[ search ] = resolve;
					} )
				: Promise.resolve( [ single, series ] );
		render( <MetaConversions onNotice={ () => {} } /> );

		const input = await openEvents();
		fireEvent.change( input, { target: { value: 'Mix' } } );
		await waitFor( () => expect( pending.Mix ).toBeDefined() );
		fireEvent.change( input, { target: { value: 'Weekly' } } );
		await waitFor( () => expect( pending.Weekly ).toBeDefined() );

		await act( async () => {
			pending.Weekly( [ series ] );
		} );
		await act( async () => {
			pending.Mix( [ single ] );
		} );

		expect(
			screen.getByRole( 'option', { name: /^Weekly jam — / } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'option', { name: /^Mix and Move — / } )
		).not.toBeInTheDocument();
		// One request per pause in typing, not per keystroke.
		expect(
			apiFetch.mock.calls.filter( ( [ { path } ] ) =>
				path.includes( 'search=' )
			)
		).toHaveLength( 2 );
	} );

	it( 'keeps the selected event through later searches until it is cleared', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( /^Mix and Move — / );

		fireEvent.change( combobox(), { target: { value: 'Weekly' } } );
		expect(
			await screen.findByRole( 'option', { name: /^Weekly jam — / } )
		).toBeInTheDocument();
		fireEvent.keyDown( combobox(), { code: 'Escape' } );

		await waitFor( () =>
			expect( combobox().value ).toMatch( /^Mix and Move — / )
		);
		expect( sendButton() ).toBeEnabled();

		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );
		} );
		expect(
			screen.getByText( 'Select the event the test click belongs to.' )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();
	} );

	it( 'says when no event with a page matches the search', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );

		const input = await openEvents();
		fireEvent.change( input, { target: { value: 'Nothing like it' } } );

		expect(
			await screen.findByText(
				'No events with an event page match “Nothing like it”.'
			)
		).toBeInTheDocument();

		// Once the picker is left, the message no longer describes it.
		fireEvent.blur( input );
		expect(
			screen.queryByText( /No events with an event page match/ )
		).not.toBeInTheDocument();
	} );

	it( 'explains a failed event request and retries it', async () => {
		grantConsent();
		let fail = true;
		eventList = () =>
			fail
				? Promise.reject( new Error( 'offline' ) )
				: Promise.resolve( [ single ] );
		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByRole( 'button', { name: 'Try again' } )
		).toBeInTheDocument();
		// The notice is also announced to screen readers.
		expect(
			screen.getAllByText( 'Events could not be loaded.' ).length
		).toBeGreaterThan( 0 );
		expectStandardTestsEnabled();

		fail = false;
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Try again' } )
			).not.toBeInTheDocument()
		);
		await selectEvent( /^Mix and Move — / );
		expect( sendButton() ).toBeEnabled();
	} );

	it( 'keeps the standard tests usable while choosing an event and while this browser is blocked', async () => {
		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( /WP Consent API is not active/ )
		).toBeInTheDocument();
		expectStandardTestsEnabled();

		fireEvent.change( await openEvents(), { target: { value: 'Mix' } } );
		expectStandardTestsEnabled();
		await selectEvent( /^Mix and Move — / );
		expectStandardTestsEnabled();
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Reset' } ) );
		} );
		expectStandardTestsEnabled();
		expect( sendButton() ).toBeDisabled();
	} );

	it( 'explains missing consent API, consent and identifiers, and checks again without losing the event', async () => {
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( /^Mix and Move — / );

		expect(
			screen.getByText( /WP Consent API is not active/ )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();
		const checkAgain = () =>
			screen.getByRole( 'button', {
				name: 'Check this browser again',
			} );

		window.wp_has_consent = () => false;
		fireEvent.click( checkAgain() );
		expect(
			screen.getByText( /has not given marketing consent/ )
		).toBeInTheDocument();

		window.wp_has_consent = () => true;
		fireEvent.click( checkAgain() );
		expect(
			screen.getByText( /has no Meta browser identifier/ )
		).toBeInTheDocument();

		window.wp_has_consent = () => {
			throw new Error( 'banner broken' );
		};
		fireEvent.click( checkAgain() );
		expect(
			screen.getByText(
				/marketing consent or Meta cookies could not be read/
			)
		).toBeInTheDocument();

		grantConsent();
		fireEvent.click( checkAgain() );
		expect(
			screen.queryByRole( 'button', { name: 'Check this browser again' } )
		).not.toBeInTheDocument();
		expect( combobox().value ).toMatch( /^Mix and Move — / );
		expect( sendButton() ).toBeEnabled();
	} );

	it( 'checks consent again at send time and does not send without it', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( /^Mix and Move — / );

		window.wp_has_consent = () => false;
		fireEvent.click( sendButton() );

		expect(
			screen.getByText( /has not given marketing consent/ )
		).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( { method: 'POST' } )
		);
	} );

	it( 'sends the selected event context with this browser’s identifiers and keeps the result and selection', async () => {
		grantConsent();
		const onNotice = jest.fn();
		render( <MetaConversions onNotice={ onNotice } /> );
		await selectEvent( /^Mix and Move — / );

		expect( sendButton() ).toBeEnabled();
		fireEvent.click( sendButton() );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message:
					'Meta confirmed receiving the FairEventCalendarClick test event.',
			} )
		);
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-events-experimental/v1/meta-conversions/test',
				method: 'POST',
				data: {
					event_name: 'FairEventCalendarClick',
					post_id: 12,
					event_date_id: 34,
					marketing_consent: true,
					meta_fbp: FBP,
				},
			} )
		);
		const latest = await screen.findByRole( 'status' );
		expect(
			within( latest ).getByText( 'Received by Meta' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText( 'Events received: 1' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText( 'Trace ID: CalTrace1' )
		).toBeInTheDocument();
		await waitFor( () => expect( sendButton() ).toBeEnabled() );
		expect( combobox().value ).toMatch( /^Mix and Move — / );
	} );

	it( 'requires a date for a series and offers only dates that are not cancelled', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( /^Weekly jam — / );

		expect(
			screen.getByText( 'Select a date of this series.' )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();
		const dates = screen.getByLabelText( 'Date' );
		expect( within( dates ).getAllByRole( 'option' ) ).toHaveLength( 3 );

		fireEvent.change( dates, { target: { value: '51' } } );
		fireEvent.click( sendButton() );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					method: 'POST',
					data: expect.objectContaining( {
						post_id: 20,
						event_date_id: 51,
					} ),
				} )
			)
		);
	} );

	it( 'shows Meta’s failure diagnostics and server message and keeps the selection', async () => {
		grantConsent();
		testResponse = () =>
			Promise.reject( {
				code: 'meta_test_failed',
				message:
					'Meta answered, but did not confirm receiving the FairEventCalendarClick test event.',
				data: {
					status: 503,
					outcome: 'unconfirmed',
					category: 'unconfirmed',
					code: 'events_received_0',
					diagnostics: {
						http_status: 200,
						events_received: 0,
						messages: [ 'Event dropped' ],
						fbtrace_id: 'CalTrace2',
					},
				},
			} );
		const onNotice = jest.fn();
		render( <MetaConversions onNotice={ onNotice } /> );
		await selectEvent( /^Mix and Move — / );
		fireEvent.click( sendButton() );

		const latest = await screen.findByRole( 'status' );
		expect(
			within( latest ).getByText( 'Not confirmed' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText( 'Events received: 0' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText( 'Event dropped' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText(
				'Error: unconfirmed: events_received_0'
			)
		).toBeInTheDocument();
		expect( onNotice ).toHaveBeenCalledWith( {
			status: 'error',
			message:
				'Meta answered, but did not confirm receiving the FairEventCalendarClick test event.',
		} );
		await waitFor( () => expect( sendButton() ).toBeEnabled() );
		expect( combobox().value ).toMatch( /^Mix and Move — / );
	} );

	it( 'names the shared reason beside the calendar test while a test is sending', async () => {
		grantConsent();
		let resolveTest;
		testResponse = () =>
			new Promise( ( resolve ) => {
				resolveTest = resolve;
			} );
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( /^Mix and Move — / );

		fireEvent.click( standardButtons()[ 0 ] );

		expect(
			await screen.findAllByText(
				'Wait until the current test event is sent.'
			)
		).toHaveLength( 2 );
		expect( sendButton() ).toBeDisabled();
		await act( async () => {
			resolveTest( { accepted: true } );
		} );
		await waitFor( () => expect( sendButton() ).toBeEnabled() );
	} );
} );

describe( 'MetaConversions access token', () => {
	it( 'shows that a saved token is configured without showing it, and links to Connectors', async () => {
		apiFetch.mockResolvedValue( config() );
		render( <MetaConversions onNotice={ () => {} } /> );

		// Notice also announces its text in a live region.
		expect(
			(
				await screen.findAllByText(
					/An access token is saved in Connectors\. It is not shown here\./
				)
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: /Manage in Connectors/ } )
		).toHaveAttribute(
			'href',
			'http://example.test/wp-admin/options-connectors.php'
		);
		expect( screen.queryByLabelText( /access token/i ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: /Clear access token/ } )
		).toBeNull();
	} );

	it( 'says delivery is stopped and blocks testing without a token', async () => {
		apiFetch.mockResolvedValue(
			config( { token_configured: false, token_source: 'none' } )
		);
		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			(
				await screen.findAllByText(
					/No access token is configured, so no conversions are delivered to Meta\./
				)
			)[ 0 ]
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();
		expect(
			screen.getAllByText(
				'Add a Meta access token in Connectors before sending a test event.'
			).length
		).toBeGreaterThan( 0 );
	} );

	it.each( [
		[
			'env',
			/environment variable.*does not stop delivery while it is set/,
		],
		[ 'constant', /constant.*does not stop delivery while it is defined/ ],
	] )(
		'explains that removing the Connectors token keeps a %s token in use',
		async ( source, message ) => {
			apiFetch.mockResolvedValue( config( { token_source: source } ) );
			render( <MetaConversions onNotice={ () => {} } /> );

			const [ notice ] = await screen.findAllByText( message );
			expect( notice ).toHaveTextContent(
				'FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN'
			);
		}
	);

	it( 'saves the other settings without a token', async () => {
		apiFetch.mockResolvedValue( config() );
		render( <MetaConversions onNotice={ () => {} } /> );

		fireEvent.change(
			await screen.findByLabelText( 'Dataset / Pixel ID' ),
			{
				target: { value: '456' },
			}
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save Meta settings' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events-experimental/v1/meta-conversions',
				method: 'POST',
				data: { dataset_id: '456', test_event_code: 'TEST12345' },
			} )
		);
	} );

	it( 'refreshes the token status on return from Connectors and keeps unsaved edits', async () => {
		apiFetch.mockResolvedValue(
			config( { token_configured: false, token_source: 'none' } )
		);
		render( <MetaConversions onNotice={ () => {} } /> );

		fireEvent.change(
			await screen.findByLabelText( 'Dataset / Pixel ID' ),
			{
				target: { value: '456' },
			}
		);

		apiFetch.mockResolvedValue(
			config( { dataset_id: '999', test_event_code: 'OTHER' } )
		);
		await act( async () => {
			window.dispatchEvent( new Event( 'focus' ) );
		} );

		expect(
			(
				await screen.findAllByText(
					/An access token is saved in Connectors/
				)
			)[ 0 ]
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Dataset / Pixel ID' ) ).toHaveValue(
			'456'
		);
		expect( screen.getByLabelText( 'Test Events code' ) ).toHaveValue(
			'TEST12345'
		);
		// The refreshed token does not make the unsaved edit look saved.
		expect(
			screen.getByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();
	} );
} );

describe( 'MetaConversions settings fields', () => {
	it( 'keeps autocomplete out of the settings fields', async () => {
		apiFetch.mockResolvedValue( config() );
		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByLabelText( 'Dataset / Pixel ID' )
		).toHaveAttribute( 'autocomplete', 'off' );
	} );

	it( 'discards unsaved edits and enables testing again', async () => {
		apiFetch.mockResolvedValue( config() );
		render( <MetaConversions onNotice={ () => {} } /> );

		fireEvent.change(
			await screen.findByLabelText( 'Dataset / Pixel ID' ),
			{
				target: { value: '456' },
			}
		);
		expect(
			screen.getByRole( 'button', { name: 'Send PageView test' } )
		).toBeDisabled();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Discard changes' } )
		);

		expect( screen.getByLabelText( 'Dataset / Pixel ID' ) ).toHaveValue(
			'123'
		);
		expect(
			screen.getByRole( 'button', { name: 'Send PageView test' } )
		).toBeEnabled();
		expect(
			screen.queryAllByText( /Save or discard your changes/ )
		).toHaveLength( 0 );
	} );
} );
