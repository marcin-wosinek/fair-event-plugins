/**
 * @jest-environment jsdom
 *
 * Tests for the team members section of Manage Event's Event Details
 * (#2394, #2422): its registration, adding a person with a role, a second
 * role for the same person, a refused duplicate or invalid role, ordering,
 * removing one assignment (with or without a role), a failed change, an
 * empty directory, and the read-only view on a series date with its links
 * to the series and its schedule.
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
const bea = { id: 2, name: 'Bea', surname: 'Nowak' };

const assignment = ( id, member, role ) => ( {
	id,
	member_id: member.id,
	name: member.name,
	surname: member.surname,
	role,
} );

const team = ( assignments, overrides = {} ) => ( {
	owner_event_date_id: 7,
	series_event_date_id: null,
	members: [],
	assignments,
	...overrides,
} );

const directory = [
	{ ...ana, email: 'ana@example.com' },
	{ ...bea, email: '' },
];

/** Route GETs to the team, the directory and the programme; writes to `writes`. */
function mockApi( initialTeam, writes = jest.fn(), programme = { items: [] } ) {
	apiFetch.mockImplementation( ( options ) => {
		if ( options.method ) {
			return writes( options );
		}
		if ( '/fair-events/v1/team-members' === options.path ) {
			return Promise.resolve( directory );
		}
		if ( options.path.endsWith( '/schedule-contributors' ) ) {
			return Promise.resolve( programme );
		}
		return Promise.resolve( initialTeam );
	} );
	return writes;
}

