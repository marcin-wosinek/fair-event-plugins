/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MetaConversions from '../MetaConversions.js';

jest.mock( '@wordpress/api-fetch' );

function config( overrides ) {
	return {
		dataset_id: '123',
		token_configured: true,
		test_event_code: 'TEST12345',
		diagnostics: { counts: {}, recent: [] },
		...overrides,
	};
}

describe( 'MetaConversions recent delivery outcomes', () => {
	it( 'labels a test-mode outcome as Test', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [
						{
							event_name: 'Purchase',
							state: 'accepted',
							attempt_count: 1,
							payment_mode: 'test',
							updated_at: '2026-01-01 10:00:00',
						},
					],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( /Purchase: accepted/ )
		).toHaveTextContent( 'Test' );
	} );

	it( 'labels a live-mode outcome as Live', async () => {
		apiFetch.mockResolvedValue(
			config( {
				diagnostics: {
					counts: { accepted: 1 },
					recent: [
						{
							event_name: 'Purchase',
							state: 'accepted',
							attempt_count: 1,
							payment_mode: 'live',
							updated_at: '2026-01-01 10:00:00',
						},
					],
				},
			} )
		);

		render( <MetaConversions onNotice={ () => {} } /> );

		expect(
			await screen.findByText( /Purchase: accepted/ )
		).toHaveTextContent( 'Live' );
	} );
} );
