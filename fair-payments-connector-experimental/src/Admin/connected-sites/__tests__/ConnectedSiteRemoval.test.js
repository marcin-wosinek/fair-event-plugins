/**
 * @jest-environment jsdom
 *
 * Removing a connected site asks in a dialog that names the site (#1936).
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectedSitesApp from '../ConnectedSitesApp.js';

jest.mock( '@wordpress/api-fetch' );

const SITE = {
	id: 1,
	label: 'acroyoga-club.es',
	base_url: 'https://acroyoga-club.es',
	budget_id: null,
	scopes: [ 'transactions:read' ],
	status: 'connected',
	last_sync_at: null,
	enabled: true,
};

const removeCalls = () =>
	apiFetch.mock.calls.filter(
		( [ options ] ) => options.method === 'DELETE'
	);

const openRemove = async ( remove ) => {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( method === 'DELETE' ) {
			return remove();
		}
		return Promise.resolve(
			path === '/fair-payments-connector/v1/admin/connected-sites'
				? [ SITE ]
				: []
		);
	} );
	await act( async () => render( <ConnectedSitesApp /> ) );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Remove' } ) );
	return screen.getByRole( 'dialog', {
		name: 'Remove connected site — acroyoga-club.es',
	} );
};

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'ConnectedSitesApp — removing a site', () => {
	it( 'names the site and what stays, and cancelling sends nothing', async () => {
		const dialog = await openRemove( () => Promise.resolve( {} ) );

		expect(
			within( dialog ).getByText(
				/stops reading data from https:\/\/acroyoga-club\.es/
			)
		).toBeInTheDocument();
		expect(
			within( dialog ).getByText(
				/Transactions already imported from it are kept/
			)
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( removeCalls() ).toHaveLength( 0 );
	} );

	it( 'keeps the dialog open with the server message and retries', async () => {
		const remove = jest
			.fn()
			.mockRejectedValueOnce( { message: 'Connected site not found.' } )
			.mockResolvedValueOnce( { deleted: true } );
		const dialog = await openRemove( remove );
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Remove site',
		} );

		await act( async () => fireEvent.click( confirm ) );

		expect(
			within( dialog ).getByText( 'Connected site not found.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		await act( async () => fireEvent.click( confirm ) );

		expect( removeCalls() ).toHaveLength( 2 );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByText(
				'Connected site “acroyoga-club.es” removed.',
				{
					selector: '.components-notice__content',
				}
			)
		).toBeInTheDocument();
	} );
} );
