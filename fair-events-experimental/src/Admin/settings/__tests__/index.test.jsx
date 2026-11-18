/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock( '../ExperimentalTab.js', () => {
	return function ExperimentalTabMock( { onNotice } ) {
		return (
			<button type="button" onClick={ () => onNotice( 'hi' ) }>
				Experimental tab content
			</button>
		);
	};
} );

// The tab is registered as a module side effect. Use a fresh module registry
// (including `@wordpress/hooks`) so each scenario has its own filter store.
function loadModule() {
	let hooks;
	jest.isolateModules( () => {
		hooks = require( '@wordpress/hooks' );
		require( '../index.js' );
	} );
	return hooks;
}

describe( 'experimental settings tab registration', () => {
	it( 'appends an Experimental tab after the host tabs', () => {
		const { applyFilters } = loadModule();

		const tabs = applyFilters( 'fairEvents.settings.tabs', [
			{ name: 'general', title: 'General', order: 10 },
		] );

		expect( tabs.map( ( tab ) => tab.name ) ).toEqual( [
			'general',
			'experimental',
		] );
		const experimental = tabs[ 1 ];
		expect( experimental.title ).toBe( 'Experimental' );
		expect( experimental.order ).toBeGreaterThan( 30 );
	} );

	it( 'renders the experimental settings with the host notice handler', () => {
		const { applyFilters } = loadModule();
		const onNotice = jest.fn();

		const [ experimental ] = applyFilters( 'fairEvents.settings.tabs', [] );
		render( experimental.render( { onNotice } ) );

		screen
			.getByRole( 'button', { name: 'Experimental tab content' } )
			.click();
		expect( onNotice ).toHaveBeenCalledWith( 'hi' );
	} );

	describe( 'Organizer tab', () => {
		const hostTabs = [
			{ name: 'general', title: 'General', order: 10 },
			{
				name: 'organizer',
				title: 'Organizer',
				order: 30,
				render: () => <p>Single organizer form</p>,
			},
		];

		afterEach( () => {
			delete window.fairEventsExperimentalSettingsData;
		} );

		it( 'is removed while organizer management is enabled', () => {
			window.fairEventsExperimentalSettingsData = {
				organizersEnabled: true,
			};
			const { applyFilters } = loadModule();

			const tabs = applyFilters( 'fairEvents.settings.tabs', hostTabs );

			expect( tabs.map( ( tab ) => tab.name ) ).toEqual( [
				'general',
				'experimental',
			] );
		} );

		it( 'stays the single organizer tab while disabled', () => {
			window.fairEventsExperimentalSettingsData = {
				organizersEnabled: false,
			};
			const { applyFilters } = loadModule();

			const tabs = applyFilters( 'fairEvents.settings.tabs', hostTabs );
			const organizer = tabs.find( ( tab ) => 'organizer' === tab.name );

			expect( organizer.title ).toBe( 'Organizer' );
			render( organizer.render( { onNotice: jest.fn() } ) );
			expect( screen.getByText( 'Single organizer form' ) ).toBeVisible();
		} );
	} );
} );
