/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { addFilter, removeAllFilters } from '@wordpress/hooks';
import SettingsApp from '../SettingsApp.js';

jest.mock( '../GeneralTab.js', () => () => <div>General content</div> );
jest.mock( '../FeaturesTab.js', () => () => <div>Features content</div> );
jest.mock( '../OrganizerTab.js', () => () => <div>Organizer content</div> );

function setUrl( search ) {
	window.history.replaceState( null, '', `/wp-admin/admin.php${ search }` );
}

function registerExtraTab( onRender = () => {} ) {
	addFilter( 'fairEvents.settings.tabs', 'test/extra-tab', ( tabs ) => [
		...tabs,
		{
			name: 'experimental',
			title: 'Experimental',
			order: 100,
			render: ( props ) => {
				onRender( props );
				return <div>Experimental content</div>;
			},
		},
	] );
}

// TabPanel (ariakit) sets up its tab ids in an effect after mount; flushing a
// tick via waitFor keeps that update wrapped in act() before we assert.
async function renderApp() {
	const utils = render( <SettingsApp /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'General' } )
		).toBeInTheDocument()
	);
	return utils;
}

beforeEach( () => {
	setUrl( '?page=fair-events-settings' );
} );

afterEach( () => {
	removeAllFilters( 'fairEvents.settings.tabs' );
} );

test( 'shows only the core tabs when no extension registers one', async () => {
	await renderApp();

	const tabNames = screen
		.getAllByRole( 'tab' )
		.map( ( tab ) => tab.textContent );
	expect( tabNames ).toEqual( [ 'General', 'Features', 'Organizer' ] );
	expect( screen.getByText( 'General content' ) ).toBeInTheDocument();
} );

test( 'falls back to General for an unknown ?tab= value', async () => {
	setUrl( '?page=fair-events-settings&tab=experimental' );

	await renderApp();

	expect( screen.getByText( 'General content' ) ).toBeInTheDocument();
} );

test( 'appends a filtered tab after the core tabs', async () => {
	registerExtraTab();

	await renderApp();

	const tabNames = screen
		.getAllByRole( 'tab' )
		.map( ( tab ) => tab.textContent );
	expect( tabNames ).toEqual( [
		'General',
		'Features',
		'Organizer',
		'Experimental',
	] );
} );

test( 'selects a filtered tab from ?tab= and passes onNotice', async () => {
	const onRender = jest.fn();
	registerExtraTab( onRender );
	setUrl( '?page=fair-events-settings&tab=experimental' );

	await renderApp();

	expect( screen.getByText( 'Experimental content' ) ).toBeInTheDocument();
	expect( onRender ).toHaveBeenCalledWith(
		expect.objectContaining( { onNotice: expect.any( Function ) } )
	);
} );

test( 'selecting a tab writes it to the URL for bookmarking', async () => {
	registerExtraTab();

	await renderApp();

	fireEvent.click( screen.getByRole( 'tab', { name: 'Experimental' } ) );
	expect( screen.getByText( 'Experimental content' ) ).toBeInTheDocument();
	expect( new URLSearchParams( window.location.search ).get( 'tab' ) ).toBe(
		'experimental'
	);

	fireEvent.click( screen.getByRole( 'tab', { name: 'General' } ) );
	expect(
		new URLSearchParams( window.location.search ).get( 'tab' )
	).toBeNull();
} );
