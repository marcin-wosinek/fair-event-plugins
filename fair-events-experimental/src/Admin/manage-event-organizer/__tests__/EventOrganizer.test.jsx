/**
 * @jest-environment jsdom
 *
 * Tests for the organizer section of Manage Event's Event Details (#2305):
 * its registration with the host page (a Details section, no tab), loading,
 * the sitewide default, saving and resetting, a failed save that keeps the
 * choice, drafts kept across a tab switch, an unavailable saved organizer
 * and the read-only view on a series date.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import EventOrganizer from '../EventOrganizer.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );

const NORTH = '11111111-1111-4111-8111-111111111111';
const SOUTH = '22222222-2222-4222-8222-222222222222';

const organizers = [
	{ id: 'default', name: 'Acme Club', is_default: true },
	{ id: NORTH, name: 'North Club', is_default: false },
	{ id: SOUTH, name: 'South Club', is_default: false },
];

const response = ( overrides = {} ) => ( {
	organizer_id: 'default',
	effective_organizer_id: 'default',
	series_event_date_id: null,
	organizers,
	...overrides,
} );

// Notices are also announced in a live region, so match the visible
// notice only.
const noticeText = ( text ) =>
	screen.findByText( text, { selector: '.components-notice__content' } );

const renderTab = ( props = {} ) =>
	render( <EventOrganizer eventDateId={ 7 } { ...props } /> );

const select = () => screen.findByLabelText( 'Organizer' );

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'Organizer section registration', () => {
	it( 'adds an Event Details section and no tab', () => {
		const sections = applyFilters(
			'fairEvents.manageEvent.detailsSections',
			[],
			{ eventDateId: 7 }
		);
		expect( sections.map( ( s ) => s.name ) ).toEqual( [ 'organizer' ] );

		const tabs = applyFilters( 'fairEvents.manageEvent.tabs', [], {
			eventDateId: 7,
		} );
		expect( tabs ).toEqual( [] );
	} );

	it( 'renders the section for the event date', async () => {
		apiFetch.mockResolvedValueOnce( response() );
		const [ section ] = applyFilters(
			'fairEvents.manageEvent.detailsSections',
			[],
			{ eventDateId: 7 }
		);
		render( section.render() );

		expect( await select() ).toHaveValue( 'default' );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/organizer',
		} );
	} );
} );

describe( 'EventOrganizer', () => {
	it( 'shows a spinner while loading, then the sitewide default', async () => {
		apiFetch.mockResolvedValueOnce( response() );
		const { container } = renderTab();

		expect( container.querySelector( '.components-spinner' ) ).toBeTruthy();
		expect( await select() ).toHaveValue( 'default' );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates/7/organizer',
		} );
		expect(
			screen.getByRole( 'option', {
				name: 'Sitewide default (Acme Club)',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'option', { name: 'North Club' } )
		).toBeInTheDocument();
	} );

	it( 'labels an unnamed sitewide organizer', async () => {
		apiFetch.mockResolvedValueOnce(
			response( {
				organizers: [ { id: 'default', name: '', is_default: true } ],
			} )
		);
		renderTab();

		expect(
			await screen.findByRole( 'option', { name: 'Sitewide default' } )
		).toBeInTheDocument();
	} );

	it( 'saves the chosen organizer and reloads the normalized selection', async () => {
		apiFetch.mockResolvedValueOnce( response() ).mockResolvedValueOnce(
			response( {
				organizer_id: NORTH,
				effective_organizer_id: NORTH,
			} )
		);
		const setTabDirty = jest.fn();
		renderTab( { setTabDirty } );

		fireEvent.change( await select(), { target: { value: NORTH } } );
		expect( setTabDirty ).toHaveBeenLastCalledWith(
			'event-details/organizer',
			true
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save organizer' } )
		);

		expect( await noticeText( 'Organizer saved.' ) ).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/fair-events/v1/event-dates/7/organizer',
			method: 'PUT',
			data: { organizer_id: NORTH },
		} );
		expect( screen.getByLabelText( 'Organizer' ) ).toHaveValue( NORTH );
		expect( setTabDirty ).toHaveBeenLastCalledWith(
			'event-details/organizer',
			false
		);
	} );

	it( 'resets an assignment to the sitewide default', async () => {
		apiFetch
			.mockResolvedValueOnce(
				response( {
					organizer_id: SOUTH,
					effective_organizer_id: SOUTH,
				} )
			)
			.mockResolvedValueOnce( response() );
		renderTab();

		fireEvent.change( await select(), { target: { value: 'default' } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save organizer' } )
		);

		expect(
			await noticeText(
				'Organizer saved. This event uses the sitewide organizer.'
			)
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenLastCalledWith(
			expect.objectContaining( { data: { organizer_id: 'default' } } )
		);
	} );

	it( 'keeps the choice and shows the server message when saving fails', async () => {
		apiFetch.mockResolvedValueOnce( response() ).mockRejectedValueOnce( {
			message:
				'Choose the sitewide organizer or one of the organizers in the list.',
		} );
		const setTabDirty = jest.fn();
		renderTab( { setTabDirty } );

		fireEvent.change( await select(), { target: { value: SOUTH } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save organizer' } )
		);

		expect(
			await noticeText(
				'Choose the sitewide organizer or one of the organizers in the list.'
			)
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Organizer' ) ).toHaveValue( SOUTH );
		expect( setTabDirty ).toHaveBeenLastCalledWith(
			'event-details/organizer',
			true
		);
		expect(
			screen.getByRole( 'button', { name: 'Save organizer' } )
		).toBeEnabled();
	} );

	it( 'shows a fallback message when saving fails without one', async () => {
		apiFetch
			.mockResolvedValueOnce( response() )
			.mockRejectedValueOnce( {} );
		renderTab();

		fireEvent.change( await select(), { target: { value: NORTH } } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save organizer' } )
		);

		expect(
			await noticeText( 'The organizer could not be saved. Try again.' )
		).toBeInTheDocument();
	} );

	it( 'parks an unsaved choice and restores it when the tab opens again', async () => {
		apiFetch.mockResolvedValue( response() );
		const drafts = {};
		const setTabDraft = jest.fn( ( name, draft ) => {
			drafts[ name ] = draft;
		} );
		const getTabDraft = ( name ) => drafts[ name ];

		const { unmount } = renderTab( { setTabDraft, getTabDraft } );
		fireEvent.change( await select(), { target: { value: NORTH } } );
		expect( drafts[ 'event-details/organizer' ] ).toEqual( {
			selected: NORTH,
		} );
		unmount();

		renderTab( { setTabDraft, getTabDraft } );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Organizer' ) ).toHaveValue( NORTH )
		);
	} );

	it( 'reports a load failure and retries', async () => {
		apiFetch
			.mockRejectedValueOnce( { message: 'Event date not found.' } )
			.mockResolvedValueOnce( response() );
		renderTab();

		expect(
			await noticeText( 'Event date not found.' )
		).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		expect( await select() ).toHaveValue( 'default' );
	} );

	it( 'explains an unavailable saved organizer', async () => {
		const missing = '33333333-3333-4333-8333-333333333333';
		apiFetch.mockResolvedValueOnce( response( { organizer_id: missing } ) );
		renderTab();

		expect(
			await noticeText(
				'The organizer chosen for this event is no longer available, so the sitewide organizer is shown publicly. Choose another organizer to replace it.'
			)
		).toBeInTheDocument();
		expect( screen.getByLabelText( 'Organizer' ) ).toHaveValue( missing );
	} );

	it( 'shows the series organizer read-only on a series date', async () => {
		apiFetch.mockResolvedValueOnce(
			response( {
				organizer_id: NORTH,
				effective_organizer_id: NORTH,
				series_event_date_id: 5,
			} )
		);
		const setTabDirty = jest.fn();
		renderTab( { setTabDirty } );

		expect(
			await screen.findByText( 'Organizer: North Club' )
		).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Organizer' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Save organizer' } )
		).toBeNull();

		const link = screen.getByRole( 'link', {
			name: 'Choose the organizer on the series',
		} );
		const url = new URL( link.getAttribute( 'href' ) );
		expect( url.searchParams.get( 'event_date_id' ) ).toBe( '5' );
		// Opens the series on Event Details, where the organizer is.
		expect( url.searchParams.has( 'tab' ) ).toBe( false );
		expect( setTabDirty ).toHaveBeenLastCalledWith(
			'event-details/organizer',
			false
		);
	} );
} );
