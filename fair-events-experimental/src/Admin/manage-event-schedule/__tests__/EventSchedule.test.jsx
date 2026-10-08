/**
 * @jest-environment jsdom
 *
 * Tests for the Schedule tab of Manage Event (#1767): its registration with
 * the host page, editing entries, field errors, a failed save that keeps the
 * edits, the unsaved-change report, drafts kept across a tab switch and the
 * explanation for a workshop that cannot be marked Not bookable.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import EventSchedule from '../EventSchedule.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../schedule.css', () => ( {} ), { virtual: true } );

const eventDate = {
	id: 7,
	occurrence_type: 'single',
	link_type: 'post',
	start_datetime: '2027-05-15 09:00:00',
	end_datetime: '2027-05-16 18:00:00',
};

const savedSchedule = {
	schedule_enabled: true,
	read_only: false,
	items: [
		{
			id: 11,
			ticket_option_id: 101,
			bookable: true,
			title: 'Acro',
			start_datetime: '2027-05-15 10:00:00',
			end_datetime: '2027-05-15 11:30:00',
			description: 'Bring a partner.',
			location: 'Main hall',
		},
		{
			id: 12,
			ticket_option_id: null,
			bookable: false,
			title: 'Lunch break',
			start_datetime: '2027-05-15 13:00:00',
			end_datetime: '2027-05-15 14:00:00',
			description: '',
			location: '',
		},
	],
	warnings: [],
	options: [
		{ id: 101, name: 'Acro', scheduled: true },
		{ id: 102, name: 'Juggling', scheduled: false },
	],
};

const entry = ( name ) =>
	screen.getByRole( 'heading', { name } ).closest( '.components-card' );

// Error notices are also announced in a live region, so match the visible
// notice only.
const noticeText = ( text ) =>
	screen.findByText( text, { selector: '.components-notice__content' } );

const renderSchedule = ( props = {} ) =>
	render(
		<EventSchedule eventDateId={ 7 } eventDate={ eventDate } { ...props } />
	);

const lastSave = () =>
	apiFetch.mock.calls
		.map( ( [ options ] ) => options )
		.filter( ( options ) => options.method === 'PUT' )
		.pop();

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	apiFetch.mockImplementation( ( options ) =>
		Promise.resolve(
			options.method === 'PUT'
				? { ...savedSchedule, items: savedSchedule.items }
				: savedSchedule
		)
	);
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'tab registration', () => {
	const ctx = ( overrides = {} ) => ( {
		eventDate,
		eventDateId: 7,
		enabledFeatures: { ticketing: true },
		scheduleEnabled: true,
		...overrides,
	} );
	const scheduleTab = ( context ) =>
		applyFilters( 'fairEvents.manageEvent.tabs', [], context ).find(
			( tab ) => tab.name === 'schedule'
		);

	it( 'adds the tab right after Prices once the schedule is enabled', () => {
		expect( scheduleTab( ctx() ) ).toMatchObject( {
			title: 'Schedule',
			order: 22,
			isVisible: true,
			disabled: false,
		} );
	} );

	it( 'keeps the tab out until it is enabled, and without ticketing', () => {
		expect(
			scheduleTab( ctx( { scheduleEnabled: false } ) ).isVisible
		).toBe( false );
		// An older Fair Events never passes the setting.
		expect(
			scheduleTab( ctx( { scheduleEnabled: undefined } ) ).isVisible
		).toBe( false );
		expect( scheduleTab( ctx( { enabledFeatures: {} } ) ).isVisible ).toBe(
			false
		);
	} );

	it( 'is disabled where Prices is: dates of a series and link-only events', () => {
		expect(
			scheduleTab(
				ctx( {
					eventDate: { ...eventDate, occurrence_type: 'generated' },
				} )
			).disabled
		).toBe( true );
		expect(
			scheduleTab(
				ctx( { eventDate: { ...eventDate, link_type: 'external' } } )
			).disabled
		).toBe( true );
	} );
} );

describe( 'EventSchedule', () => {
	it( 'loads the saved entries into editable fields', async () => {
		renderSchedule();

		const acro = within( await waitFor( () => entry( 'Acro' ) ) );
		expect( acro.getByLabelText( 'Start date' ) ).toHaveValue(
			'2027-05-15'
		);
		expect( acro.getByLabelText( 'Start time' ) ).toHaveValue( '10:00' );
		expect( acro.getByLabelText( 'End time' ) ).toHaveValue( '11:30' );
		expect( acro.getByLabelText( 'Room or location' ) ).toHaveValue(
			'Main hall'
		);
		expect( acro.getByLabelText( 'Description' ) ).toHaveValue(
			'Bring a partner.'
		);
		expect( acro.getByLabelText( 'Booking' ) ).toHaveValue( 'bookable' );
		// A workshop's name comes from Prices, so it has no title field.
		expect( acro.queryByLabelText( 'Title' ) ).not.toBeInTheDocument();

		const lunch = within( entry( 'Lunch break' ) );
		expect( lunch.getByLabelText( 'Title' ) ).toHaveValue( 'Lunch break' );
		expect( lunch.getByLabelText( 'Booking' ) ).toHaveValue(
			'not-bookable'
		);
		expect( lunch.getByLabelText( 'Booking' ) ).toBeDisabled();
		expect(
			lunch.getByText( /A schedule item is never a ticket choice/ )
		).toBeInTheDocument();

		expect(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		).toBeDisabled();
		expect( screen.getByText( 'No unsaved changes.' ) ).toBeInTheDocument();
	} );

	it( 'sends the whole schedule on save and reports unsaved changes meanwhile', async () => {
		const setTabDirty = jest.fn();
		renderSchedule( { setTabDirty } );
		const acro = within( await waitFor( () => entry( 'Acro' ) ) );
		expect( setTabDirty ).toHaveBeenLastCalledWith( 'schedule', false );

		fireEvent.change( acro.getByLabelText( 'Room or location' ), {
			target: { value: 'Studio 2' },
		} );
		fireEvent.change( acro.getByLabelText( 'Booking' ), {
			target: { value: 'not-bookable' },
		} );
		expect( setTabDirty ).toHaveBeenLastCalledWith( 'schedule', true );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		);

		expect(
			await screen.findByText( 'Schedule saved.' )
		).toBeInTheDocument();
		expect( lastSave() ).toMatchObject( {
			path: '/fair-events/v1/event-dates/7/schedule',
			data: {
				items: [
					{
						id: 11,
						ticket_option_id: 101,
						bookable: false,
						title: '',
						start_datetime: '2027-05-15 10:00:00',
						end_datetime: '2027-05-15 11:30:00',
						location: 'Studio 2',
					},
					{
						id: 12,
						ticket_option_id: null,
						bookable: false,
						title: 'Lunch break',
					},
				],
			},
		} );
		expect( setTabDirty ).toHaveBeenLastCalledWith( 'schedule', false );
	} );

	it( 'adds a program item that starts with the event and a workshop from Prices', async () => {
		renderSchedule();
		await waitFor( () => entry( 'Acro' ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add schedule item' } )
		);
		const item = within( entry( '(untitled item)' ) );
		expect( item.getByLabelText( 'Start date' ) ).toHaveValue(
			'2027-05-15'
		);
		expect( item.getByLabelText( 'Start time' ) ).toHaveValue( '09:00' );
		expect( item.getByLabelText( 'End time' ) ).toHaveValue( '10:00' );

		// Only add-ons not on the schedule yet are offered.
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add a workshop from Prices' } )
		);
		expect(
			screen.queryByRole( 'menuitem', { name: 'Acro' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Juggling' } ) );

		const juggling = within( entry( 'Juggling' ) );
		expect( juggling.getByLabelText( 'Booking' ) ).toHaveValue(
			'bookable'
		);
		expect( juggling.getByLabelText( 'Booking' ) ).toBeEnabled();
	} );

	it( 'explains why no workshop can be added', async () => {
		apiFetch.mockResolvedValue( {
			...savedSchedule,
			items: [],
			options: [],
		} );
		renderSchedule();

		expect(
			await screen.findByText( /Nothing is scheduled yet/ )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Add workshop' } )
		).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( /Workshops come from the add-ons in Prices/ )
		).toBeInTheDocument();
	} );

	it( 'shows which entries run in parallel without treating it as an error', async () => {
		renderSchedule();
		const lunch = within( await waitFor( () => entry( 'Lunch break' ) ) );

		fireEvent.change( lunch.getByLabelText( 'Start time' ), {
			target: { value: '11:00' },
		} );

		expect(
			lunch.getByText( 'Runs at the same time as Acro (Main hall).' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		).toBeEnabled();
	} );

	it( 'marks an invalid time next to its field and does not send the save', async () => {
		renderSchedule();
		const acro = within( await waitFor( () => entry( 'Acro' ) ) );

		fireEvent.change( acro.getByLabelText( 'End time' ), {
			target: { value: '09:30' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		);

		expect(
			acro.getByText( 'The end must be after the start.' )
		).toBeInTheDocument();
		expect(
			await noticeText( /The schedule was not saved/ )
		).toBeInTheDocument();
		expect( lastSave() ).toBeUndefined();
		expect( acro.getByLabelText( 'End time' ) ).toHaveValue( '09:30' );

		// Fixing the field clears its message.
		fireEvent.change( acro.getByLabelText( 'End time' ), {
			target: { value: '12:00' },
		} );
		expect(
			acro.queryByText( 'The end must be after the start.' )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the edits and explains a blocked booking change when the save is refused', async () => {
		renderSchedule();
		const acro = within( await waitFor( () => entry( 'Acro' ) ) );
		const reason =
			'"Acro" is part of tickets or reservations already, so it cannot be marked Not bookable. Move or cancel those first.';

		fireEvent.change( acro.getByLabelText( 'Booking' ), {
			target: { value: 'not-bookable' },
		} );
		fireEvent.change( acro.getByLabelText( 'Description' ), {
			target: { value: 'Edited before the refusal.' },
		} );
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'PUT'
				? Promise.reject( {
						code: 'schedule_booking_locked',
						message: reason,
						data: {
							status: 409,
							errors: [
								{
									key: 'saved-11',
									id: 11,
									field: 'bookable',
									code: 'booking_has_dependents',
									message: reason,
								},
							],
						},
				  } )
				: Promise.resolve( savedSchedule )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		);

		expect( await noticeText( reason ) ).toBeInTheDocument();
		expect( acro.getByText( reason ) ).toBeInTheDocument();
		expect( acro.getByLabelText( 'Booking' ) ).toHaveValue(
			'not-bookable'
		);
		expect( acro.getByLabelText( 'Description' ) ).toHaveValue(
			'Edited before the refusal.'
		);
		expect(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		).toBeEnabled();
	} );

	it( 'keeps the edits when the request itself fails', async () => {
		renderSchedule();
		const lunch = within( await waitFor( () => entry( 'Lunch break' ) ) );

		fireEvent.change( lunch.getByLabelText( 'Title' ), {
			target: { value: 'Long lunch' },
		} );
		apiFetch.mockImplementation( ( options ) =>
			options.method === 'PUT'
				? Promise.reject( {} )
				: Promise.resolve( savedSchedule )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		);

		expect(
			await noticeText( /Your changes are still here/ )
		).toBeInTheDocument();
		expect(
			within( entry( 'Long lunch' ) ).getByLabelText( 'Title' )
		).toHaveValue( 'Long lunch' );
	} );

	it( 'asks before removing an entry and says when booking would reopen', async () => {
		apiFetch.mockResolvedValue( {
			...savedSchedule,
			items: [
				{ ...savedSchedule.items[ 0 ], bookable: false },
				savedSchedule.items[ 1 ],
			],
		} );
		renderSchedule();
		await waitFor( () => entry( 'Acro' ) );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Remove Acro' } )
		);
		const dialog = within( await screen.findByRole( 'dialog' ) );
		expect(
			dialog.getByText( /Once you save, it can be booked again/ )
		).toBeInTheDocument();

		fireEvent.click(
			dialog.getByRole( 'button', { name: 'Remove from schedule' } )
		);

		await waitFor( () =>
			expect(
				screen.queryByRole( 'heading', { name: 'Acro' } )
			).not.toBeInTheDocument()
		);
		expect(
			screen.getByRole( 'heading', { name: 'Lunch break' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		).toBeEnabled();
	} );

	it( 'parks unsaved edits with the host and restores them when the tab is opened again', async () => {
		const drafts = {};
		const draftProps = {
			getTabDraft: ( name ) => drafts[ name ],
			setTabDraft: ( name, draft ) => {
				if ( draft === undefined ) {
					delete drafts[ name ];
				} else {
					drafts[ name ] = draft;
				}
			},
		};
		const first = renderSchedule( draftProps );
		const acro = within( await waitFor( () => entry( 'Acro' ) ) );
		expect( drafts.schedule ).toBeUndefined();

		fireEvent.change( acro.getByLabelText( 'Room or location' ), {
			target: { value: 'Garden' },
		} );
		await waitFor( () => expect( drafts.schedule ).toBeDefined() );

		// Switching tabs unmounts the editor; coming back mounts a new one.
		first.unmount();
		renderSchedule( draftProps );

		const restored = within( await waitFor( () => entry( 'Acro' ) ) );
		await waitFor( () =>
			expect( restored.getByLabelText( 'Room or location' ) ).toHaveValue(
				'Garden'
			)
		);
		expect(
			screen.getByRole( 'button', { name: 'Save schedule' } )
		).toBeEnabled();
	} );

	it( 'shows a warning the server attached to an entry', async () => {
		apiFetch.mockResolvedValue( {
			...savedSchedule,
			warnings: [
				{ id: 12, message: "This entry is outside the event's dates." },
			],
		} );
		renderSchedule();

		const lunch = within( await waitFor( () => entry( 'Lunch break' ) ) );
		expect(
			lunch.getByText( "This entry is outside the event's dates." )
		).toBeInTheDocument();
	} );

	it( 'reports a failed load instead of an empty schedule', async () => {
		apiFetch.mockRejectedValue( { message: 'Event date not found.' } );
		renderSchedule();

		expect(
			await noticeText( 'Event date not found.' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save schedule' } )
		).not.toBeInTheDocument();
	} );
} );
