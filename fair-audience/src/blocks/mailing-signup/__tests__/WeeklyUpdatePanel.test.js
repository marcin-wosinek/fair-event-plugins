/**
 * @jest-environment jsdom
 *
 * Weekly-update settings of the Mailing Signup block (#2042): the editor
 * offers the three checkbox modes, loads feeds only when the checkbox is
 * shown, and explains settings the published form cannot honour.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import WeeklyUpdatePanel, {
	weeklySettingsNotice,
} from '../WeeklyUpdatePanel.js';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const FEEDS = {
	available: true,
	feeds: [
		{ id: 2, name: 'Workshops' },
		{ id: 3, name: 'Concerts' },
	],
};

const panel = ( attributes ) => {
	const setAttributes = jest.fn();
	render(
		<WeeklyUpdatePanel
			attributes={ {
				weeklyUpdate: 'hidden',
				feedSelection: 'multiselect',
				feedId: 0,
				...attributes,
			} }
			setAttributes={ setAttributes }
		/>
	);
	return setAttributes;
};

beforeEach( () => {
	apiFetch.mockReset();
	apiFetch.mockResolvedValue( FEEDS );
} );

it( 'leaves feeds unloaded while the checkbox is not shown', () => {
	const setAttributes = panel( {} );

	expect( apiFetch ).not.toHaveBeenCalled();
	expect( screen.queryByLabelText( 'Event feeds' ) ).not.toBeInTheDocument();

	fireEvent.change( screen.getByLabelText( 'Weekly update checkbox' ), {
		target: { value: 'checked' },
	} );
	expect( setAttributes ).toHaveBeenCalledWith( {
		weeklyUpdate: 'checked',
	} );
} );

it( 'chooses the one hidden feed from the eligible feeds', async () => {
	const setAttributes = panel( {
		weeklyUpdate: 'unchecked',
		feedSelection: 'hidden',
	} );

	const select = await screen.findByLabelText( 'Event feed' );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/fair-audience/v1/mailing-signup/weekly-feeds',
	} );
	// Notice also speaks its message, so the text appears twice.
	expect(
		screen.getAllByText( 'Choose the event feed subscribers receive.' )
	).not.toHaveLength( 0 );

	fireEvent.change( select, { target: { value: '3' } } );
	expect( setAttributes ).toHaveBeenCalledWith( { feedId: 3 } );
} );

it( 'reports a configured feed that is no longer eligible', async () => {
	panel( { weeklyUpdate: 'checked', feedSelection: 'hidden', feedId: 9 } );

	expect(
		await screen.findAllByText( /no longer has a weekly update/ )
	).not.toHaveLength( 0 );
	expect( screen.getByLabelText( 'Event feed' ) ).toHaveValue( '9' );
} );

it( 'reports when feeds cannot be loaded', async () => {
	apiFetch.mockRejectedValue( new Error( 'offline' ) );
	panel( { weeklyUpdate: 'checked' } );

	expect(
		await screen.findAllByText( /could not be loaded/ )
	).not.toHaveLength( 0 );
} );

describe( 'weeklySettingsNotice', () => {
	const settings = {
		weeklyUpdate: 'checked',
		feedSelection: 'multiselect',
		feedId: 0,
		feeds: FEEDS,
	};

	it( 'says nothing for a working configuration or while loading', () => {
		expect( weeklySettingsNotice( settings ) ).toBe( null );
		expect( weeklySettingsNotice( { ...settings, feeds: null } ) ).toBe(
			null
		);
		expect(
			weeklySettingsNotice( {
				...settings,
				feedSelection: 'hidden',
				feedId: 2,
			} )
		).toBe( null );
	} );

	it( 'warns when Fair Events cannot list feeds', () => {
		expect(
			weeklySettingsNotice( {
				...settings,
				feeds: { available: false, feeds: [] },
			} ).message
		).toMatch( /Activate Fair Events/ );
	} );

	it( 'warns when no feed has a weekly update', () => {
		expect(
			weeklySettingsNotice( {
				...settings,
				feeds: { available: true, feeds: [] },
			} ).message
		).toMatch( /No event feed has a weekly update/ );
	} );
} );
