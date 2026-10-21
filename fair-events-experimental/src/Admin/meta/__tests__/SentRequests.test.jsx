/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SentRequests, {
	compareRequests,
	describeValue,
	fieldNotes,
} from '../SentRequests.js';
import MetaConversions from '../MetaConversions.js';

jest.mock( '@wordpress/api-fetch' );

function request( fields, overrides ) {
	return {
		version: 1,
		method: 'POST',
		content_type: 'application/json',
		api_version: 'v26.0',
		dataset_id: '1234567890',
		test_events_code: false,
		truncated: false,
		fields: [
			{ path: 'data', type: 'array', state: 'structure', count: 1 },
			{
				path: 'data[0].event_name',
				type: 'string',
				state: 'value',
				value: 'Purchase',
			},
			{
				path: 'data[0].user_data.fbp',
				type: 'string',
				state: 'redacted',
				length: 26,
				check: 'valid',
			},
			{
				path: 'access_token',
				type: 'string',
				state: 'redacted',
				length: 20,
			},
			...fields,
		],
		...overrides,
	};
}

function attempt( overrides ) {
	return {
		id: 1,
		origin: 'production',
		delivery_path: 'queued',
		event_name: 'Purchase',
		attempt_number: 3,
		payment_mode: 'test',
		test_events: false,
		outcome: 'rejected',
		code: '100',
		type: 'oauthexception',
		response: {
			http_status: 400,
			events_received: null,
			messages: [ 'Invalid parameter' ],
			fbtrace_id: 'Trace1',
		},
		request: request( [] ),
		created_at: '2026-01-01 10:00:00',
		created_at_local: 'January 1, 2026 10:00 am',
		...overrides,
	};
}

function page( items, overrides ) {
	return { items, total: items.length, total_pages: 1, ...overrides };
}

async function openLog() {
	await act( async () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Show sent requests' } )
		);
	} );
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'compareRequests', () => {
	it( 'aligns fields by path and marks missing and different values', () => {
		const first = request( [
			{
				path: 'data[0].custom_data.currency',
				type: 'string',
				state: 'value',
				value: 'EUR',
			},
			{
				path: 'data[0].custom_data.order_id',
				type: 'string',
				state: 'redacted',
				length: 2,
			},
		] );
		const second = request( [
			{
				path: 'data[0].custom_data.currency',
				type: 'string',
				state: 'value',
				value: 'USD',
			},
			{
				path: 'data[0].user_data.em',
				type: 'string',
				state: 'redacted',
				length: 64,
				check: 'sha256',
			},
		] );
		const rows = compareRequests( first, second );
		const byPath = Object.fromEntries(
			rows.map( ( row ) => [ row.path, row ] )
		);
		expect( byPath[ 'data[0].event_name' ].differs ).toBe( false );
		expect( byPath[ 'data[0].custom_data.currency' ].differs ).toBe( true );
		expect( byPath[ 'data[0].custom_data.order_id' ].second ).toBeNull();
		expect( byPath[ 'data[0].user_data.em' ].first ).toBeNull();
		expect( byPath[ 'data[0].user_data.em' ].differs ).toBe( true );
	} );
} );

describe( 'field descriptions', () => {
	it( 'tells missing, null, empty, structural and redacted values apart', () => {
		expect( describeValue( { type: 'null', state: 'null' } ) ).toBe(
			'null'
		);
		expect( describeValue( { type: 'string', state: 'empty' } ) ).toBe(
			'Empty text'
		);
		expect(
			describeValue( { type: 'array', state: 'empty', count: 0 } )
		).toBe( 'Empty list' );
		expect(
			describeValue( { type: 'object', state: 'structure', count: 1 } )
		).toBe( 'Object with 1 field' );
		expect(
			describeValue( { type: 'array', state: 'structure', count: 2 } )
		).toBe( 'List of 2 items' );
		expect(
			describeValue( { type: 'string', state: 'redacted', length: 1 } )
		).toBe( 'Redacted, 1 character' );
		expect( describeValue( { type: 'integer', state: 'redacted' } ) ).toBe(
			'Redacted'
		);
		expect(
			describeValue( { type: 'number', state: 'value', value: 12.5 } )
		).toBe( '12.5' );
	} );

	it( 'describes validation and URL structure without values', () => {
		expect( fieldNotes( { check: 'not_sha256' } ) ).toEqual( [
			'not a SHA-256 hash',
		] );
		expect(
			fieldNotes( {
				url: {
					origin: 'https://example.test',
					same_site: true,
					path: true,
					query: 2,
					fragment: false,
				},
			} )
		).toEqual( [
			'Site: https://example.test',
			'this site',
			'has a path',
			'2 query parameters',
		] );
	} );
} );

