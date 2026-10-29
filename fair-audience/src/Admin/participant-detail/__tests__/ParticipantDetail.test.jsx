/**
 * @jest-environment jsdom
 *
 * Component test for the Participant Detail page (#1167): the mobile layout
 * fix relies on the root carrying `wrap fair-audience-participant-detail`
 * and the activity tables carrying `fair-audience-participant-detail__table`
 * so the scoped stylesheet actually applies — pin that class contract, plus
 * that the Profile rows and both activity tables render, so a future
 * refactor can't silently break the selector the CSS depends on.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	within,
	waitFor,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ParticipantDetail from '../ParticipantDetail.js';

jest.mock( '@wordpress/api-fetch' );

const PARTICIPANT = {
	id: 144,
	name: 'Jane',
	surname: 'Doe',
	email: 'jane@example.com',
	status: 'confirmed',
	email_profile: 'marketing',
	weekly_summary_opt_out: false,
	phone: '',
	instagram: '',
	wp_user: null,
	created_at: '2026-01-15 10:00:00',
};

const ACTIVITY = {
	events: [
		{
			id: 1,
			event_date_id: 5,
			event_title: 'Spring Meetup',
			start_date: '2026-03-01',
			start_time: '18:00:00',
			label: 'signed_up',
			created_at: '2026-01-15 10:00:00',
			transaction_id: 0,
			transaction_status: null,
		},
	],
	submissions: [
		{
			id: 9,
			title: 'Signup form',
			page_title: 'Signup',
			event_title: 'Spring Meetup',
			created_at: '2026-01-15 10:00:00',
		},
	],
};

beforeEach( () => {
	window.history.pushState(
		{},
		'',
		'/wp-admin/admin.php?page=fair-audience-participant-detail&participant_id=144'
	);
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path.endsWith( '/activity' ) ) {
			return Promise.resolve( ACTIVITY );
		}
		return Promise.resolve( PARTICIPANT );
	} );
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'ParticipantDetail', () => {
	it( 'renders the root with the wrap and page classes, and both activity tables', async () => {
		const { container } = render( <ParticipantDetail /> );

		await screen.findAllByText( 'Jane Doe' );

		const root = container.querySelector(
			'.wrap.fair-audience-participant-detail'
		);
		expect( root ).toBeInTheDocument();

		const tables = container.querySelectorAll(
			'.fair-audience-participant-detail__table'
		);
		expect( tables ).toHaveLength( 2 );

		const cards = container.querySelectorAll(
			'.fair-audience-participant-detail__card'
		);
		expect( cards ).toHaveLength( 3 );

		expect(
			container.querySelector( '.fair-audience-participant-detail__back' )
		).toBeInTheDocument();

		expect( screen.getByText( 'jane@example.com' ) ).toBeInTheDocument();
		expect( screen.getAllByText( 'Spring Meetup' ).length ).toBeGreaterThan(
			0
		);
		expect( screen.getByText( 'Signup form' ) ).toBeInTheDocument();
	} );
} );

describe( 'ParticipantDetail — delete participant (#1775)', () => {
	const openDelete = async () => {
		render( <ParticipantDetail /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Delete participant' } )
		);
		return screen.findByRole( 'dialog', {
			name: 'Delete participant — Jane Doe',
		} );
	};

	const deletions = () =>
		apiFetch.mock.calls.filter(
			( [ request ] ) => request.method === 'DELETE'
		);

	beforeEach( () => {
		jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		jest.spyOn( window, 'confirm' ).mockImplementation( () => true );
		jest.spyOn( window, 'alert' ).mockImplementation( () => {} );
	} );

	it( 'confirms in the same popup as the participants list, not in the browser', async () => {
		const dialog = await openDelete();

		expect( window.confirm ).not.toHaveBeenCalled();
		expect( dialog ).toHaveTextContent(
			'Permanently delete the participant profile of Jane Doe?'
		);
		expect( dialog ).toHaveTextContent(
			'Deleting a profile does not cancel tickets, delete event registrations or refund payments.'
		);

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);
		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( deletions() ).toHaveLength( 0 );
	} );

	it( 'shows a failed deletion in the popup and allows a retry', async () => {
		let fails = true;
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( method === 'DELETE' ) {
				return fails
					? Promise.reject( {
							message: 'Failed to delete participant.',
						} )
					: Promise.resolve( {} );
			}
			return Promise.resolve(
				path.endsWith( '/activity' ) ? ACTIVITY : PARTICIPANT
			);
		} );
		const dialog = await openDelete();

		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete participant',
			} )
		);

		await waitFor( () =>
			expect( dialog ).toHaveTextContent(
				'Failed to delete participant.'
			)
		);
		expect( window.alert ).not.toHaveBeenCalled();

		fails = false;
		fireEvent.click(
			within( dialog ).getByRole( 'button', {
				name: 'Delete participant',
			} )
		);

		await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
		expect( deletions().map( ( [ request ] ) => request.path ) ).toEqual( [
			'/fair-audience/v1/participants/144',
			'/fair-audience/v1/participants/144',
		] );
		// The page leaves for the list; jsdom reports the navigation it
		// cannot perform as an error.
		expect( console ).toHaveErrored();
		expect( console.error ).toHaveBeenCalledWith(
			expect.objectContaining( {
				message: expect.stringContaining(
					'Not implemented: navigation'
				),
			} )
		);
	} );

	it( 'links back to the participants list', async () => {
		render( <ParticipantDetail /> );

		expect(
			await screen.findByRole( 'link', { name: /All participants/ } )
		).toHaveAttribute( 'href', 'admin.php?page=fair-audience' );
	} );
} );

describe( 'ParticipantDetail — weekly event feeds (#2125)', () => {
	const renderWith = async ( overrides ) => {
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				path.endsWith( '/activity' )
					? ACTIVITY
					: { ...PARTICIPANT, ...overrides }
			)
		);
		render( <ParticipantDetail /> );
		const header = await screen.findByText( 'Event feeds' );
		return header.closest( 'tr' ).querySelector( 'td' );
	};

	const AVAILABLE = {
		available: true,
		selected: [],
		unavailable: [],
		deleted: 0,
	};

	it( 'shows all feeds as a continuing preference without listing names', async () => {
		const cell = await renderWith( {
			weekly_feed_mode: 'all',
			weekly_feed_ids: [ 1 ],
			weekly_feed_summary: AVAILABLE,
		} );

		expect( cell ).toHaveTextContent( 'All event feeds' );
		expect( cell ).toHaveTextContent( 'Includes event feeds added later.' );
		expect( within( cell ).queryByRole( 'list' ) ).not.toBeInTheDocument();
	} );

	it( 'lists selected feeds by name, marking unavailable and deleted ones', async () => {
		const longName =
			'Community workshops, talks and open studio evenings in the old town';
		const cell = await renderWith( {
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ 1, 3, 42 ],
			weekly_feed_summary: {
				available: true,
				selected: [ { id: 1, name: longName } ],
				unavailable: [ { id: 3, name: 'Archive' } ],
				deleted: 1,
			},
		} );

		expect( cell ).toHaveTextContent( 'Selected event feeds' );
		const items = within( cell )
			.getAllByRole( 'listitem' )
			.map( ( item ) => item.textContent );
		expect( items ).toEqual( [
			longName,
			'Archive (not available right now)',
		] );
		expect( cell ).toHaveTextContent( '1 selected feed was deleted.' );
	} );

	it( 'shows no feeds only when none are stored', async () => {
		const cell = await renderWith( {
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [],
			weekly_feed_summary: AVAILABLE,
		} );

		expect( cell ).toHaveTextContent( 'No event feeds' );
	} );

	it( 'keeps the selection count when feed names cannot be retrieved', async () => {
		const cell = await renderWith( {
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ 1, 2 ],
			weekly_feed_summary: { ...AVAILABLE, available: false },
		} );

		expect( cell ).toHaveTextContent( 'Selected event feeds' );
		expect( cell ).toHaveTextContent(
			'2 feeds are selected, but feed names cannot be retrieved right now.'
		);
		expect( cell ).not.toHaveTextContent( 'No event feeds' );
		expect( cell ).not.toHaveTextContent( 'deleted' );
	} );

	it( 'keeps the weekly opt-out visible next to the saved feeds', async () => {
		const cell = await renderWith( {
			weekly_summary_opt_out: true,
			weekly_feed_mode: 'selected',
			weekly_feed_ids: [ 1 ],
			weekly_feed_summary: {
				...AVAILABLE,
				selected: [ { id: 1, name: 'Workshops' } ],
			},
		} );

		expect( screen.getByText( 'Opted out' ) ).toBeInTheDocument();
		expect( cell ).toHaveTextContent(
			'Saved preference only: this participant opted out of weekly summaries.'
		);
	} );

	it( 'does not imply delivery without marketing consent', async () => {
		const cell = await renderWith( {
			email_profile: 'minimal',
			weekly_feed_mode: 'all',
			weekly_feed_summary: AVAILABLE,
		} );

		expect( cell ).toHaveTextContent(
			'Saved preference only: weekly summaries go to confirmed participants with the Marketing email profile.'
		);
	} );

	it( 'mentions no delivery caveat for a confirmed marketing subscriber', async () => {
		const cell = await renderWith( {
			weekly_feed_mode: 'all',
			weekly_feed_summary: AVAILABLE,
		} );

		expect( cell ).not.toHaveTextContent( 'Saved preference only' );
	} );
} );
