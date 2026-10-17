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
import MetaConversions from '../MetaConversions.js';

jest.mock( '@wordpress/api-fetch' );

function config( overrides ) {
	return {
		dataset_id: '123',
		token_configured: true,
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

		expect(
			await screen.findByText( /Save your changes before sending/ )
		).toBeInTheDocument();
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
	};
	const series = {
		id: 50,
		event_id: 20,
		title: 'Weekly jam',
		start_datetime: '2026-11-02 19:00:00',
		occurrence_type: 'master',
		generated_occurrences: [
			{ id: 51, start_datetime: '2026-11-09 19:00:00', status: 'active' },
			{
				id: 52,
				start_datetime: '2026-11-16 19:00:00',
				status: 'cancelled',
			},
		],
	};
	let testResponse;

	function routeApi() {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path.startsWith( '/fair-events/v1/event-dates' ) ) {
				return Promise.resolve( [
					single,
					series,
					{ id: 99, event_id: null, title: 'Mix without page' },
				] );
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

	async function selectEvent( label ) {
		fireEvent.change(
			await screen.findByLabelText( 'Search events by title' ),
			{ target: { value: 'Mix' } }
		);
		fireEvent.change( await screen.findByLabelText( 'Event' ), {
			target: { value: label },
		} );
	}

	function sendButton() {
		return screen.getByRole( 'button', {
			name: 'Send FairEventCalendarClick test',
		} );
	}

	beforeEach( () => {
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
		routeApi();
	} );

	afterEach( () => {
		delete window.wp_has_consent;
		document.cookie = '_fbp=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
	} );

	it( 'asks for an event first and lists only events with a page', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText(
				'Select the event and date the test click belongs to.'
			)
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();

		fireEvent.change( screen.getByLabelText( 'Search events by title' ), {
			target: { value: 'Mix' },
		} );
		const select = await screen.findByLabelText( 'Event' );
		expect(
			within( select ).queryByText( /Mix without page/ )
		).not.toBeInTheDocument();
		expect(
			within( select ).getByText( /^Mix and Move — / )
		).toBeInTheDocument();
	} );

	it( 'explains missing consent API, consent and identifiers before sending', async () => {
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( '34' );

		expect(
			screen.getByText( /WP Consent API is not active/ )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();

		window.wp_has_consent = () => false;
		fireEvent.change( screen.getByLabelText( 'Search events by title' ), {
			target: { value: 'Mix ' },
		} );
		expect(
			await screen.findByText( /has not given marketing consent/ )
		).toBeInTheDocument();

		window.wp_has_consent = () => true;
		fireEvent.change( screen.getByLabelText( 'Search events by title' ), {
			target: { value: 'Mix' },
		} );
		expect(
			await screen.findByText( /has no Meta browser identifier/ )
		).toBeInTheDocument();
		expect( sendButton() ).toBeDisabled();
	} );

	it( 'sends the selected event context with this browser’s identifiers and keeps the result', async () => {
		grantConsent();
		const onNotice = jest.fn();
		render( <MetaConversions onNotice={ onNotice } /> );
		await selectEvent( '34' );

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
	} );

	it( 'requires a date for a series and offers only dates that are not cancelled', async () => {
		grantConsent();
		render( <MetaConversions onNotice={ () => {} } /> );
		await selectEvent( '50' );

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

	it( 'shows Meta’s failure diagnostics and server message', async () => {
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
		routeApi();
		const onNotice = jest.fn();
		render( <MetaConversions onNotice={ onNotice } /> );
		await selectEvent( '34' );
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
	} );
} );