describe( 'SentRequests', () => {
	it( 'loads nothing until opened, then lists attempts with independent labels', async () => {
		apiFetch.mockResolvedValue( page( [ attempt() ] ) );
		render( <SentRequests refreshKey={ 0 } /> );
		expect( apiFetch ).not.toHaveBeenCalled();
		await openLog();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events-experimental/v1/meta-conversions/attempts?page=1&per_page=10',
		} );
		expect( screen.getByText( 'Rejected by Meta' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Production', { selector: ':not(option)' } )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Not sent to Test Events' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Payment test mode' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Queued, attempt 3' ) ).toBeInTheDocument();
	} );

	it( 'shows the sent request beside Meta’s answer', async () => {
		apiFetch.mockResolvedValue( page( [ attempt() ] ) );
		render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Show details' } )
		);

		const fields = screen.getByRole( 'region', {
			name: 'Sent request fields',
		} );
		expect(
			within( fields ).getByText( 'data[0].user_data.fbp' )
		).toBeInTheDocument();
		expect(
			within( fields ).getByText( 'Redacted, 26 characters' )
		).toBeInTheDocument();
		expect(
			within( fields ).getByText( /valid Meta browser ID/ )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'POST to dataset 1234567890, Graph API v26.0' )
		).toBeInTheDocument();
		expect( screen.getByText( 'No Test Events code' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Error: oauthexception: 100' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Trace ID: Trace1' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Invalid parameter' ) ).toBeInTheDocument();
	} );

	it( 'says when Meta never answered, a result was not recorded, or a request was not logged', async () => {
		apiFetch.mockResolvedValue(
			page( [
				attempt( {
					id: 1,
					outcome: 'transport',
					response: {
						http_status: null,
						events_received: null,
						messages: null,
						fbtrace_id: null,
					},
				} ),
				attempt( { id: 2, outcome: null, response: null } ),
				attempt( { id: 3, request: null } ),
			] )
		);
		render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		screen
			.getAllByRole( 'button', { name: 'Show details' } )
			.forEach( ( button ) => fireEvent.click( button ) );

		expect(
			screen.getByText( 'Could not reach Meta' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'No response was received from Meta.' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Result unavailable' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'The request was logged, but its result was not recorded.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Request details are unavailable for this entry.'
			)
		).toBeInTheDocument();
		// The transport failure still shows what was sent.
		expect(
			screen.getAllByRole( 'region', { name: 'Sent request fields' } )
		).toHaveLength( 2 );
	} );

	it( 'filters by origin and event, starting from the first page', async () => {
		apiFetch.mockResolvedValue( page( [ attempt() ], { total_pages: 3 } ) );
		render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		await act( async () => {
			fireEvent.click( screen.getByRole( 'button', { name: 'Older' } ) );
		} );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/meta-conversions/attempts?page=2&per_page=10',
		} );
		await act( async () => {
			fireEvent.change( screen.getByLabelText( 'Sent by' ), {
				target: { value: 'admin_test' },
			} );
		} );
		await act( async () => {
			fireEvent.change( screen.getByLabelText( 'Event' ), {
				target: { value: 'PageView' },
			} );
		} );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events-experimental/v1/meta-conversions/attempts?page=1&per_page=10&origin=admin_test&event_name=PageView',
		} );
	} );

	it( 'compares two selected attempts and shows only their differences by default', async () => {
		const test = attempt( {
			id: 1,
			origin: 'admin_test',
			delivery_path: 'test',
			payment_mode: '',
			test_events: true,
			request: request(
				[
					{
						path: 'test_event_code',
						type: 'string',
						state: 'redacted',
						length: 9,
					},
				],
				{ test_events_code: true }
			),
		} );
		const production = attempt( { id: 2 } );
		const third = attempt( { id: 3 } );
		apiFetch.mockResolvedValue( page( [ test, production, third ] ) );
		render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		const boxes = screen.getAllByRole( 'checkbox', { name: 'Compare' } );
		fireEvent.click( boxes[ 0 ] );
		fireEvent.click( boxes[ 1 ] );

		expect( boxes[ 2 ] ).toBeDisabled();
		expect(
			screen.getByText(
				'Two requests are selected. Clear one to choose another.'
			)
		).toBeInTheDocument();
		const comparison = screen.getByRole( 'region', {
			name: 'Request comparison',
		} );
		expect(
			within( comparison ).getByText( 'test_event_code' )
		).toBeInTheDocument();
		expect(
			within( comparison ).getByText( /string: Redacted, 9 characters/ )
		).toBeInTheDocument();
		expect(
			within( comparison ).getByText( 'Missing' )
		).toBeInTheDocument();
		expect(
			within( comparison ).queryByText( 'data[0].event_name' )
		).not.toBeInTheDocument();
		expect(
			within( comparison ).getByText(
				/Administrator test · Sent to Test Events/
			)
		).toBeInTheDocument();

		fireEvent.click(
			within( comparison ).getByRole( 'checkbox', {
				name: 'Show only differences',
			} )
		);
		expect(
			within( comparison ).getByText( 'data[0].event_name' )
		).toBeInTheDocument();
	} );

	it( 'reloads when a new request may have been logged', async () => {
		apiFetch.mockResolvedValue( page( [] ) );
		const { rerender } = render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		expect(
			screen.getByText(
				'No requests have been sent to Meta in the last 30 days.'
			)
		).toBeInTheDocument();
		await act( async () => {
			rerender( <SentRequests refreshKey={ 1 } /> );
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'explains a failed load', async () => {
		apiFetch.mockRejectedValue( new Error( 'nope' ) );
		render( <SentRequests refreshKey={ 0 } /> );
		await openLog();
		expect(
			screen.getAllByText( 'The sent requests could not be loaded.' )[ 0 ]
		).toBeInTheDocument();
	} );
} );

describe( 'MetaConversions sent request details', () => {
	const config = ( overrides ) => ( {
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
	} );

	it( 'shows the latest test’s sent request, also when Meta rejected it', async () => {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( 'POST' === method ) {
				return Promise.reject( {
					code: 'meta_test_failed',
					message: 'Meta rejected the PageView test event.',
					data: {
						outcome: 'rejected',
						code: '100',
						category: 'oauthexception',
						diagnostics: {
							http_status: 400,
							events_received: null,
							messages: [],
							fbtrace_id: null,
						},
						request: request( [], { test_events_code: true } ),
					},
				} );
			}
			return Promise.resolve(
				path.includes( 'attempts' ) ? page( [] ) : config()
			);
		} );
		render( <MetaConversions onNotice={ () => {} } /> );
		const send = await screen.findByRole( 'button', {
			name: 'Send PageView test',
		} );
		await act( async () => {
			fireEvent.click( send );
		} );
		const latest = screen.getByRole( 'status' );
		fireEvent.click(
			within( latest ).getByRole( 'button', {
				name: 'Show sent request',
			} )
		);
		expect(
			within( latest ).getByText( 'Test Events code included' )
		).toBeInTheDocument();
		expect(
			within( latest ).getByText( 'access_token' )
		).toBeInTheDocument();
	} );

	it( 'says whether earlier tests and deliveries have logged requests', async () => {
		apiFetch.mockResolvedValue(
			config( {
				test_history: [
					{
						event_name: 'Purchase',
						accepted: true,
						outcome: 'received',
						time_local: 'today',
						request_logged: true,
					},
					{
						event_name: 'PageView',
						accepted: true,
						outcome: 'received',
						time_local: 'yesterday',
					},
				],
				diagnostics: {
					counts: { received: 2 },
					recent: [
						{
							event_name: 'InitiateCheckout',
							state: 'received',
							attempt_count: 2,
							payment_mode: 'live',
							updated_at_local: 'today',
							logged_attempts: 2,
						},
						{
							event_name: 'Purchase',
							state: 'received',
							attempt_count: 1,
							payment_mode: 'live',
							updated_at_local: 'before',
						},
					],
				},
			} )
		);
		render( <MetaConversions onNotice={ () => {} } /> );
		expect(
			await screen.findByText(
				'1 sent request is listed under Sent requests.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'2 sent requests are listed under Sent requests.'
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByText(
				'Sent request details are unavailable for this entry.'
			)
		).toHaveLength( 2 );
	} );
} );
