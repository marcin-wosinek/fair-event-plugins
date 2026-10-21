/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import MetaPage from '../MetaPage.js';

jest.mock( '@wordpress/api-fetch' );

function config( overrides ) {
	return {
		dataset_id: '123',
		token_configured: true,
		token_source: 'database',
		connectors_url: 'http://example.test/wp-admin/options-connectors.php',
		test_event_code: 'TEST12345',
		diagnostics: { counts: {}, recent: [] },
		test_history: [],
		consent_api_available: true,
		...overrides,
	};
}

// The page-level notice sits directly under the heading; the card has
// notices of its own, and the a11y speak region mirrors the text.
function pageNotice( container ) {
	return container.querySelector( '.fair-events-meta > .components-notice' );
}

describe( 'MetaPage', () => {
	it( 'renders the Meta heading with the Meta Conversions controls', async () => {
		apiFetch.mockResolvedValue( config() );

		render( <MetaPage /> );

		expect(
			screen.getByRole( 'heading', { level: 1, name: 'Meta' } )
		).toBeInTheDocument();
		expect(
			await screen.findByRole( 'textbox', { name: 'Dataset / Pixel ID' } )
		).toHaveValue( '123' );
		expect(
			screen.getByText( /event-button clicks and checkout and purchase/ )
		).toBeInTheDocument();
	} );

	it( 'shows a dismissible page notice after saving', async () => {
		apiFetch.mockImplementation( ( { method } ) =>
			Promise.resolve(
				config( method === 'POST' ? { dataset_id: '456' } : {} )
			)
		);

		const { container } = render( <MetaPage /> );

		fireEvent.change(
			await screen.findByRole( 'textbox', {
				name: 'Dataset / Pixel ID',
			} ),
			{ target: { value: '456' } }
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save Meta settings' } )
		);

		await screen.findAllByText( 'Meta Conversions settings saved.' );
		const notice = pageNotice( container );
		expect( notice ).toHaveTextContent(
			'Meta Conversions settings saved.'
		);

		fireEvent.click(
			within( notice ).getByRole( 'button', { name: /close/i } )
		);
		expect( pageNotice( container ) ).toBeNull();
	} );

	it( 'shows a page notice when the settings cannot be loaded', async () => {
		apiFetch.mockRejectedValue( new Error( 'offline' ) );

		const { container } = render( <MetaPage /> );

		await screen.findAllByText(
			'Failed to load Meta Conversions settings.'
		);
		expect( pageNotice( container ) ).toHaveClass( 'is-error' );
	} );
} );
