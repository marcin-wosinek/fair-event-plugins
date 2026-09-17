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
		code: '',
		type: '',
		time: '2026-01-01 10:00:00',
		time_local: 'January 1, 2026 11:00 am',
		...overrides,
	};
}

function outcome( overrides ) {
	return {
		event_name: 'Purchase',
		state: 'accepted',
		result_category: 'accepted',
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
	it( 'shows an accepted outcome with its status, mode, time and attempt count', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [ outcome() ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Purchase' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Delivered' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Live' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'January 1, 2026 11:00 am' )
		).toBeInTheDocument();
		expect( screen.getByText( '1 attempt' ) ).toBeInTheDocument();
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
					counts: { accepted: 3, retry_pending: 1 },
					recent: [ outcome() ],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect( await screen.findByText( 'Delivered: 3' ) ).toBeInTheDocument();
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
		} );
		fireEvent.click( button );

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith( {
				status: 'success',
				message: 'Meta accepted the InitiateCheckout test event.',
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
		expect( screen.getByText( 'Accepted' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'January 1, 2026 11:00 am' )
		).toBeInTheDocument();
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

		await screen.findByText( 'Accepted' );
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

		expect( await screen.findByText( 'Accepted' ) ).toBeInTheDocument();
	} );
} );
