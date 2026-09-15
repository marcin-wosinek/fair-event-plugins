/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SettingsApp from '../SettingsApp.js';

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

describe( 'SettingsApp Meta Conversions gating', () => {
	it( 'does not mount the Meta Conversions card when the feature is disabled', async () => {
		setFeatureRegistry( {
			'meta-conversions': { enabled: false, label: 'Meta Conversions' },
		} );

		render( <SettingsApp /> );

		await screen.findByText( 'Feature Bundles' );

		expect(
			screen.queryByRole( 'heading', { name: 'Meta Conversions' } )
		).not.toBeInTheDocument();
	} );

	it( 'mounts the Meta Conversions card when the feature is enabled', async () => {
		setFeatureRegistry( {
			'meta-conversions': { enabled: true, label: 'Meta Conversions' },
		} );

		render( <SettingsApp /> );

		expect(
			await screen.findByRole( 'heading', { name: 'Meta Conversions' } )
		).toBeInTheDocument();
	} );
} );
