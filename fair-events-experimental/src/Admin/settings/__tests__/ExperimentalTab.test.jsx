/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ExperimentalTab from '../ExperimentalTab.js';

jest.mock( '@wordpress/api-fetch' );

function setFeatureRegistry( features ) {
	window.fairEventsExperimentalSettingsData = { features };
}

beforeEach( () => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( {} );
		}
		return Promise.resolve( {
			dataset_id: '',
			token_configured: false,
			test_event_code: '',
			diagnostics: { counts: {}, recent: [] },
			consent_api_available: true,
		} );
	} );
} );

afterEach( () => {
	delete window.fairEventsExperimentalSettingsData;
} );

describe( 'ExperimentalTab Meta Conversions gating', () => {
	it( 'does not mount the Meta Conversions card when the feature is disabled', async () => {
		setFeatureRegistry( {
			'meta-conversions': { enabled: false, label: 'Meta Conversions' },
		} );

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		await screen.findByText( 'Feature Bundles' );

		expect(
			screen.queryByRole( 'heading', { name: 'Meta Conversions' } )
		).not.toBeInTheDocument();
	} );

	it( 'mounts the Meta Conversions card when the feature is enabled', async () => {
		setFeatureRegistry( {
			'meta-conversions': { enabled: true, label: 'Meta Conversions' },
		} );

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		expect(
			await screen.findByRole( 'heading', { name: 'Meta Conversions' } )
		).toBeInTheDocument();
	} );
} );

describe( 'ExperimentalTab Weekly notifications gating', () => {
	it( 'does not mount Weekly notifications when sources is disabled', async () => {
		setFeatureRegistry( {
			sources: { enabled: false, label: 'Event sources & feeds' },
		} );

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		await screen.findByText( 'Feature Bundles' );

		expect(
			screen.queryByRole( 'heading', { name: 'Weekly notifications' } )
		).not.toBeInTheDocument();
	} );
} );

describe( 'ExperimentalTab save feedback', () => {
	it( 'reports a successful feature save through onNotice', async () => {
		setFeatureRegistry( {
			mailings: { enabled: false, label: 'Mailings' },
		} );
		const onNotice = jest.fn();

		render( <ExperimentalTab onNotice={ onNotice } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Save Features' } )
		);

		await waitFor( () =>
			expect( onNotice ).toHaveBeenCalledWith(
				expect.objectContaining( { status: 'success' } )
			)
		);
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					fair_events_experimental_features: { mailings: false },
				},
			} )
		);
	} );
} );
