/**
 * @jest-environment jsdom
 *
 * While Fair Events Experimental manages the Instagram connection (#2076),
 * the Instagram tab links to Fair Events → Instagram instead of offering a
 * second place to change it.
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import SettingsApp from '../SettingsApp.js';
import { loadInstagramSettings } from '../settings-api.js';

jest.mock( '../settings-api.js' );

describe( 'SettingsApp Instagram tab', () => {
	afterEach( () => {
		delete window.fairAudienceSettingsData;
		jest.resetAllMocks();
	} );

	it( 'links to Fair Events → Instagram once the connection moved', async () => {
		window.fairAudienceSettingsData = {
			instagramPageUrl: '/wp-admin/admin.php?page=fair-events-instagram',
		};

		await act( async () => {
			render( <SettingsApp /> );
		} );

		expect(
			screen.getByRole( 'link', { name: 'Open Fair Events → Instagram' } )
		).toHaveAttribute(
			'href',
			'/wp-admin/admin.php?page=fair-events-instagram'
		);
		expect( loadInstagramSettings ).not.toHaveBeenCalled();
		expect(
			screen.queryByLabelText( 'Access Token' )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the connection form while Fair Audience manages it', async () => {
		window.fairAudienceSettingsData = { instagramPageUrl: null };
		loadInstagramSettings.mockReturnValue( new Promise( () => {} ) );

		await act( async () => {
			render( <SettingsApp /> );
		} );

		expect( loadInstagramSettings ).toHaveBeenCalled();
		expect(
			screen.queryByRole( 'link', {
				name: 'Open Fair Events → Instagram',
			} )
		).not.toBeInTheDocument();
	} );
} );
