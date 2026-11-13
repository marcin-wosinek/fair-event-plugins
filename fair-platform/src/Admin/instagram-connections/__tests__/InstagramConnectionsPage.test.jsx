/**
 * Instagram connection logs (#2231): endpoints, wording, statuses, statistics
 * and Instagram columns.
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import InstagramConnectionsPage from '../InstagramConnectionsPage.js';

jest.mock( '@wordpress/api-fetch' );

const ROWS = [
	{
		id: 21,
		site_name: 'Insta site',
		status: 'connected',
		instagram_username: 'fairevents',
		instagram_user_id: '17841400000',
		profile_created: 1,
	},
	{ id: 22, site_name: 'Bare site', status: 'disconnected' },
];

beforeEach( () => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-platform/v1/instagram-connections/stats' ) {
			return Promise.resolve( {
				total_connections: 2,
				successful: 1,
				failed: 0,
				unique_usernames: 1,
			} );
		}
		if (
			path.startsWith( '/fair-platform/v1/instagram-connections/cleanup' )
		) {
			return Promise.resolve( {} );
		}
		return Promise.resolve( { items: ROWS, total_pages: 1 } );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

test( 'renders the Instagram wording, statistics, statuses and columns', async () => {
	render( <InstagramConnectionsPage /> );

	expect( await screen.findByText( 'Insta site' ) ).toBeInTheDocument();
	expect(
		screen.getByRole( 'heading', { name: 'Instagram Connection Logs' } )
	).toBeInTheDocument();
	expect(
		screen.getByText(
			'Monitor Instagram OAuth connections from WordPress sites.'
		)
	).toBeInTheDocument();
	expect(
		screen.getByRole( 'heading', { name: 'Instagram Connection History' } )
	).toBeInTheDocument();
	expect(
		screen.getByText( 'Unique Usernames' ).previousSibling
	).toHaveTextContent( '1' );
	expect( screen.queryByText( 'Unique Sites' ) ).not.toBeInTheDocument();
	expect(
		within( screen.getByRole( 'table' ) )
			.getAllByRole( 'columnheader' )
			.map( ( th ) => th.textContent )
	).toEqual( [
		'ID',
		'Site',
		'Status',
		'IG Username',
		'IG User ID',
		'Connected At',
		'Last Refresh',
	] );

	const [ , first, second ] = screen.getAllByRole( 'row' );
	expect( first ).toHaveTextContent( '@fairevents' );
	expect( first ).toHaveTextContent( '17841400000' );
	// The profile indicator belongs to ordinary connections only.
	expect( first ).not.toHaveTextContent( 'Profile created' );
	// Instagram has no "disconnected" status; it shows the raw value.
	expect(
		within( second )
			.getAllByRole( 'cell' )
			.map( ( cell ) => cell.textContent )
	).toEqual( [ '22', 'Bare site', 'disconnected', '-', '-', '-', '-' ] );

	expect(
		within( screen.getByLabelText( 'Status Filter' ) )
			.getAllByRole( 'option' )
			.map( ( option ) => option.value )
	).toEqual( [ '', 'connected', 'failed' ] );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-platform/v1/instagram-connections?page=1&per_page=50&orderby=connected_at&order=DESC',
	} );
} );

test( 'uses the Instagram list fallback and empty message', async () => {
	apiFetch.mockImplementation( ( { path } ) =>
		path.endsWith( '/stats' ) ? Promise.resolve( {} ) : Promise.reject( {} )
	);
	render( <InstagramConnectionsPage /> );

	expect(
		await screen.findByText( 'Failed to load Instagram connections', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
	expect(
		screen.getByText( 'No Instagram connections found.' )
	).toBeInTheDocument();
} );

test( 'cleans up Instagram logs through its own endpoint', async () => {
	render( <InstagramConnectionsPage /> );
	await screen.findByText( 'Insta site' );

	fireEvent.change( screen.getByLabelText( 'Cleanup Days' ), {
		target: { value: '1' },
	} );
	fireEvent.click(
		screen.getByRole( 'button', { name: 'Cleanup Old Logs' } )
	);
	const dialog = screen.getByRole( 'dialog', {
		name: 'Delete old Instagram connection logs',
	} );
	expect( dialog ).toHaveTextContent(
		'This deletes every Instagram connection log entry older than 1 day.'
	);
	await act( async () => {
		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Delete old logs' } )
		);
	} );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-platform/v1/instagram-connections/cleanup?days=1',
		method: 'DELETE',
	} );
	expect(
		screen.getByText( 'Old logs cleaned up successfully', {
			selector: '.components-notice__content',
		} )
	).toBeInTheDocument();
} );
