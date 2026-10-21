/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ExperimentalTab from '../ExperimentalTab.js';

jest.mock( '@wordpress/api-fetch' );

beforeEach( () => {
	apiFetch.mockClear();
} );

function setFeatureRegistry( features ) {
	window.fairEventsExperimentalSettingsData = { features };
}

beforeEach( () => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/wp/v2/settings' ) {
			return Promise.resolve( {} );
		}
		return Promise.reject( new Error( `Unexpected request: ${ path }` ) );
	} );
} );

afterEach( () => {
	delete window.fairEventsExperimentalSettingsData;
} );

describe( 'ExperimentalTab Meta link', () => {
	it( 'shows no Meta card when the feature is disabled', async () => {
		window.fairEventsExperimentalSettingsData = {
			features: {
				'meta-conversions': {
					enabled: false,
					label: 'Meta Conversions',
				},
			},
			metaUrl: null,
		};

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		await screen.findByText( 'Feature Bundles' );

		expect(
			screen.queryByRole( 'heading', { name: 'Meta Conversions' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', { name: 'Open Meta' } )
		).not.toBeInTheDocument();
	} );

	it( 'links to the Meta page instead of mounting its controls when enabled', async () => {
		window.fairEventsExperimentalSettingsData = {
			features: {
				'meta-conversions': {
					enabled: true,
					label: 'Meta Conversions',
				},
			},
			metaUrl: '/wp-admin/admin.php?page=fair-events-meta',
		};

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		expect(
			await screen.findByRole( 'link', { name: 'Open Meta' } )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-meta'
		);
		expect(
			screen.queryByRole( 'textbox', { name: 'Dataset / Pixel ID' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save Meta settings' } )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( 'meta-conversions' ),
			} )
		);
	} );
} );

describe( 'ExperimentalTab Weekly notifications', () => {
	it( 'links to Event notifications in Fair Events instead of offering settings', async () => {
		window.fairEventsExperimentalSettingsData = {
			features: {},
			eventNotificationsUrl:
				'/wp-admin/admin.php?page=fair-events-event-notifications',
		};

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		expect(
			await screen.findByRole( 'link', {
				name: 'Open Event notifications',
			} )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-event-notifications'
		);
		expect(
			screen.queryByRole( 'button', { name: /weekly notification/i } )
		).not.toBeInTheDocument();
	} );

	it( 'asks for a Fair Events update when its page is not available', async () => {
		setFeatureRegistry( {} );

		render( <ExperimentalTab onNotice={ jest.fn() } /> );

		// The notice text is also announced through the a11y speak region.
		expect(
			(
				await screen.findAllByText(
					/Update Fair Events to manage them/
				)
			).length
		).toBeGreaterThan( 0 );
		expect(
			screen.queryByRole( 'link', { name: 'Open Event notifications' } )
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