/** Pick a person in the add form and type a role. */
async function fillAddForm( name, role ) {
	const picker = await screen.findByRole( 'combobox', {
		name: 'Add a team member',
	} );
	fireEvent.focus( picker );
	const option = await screen.findByRole( 'option', { name } );
	await act( async () => fireEvent.click( option ) );
	fireEvent.change( screen.getByRole( 'combobox', { name: 'Role' } ), {
		target: { value: role },
	} );
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
	it( 'adds a person with a role at the end of the list', async () => {
		const writes = mockApi(
			team( [ assignment( 10, ana, 'teacher' ) ] ),
			jest.fn( () =>
				Promise.resolve(
					team( [
						assignment( 10, ana, 'teacher' ),
						assignment( 11, bea, 'organizer' ),
					] )
				)
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		await fillAddForm( 'Bea Nowak', 'organizer' );
		await act( async () =>
			fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) )
		);

		expect( writes ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-assignments',
			method: 'POST',
			data: { member_id: 2, role: 'organizer' },
		} );
		expect(
			await screen.findByText(
				'Bea Nowak (organizer) was added.',
				NOTICE
			)
		).toBeVisible();
		const items = within( screen.getByRole( 'list' ) ).getAllByRole(
			'listitem'
		);
		expect( items.map( ( item ) => item.textContent ) ).toEqual( [
			expect.stringContaining( 'Ana Ruiz' ),
			expect.stringContaining( 'Bea Nowak' ),
		] );
	} );

	it( 'accepts a second role for the same person and refuses a repeated one', async () => {
		const writes = mockApi(
			team( [ assignment( 10, ana, 'teacher' ) ] ),
			jest.fn( () =>
				Promise.resolve(
					team( [
						assignment( 10, ana, 'teacher' ),
						assignment( 11, ana, 'organizer' ),
					] )
				)
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		await fillAddForm( 'Ana Ruiz', 'teacher' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		expect(
			screen.getByText(
				'Ana Ruiz is already teacher here. Choose another role or person.'
			)
		).toBeVisible();
		expect( writes ).not.toHaveBeenCalled();

		fireEvent.change( screen.getByRole( 'combobox', { name: 'Role' } ), {
			target: { value: 'organizer' },
		} );
		await act( async () =>
			fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) )
		);
		expect( writes ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: { member_id: 1, role: 'organizer' },
			} )
		);
		expect(
			await screen.findByRole( 'button', {
				name: 'Remove Ana Ruiz (organizer)',
			} )
		).toBeVisible();
		expect(
			screen.getByRole( 'button', { name: 'Remove Ana Ruiz (teacher)' } )
		).toBeVisible();
	} );

	it( 'refuses a role that is not a lowercase slug', async () => {
		const writes = mockApi( team( [] ) );
		render( <EventTeamMembers eventDateId={ 7 } /> );

		await fillAddForm( 'Ana Ruiz', 'Lead Teacher' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			/lowercase letters, digits, hyphens or underscores/
		);
		expect( writes ).not.toHaveBeenCalled();
	} );

	it( 'moves an assignment down with the full current order', async () => {
		const writes = mockApi(
			team( [
				assignment( 10, ana, 'teacher' ),
				assignment( 11, bea, 'teacher' ),
			] ),
			jest.fn( () =>
				Promise.resolve(
					team( [
						assignment( 11, bea, 'teacher' ),
						assignment( 10, ana, 'teacher' ),
					] )
				)
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const up = await screen.findByRole( 'button', {
			name: 'Move Ana Ruiz (teacher) up',
		} );
		expect( up ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByRole( 'button', {
				name: 'Move Bea Nowak (teacher) down',
			} )
		).toHaveAttribute( 'aria-disabled', 'true' );

		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Move Ana Ruiz (teacher) down',
				} )
			)
		);

		expect( writes ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-assignments/order',
			method: 'PUT',
			data: { assignment_ids: [ 11, 10 ] },
		} );
		expect(
			await screen.findByText(
				'Ana Ruiz (teacher) is now number 2.',
				NOTICE
			)
		).toBeVisible();
		const items = within( screen.getByRole( 'list' ) ).getAllByRole(
			'listitem'
		);
		expect( items[ 0 ] ).toHaveTextContent( 'Bea Nowak' );
	} );

	it( 'reloads the list when the order changed meanwhile', async () => {
		mockApi(
			team( [
				assignment( 10, ana, 'teacher' ),
				assignment( 11, bea, 'teacher' ),
			] ),
			jest.fn( () =>
				Promise.reject( {
					code: 'rest_team_order_stale',
					message: 'This list changed meanwhile.',
				} )
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const down = await screen.findByRole( 'button', {
			name: 'Move Ana Ruiz (teacher) down',
		} );
		const reads = apiFetch.mock.calls.length;
		await act( async () => fireEvent.click( down ) );

		expect(
			await screen.findByText( 'This list changed meanwhile.', NOTICE )
		).toBeVisible();
		expect( apiFetch.mock.calls.length ).toBeGreaterThan( reads + 1 );
	} );

	it( 'removes one assignment by its ID, or a role-less membership by member', async () => {
		const writes = mockApi(
			team( [
				assignment( 10, ana, null ),
				assignment( 11, ana, 'teacher' ),
			] ),
			jest.fn( ( options ) =>
				Promise.resolve(
					options.path.includes( 'team-assignments' )
						? team( [ assignment( 10, ana, null ) ] )
						: team( [] )
				)
			)
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		expect(
			await screen.findByText( 'No role — not included in campaigns' )
		).toBeVisible();

		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', {
					name: 'Remove Ana Ruiz (teacher)',
				} )
			)
		);
		expect( writes ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-assignments/11',
			method: 'DELETE',
		} );
		expect(
			await screen.findByText(
				'Ana Ruiz (teacher) was removed. Their profile and other assignments stay as they are.',
				NOTICE
			)
		).toBeVisible();

		await act( async () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Remove Ana Ruiz' } )
			)
		);
		expect( writes ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/event-dates/7/team-members/1',
			method: 'DELETE',
		} );
	} );

	it( 'reports a failed change and keeps the team as it was', async () => {
		mockApi(
			team( [ assignment( 10, ana, 'teacher' ) ] ),
			jest.fn( () => Promise.reject( { message: 'Database error.' } ) )
		);
		render( <EventTeamMembers eventDateId={ 7 } /> );

		const remove = await screen.findByRole( 'button', {
			name: 'Remove Ana Ruiz (teacher)',
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

	it( 'says on a series that changes apply to every date', async () => {
		mockApi( team( [ assignment( 10, ana, 'teacher' ) ] ) );
		render( <EventTeamMembers eventDateId={ 7 } isSeries /> );

		expect(
			await screen.findByText(
				'People with a role are listed in campaigns in this order. Changes apply to every date of the series, past dates included.'
			)
		).toBeVisible();
	} );

	it( 'shows a series date’s team and programme read-only, with links to where they are managed', async () => {
		mockApi(
			team(
				[
					assignment( 10, ana, 'organizer' ),
					assignment( 11, bea, 'teacher' ),
				],
				{ owner_event_date_id: 5, series_event_date_id: 5 }
			),
			jest.fn(),
			{
				items: [
					{
						schedule_item_id: 3,
						title: 'Salsa workshop',
						assignments: [ assignment( 20, bea, 'teacher' ) ],
					},
					{ schedule_item_id: 4, title: 'Break', assignments: [] },
				],
			}
		);
		render( <EventTeamMembers eventDateId={ 9 } /> );

		const link = await screen.findByRole( 'link', {
			name: 'Manage the team on the series',
		} );
		expect( link.getAttribute( 'href' ) ).toContain( 'event_date_id=5' );
		expect(
			screen.getByText( /They cannot be changed for this date alone\./ )
		).toBeVisible();
		const [ teamList ] = screen.getAllByRole( 'list' );
		expect(
			within( teamList )
				.getAllByRole( 'listitem' )
				.map( ( item ) => item.textContent )
		).toEqual( [
			expect.stringContaining( 'Ana Ruiz' ),
			expect.stringContaining( 'Bea Nowak' ),
		] );
		expect(
			screen.getByText( 'Salsa workshop: Bea Nowak (teacher)' )
		).toBeVisible();
		expect( screen.queryByText( /^Break:/ ) ).not.toBeInTheDocument();
		const schedule = screen.getByRole( 'link', {
			name: 'Manage programme contributors in the series’ schedule',
		} );
		expect( schedule.getAttribute( 'href' ) ).toContain( 'tab=schedule' );
		expect(
			screen.queryByRole( 'button', { name: /Remove|Move/ } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'combobox', { name: 'Add a team member' } )
		).not.toBeInTheDocument();
		// The directory is not loaded for a read-only date.
		expect(
			apiFetch.mock.calls.some(
				( [ options ] ) =>
					'/fair-events/v1/team-members' === options.path
			)
		).toBe( false );
	} );
} );
