/**
 * @jest-environment jsdom
 *
 * Tests for the team members section of Manage Event's Event Details
 * (#2394): its registration, adding and removing members one at a time,
 * a failed change, an empty directory, and the read-only view on a series
 * date with its link to the series.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import EventTeamMembers from '../EventTeamMembers.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );

const NOTICE = { selector: '.components-notice__content' };

const ana = { id: 1, name: 'Ana', surname: 'Ruiz' };
const marek = { id: 2, name: 'Marek', surname: 'Nowak' };

const team = ( members, overrides = {} ) => ( {
	owner_event_date_id: 7,
	series_event_date_id: null,
	members,
	...overrides,
} );

const directory = [
	{ ...ana, email: 'ana@example.com' },
	{ ...marek, email: '' },
];

/** Route GETs to the team and the directory; other calls to `writes`. */
function mockApi( initialTeam, writes = jest.fn() ) {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.method ) {
			return writes( options );
		}
		if ( '/fair-events/v1/team-members' === options.path ) {
			return Promise.resolve( directory );
		}
		return Promise.resolve( initialTeam );
	} );
	return writes;
}

beforeEach( () => {
	apiFetch.mockReset();
	// jsdom has no layout; the combobox scrolls its highlighted option.
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
} );

describe( 'Team members section registration', () => {
	it( 'adds an Event Details section', () => {
		const sections = applyFilters(
			'fairEvents.manageEvent.detailsSections',
			[],
			{ eventDateId: 7 }
		);
		expect( sections.map( ( s ) => s.name ) ).toEqual( [ 'team-members' ] );
	} );
} );

describe( 'EventTeamMembers', () => {
	it( 'adds a member picked from the directory', async () => {
		const writes = mockApi(
			team( [ ana ] ),
			jest.fn( () => Promise.resolve( team( [ ana, marek ] ) ) )
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const picker = await screen.findByRole( 'combobox', {
			name: 'Add a team member',
		} );
		fireEvent.focus( picker );
		const option = await screen.findByRole( 'option', {
			name: 'Marek Nowak',
		} );
		expect(
			screen.queryByRole( 'option', { name: 'Ana Ruiz' } )
		).not.toBeInTheDocument();
		await act( async () => fireEvent.click( option ) );

		expect( writes ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-members',
			method: 'POST',
			data: { member_id: 2 },
		} );
		expect(
			await screen.findByText(
				'Marek Nowak was added to the team.',
				NOTICE
			)
		).toBeVisible();
		expect(
			screen.getByRole( 'button', {
				name: 'Remove Marek Nowak from the team',
			} )
		).toBeVisible();
	} );

	it( 'removes one member and keeps the others', async () => {
		const writes = mockApi(
			team( [ ana, marek ] ),
			jest.fn( () => Promise.resolve( team( [ marek ] ) ) )
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const remove = await screen.findByRole( 'button', {
			name: 'Remove Ana Ruiz from the team',
		} );
		await act( async () => fireEvent.click( remove ) );

		expect( writes ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-members/1',
			method: 'DELETE',
		} );
		expect(
			await screen.findByText(
				'Ana Ruiz was removed from the team. Their profile stays in the directory.',
				NOTICE
			)
		).toBeVisible();
		expect( screen.getByText( 'Marek Nowak' ) ).toBeVisible();
	} );

	it( 'reports a failed change and keeps the team as it was', async () => {
		mockApi(
			team( [ ana ] ),
			jest.fn( () => Promise.reject( { message: 'Database error.' } ) )
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const remove = await screen.findByRole( 'button', {
			name: 'Remove Ana Ruiz from the team',
		} );
		await act( async () => fireEvent.click( remove ) );

		expect(
			await screen.findByText( 'Database error.', NOTICE )
		).toBeVisible();
		expect( screen.getByText( 'Ana Ruiz' ) ).toBeVisible();
	} );

	it( 'points to the directory when it is empty', async () => {
		apiFetch.mockImplementation( ( options ) =>
			Promise.resolve(
				'/fair-events/v1/team-members' === options.path
					? []
					: team( [] )
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		expect(
			await screen.findByText(
				'The team member directory is empty. Add people there first.'
			)
		).toBeVisible();
		expect(
			screen.queryByRole( 'combobox', { name: 'Add a team member' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'link', { name: 'Manage team members' } )
		).toBeVisible();
	} );

	it( 'shows a series date’s team read-only with a link to the series', async () => {
		apiFetch.mockResolvedValueOnce(
			team( [ ana ], { owner_event_date_id: 5, series_event_date_id: 5 } )
		);
		render( <EventTeamMembers eventDateId={ 9 } /> );

		const link = await screen.findByRole( 'link', {
			name: 'Manage the team on the series',
		} );
		expect( link.getAttribute( 'href' ) ).toContain( 'event_date_id=5' );
		const list = screen.getByRole( 'list' );
		expect( within( list ).getByText( 'Ana Ruiz' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: /Remove/ } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'combobox', { name: 'Add a team member' } )
		).not.toBeInTheDocument();
		// The directory is not loaded for a read-only date.
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );
} );
