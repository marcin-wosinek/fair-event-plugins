/**
 * @jest-environment jsdom
 *
 * Tests for the Messages tab of Manage Event (#2126): loading and saving the
 * booking confirmation message, clearing it, a failed save that keeps the
 * edit, the unsaved-change report and draft kept across a tab switch, the
 * classic editor with link editing, series dates and link-only events.
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventMessages from '../EventMessages.js';

jest.mock( '@wordpress/api-fetch' );

const eventDate = { id: 7, occurrence_type: 'single', link_type: 'post' };
const PATH = '/fair-events/v1/event-dates/7/booking-message';

// Notices are also announced in a live region; match the visible one.
const noticeText = ( text ) =>
	screen.findByText( text, { selector: '.components-notice__content' } );

const renderTab = ( props = {} ) =>
	render(
		<EventMessages
			eventDateId={ 7 }
			eventDate={ eventDate }
			manageEventUrl="/wp-admin/admin.php?page=fair-events-manage-event"
			{ ...props }
		/>
	);

const editor = () => screen.findByLabelText( 'Message' );

const type = async ( value ) => {
	const field = await editor();
	await act( async () => {
		fireEvent.change( field, { target: { value } } );
	} );
};

const clickSave = async () => {
	await act( async () => {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save message' } )
		);
	} );
};

beforeEach( () => {
	apiFetch.mockReset();
	delete window.wp;
	delete window.tinymce;
} );

test( 'loads the saved message into the editor', async () => {
	apiFetch.mockResolvedValueOnce( {
		message: '<p>Bring shoes</p>',
		series_event_date_id: null,
	} );

	renderTab();

	expect( await editor() ).toHaveValue( '<p>Bring shoes</p>' );
	expect( apiFetch ).toHaveBeenCalledWith( { path: PATH } );
	expect(
		screen.getByText(
			/Saving does not email anyone who has already booked/
		)
	).toBeInTheDocument();
} );

test( 'saves the edit and shows the sanitized result', async () => {
	apiFetch
		.mockResolvedValueOnce( { message: '', series_event_date_id: null } )
		.mockResolvedValueOnce( {
			message: '<p>Hi <a href="https://example.com">map</a></p>',
			series_event_date_id: null,
		} );

	renderTab();
	await type(
		'<p onclick="x()">Hi <a href="https://example.com">map</a></p>'
	);
	await clickSave();

	expect( apiFetch ).toHaveBeenLastCalledWith( {
		path: PATH,
		method: 'PUT',
		data: {
			message:
				'<p onclick="x()">Hi <a href="https://example.com">map</a></p>',
		},
	} );
	expect(
		await noticeText(
			'Message saved. It will be added to confirmation emails for new bookings.'
		)
	).toBeInTheDocument();
	expect( await editor() ).toHaveValue(
		'<p>Hi <a href="https://example.com">map</a></p>'
	);
} );

test( 'clearing and saving removes the message', async () => {
	apiFetch
		.mockResolvedValueOnce( {
			message: '<p>Old</p>',
			series_event_date_id: null,
		} )
		.mockResolvedValueOnce( { message: '', series_event_date_id: null } );

	renderTab();
	await type( '' );
	await clickSave();

	expect( apiFetch ).toHaveBeenLastCalledWith(
		expect.objectContaining( { data: { message: '' } } )
	);
	expect(
		await noticeText(
			'Message removed. New bookings get the standard confirmation email.'
		)
	).toBeInTheDocument();
} );

test( 'a failed save keeps the edit and the tab dirty, and can be retried', async () => {
	const setTabDirty = jest.fn();
	apiFetch
		.mockResolvedValueOnce( { message: '', series_event_date_id: null } )
		.mockRejectedValueOnce( { message: 'Server says no.' } );

	renderTab( { setTabDirty } );
	await type( '<p>Draft</p>' );
	expect( setTabDirty ).toHaveBeenLastCalledWith( 'messages', true );

	await clickSave();

	expect( await noticeText( 'Server says no.' ) ).toBeInTheDocument();
	expect( await editor() ).toHaveValue( '<p>Draft</p>' );
	expect( setTabDirty ).toHaveBeenLastCalledWith( 'messages', true );
	expect(
		screen.getByRole( 'button', { name: 'Save message' } )
	).toBeEnabled();
} );

test( 'a load error offers a retry', async () => {
	apiFetch.mockRejectedValueOnce( {} ).mockResolvedValueOnce( {
		message: '<p>Ok</p>',
		series_event_date_id: null,
	} );

	renderTab();

	expect(
		await noticeText( 'The message could not be loaded.' )
	).toBeInTheDocument();
	await act( async () => {
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
	} );
	expect( await editor() ).toHaveValue( '<p>Ok</p>' );
} );

test( 'parks unsaved edits and restores them after a tab switch', async () => {
	const drafts = {};
	const setTabDraft = jest.fn( ( name, draft ) => {
		drafts[ name ] = draft;
	} );
	const getTabDraft = ( name ) => drafts[ name ];
	apiFetch.mockResolvedValue( {
		message: '<p>Saved</p>',
		series_event_date_id: null,
	} );

	const { unmount } = renderTab( { setTabDraft, getTabDraft } );
	await type( '<p>Unsaved</p>' );
	expect( drafts.messages ).toEqual( {
		value: '<p>Unsaved</p>',
		savedValue: '<p>Saved</p>',
	} );
	unmount();

	const setTabDirty = jest.fn();
	renderTab( { setTabDraft, getTabDraft, setTabDirty } );
	expect( await editor() ).toHaveValue( '<p>Unsaved</p>' );
	expect( setTabDirty ).toHaveBeenLastCalledWith( 'messages', true );
} );

test( 'mounts the classic editor with link editing and saves what it holds', async () => {
	let content = '';
	const fakeEditor = {
		isHidden: () => false,
		getContent: () => content,
		setContent: jest.fn( ( next ) => {
			content = next;
		} ),
		setMode: jest.fn(),
	};
	window.tinymce = { get: () => fakeEditor };
	window.wp = { editor: { initialize: jest.fn(), remove: jest.fn() } };
	apiFetch
		.mockResolvedValueOnce( { message: '', series_event_date_id: null } )
		.mockResolvedValueOnce( {
			message: '<p><a href="https://example.com">Link</a></p>',
			series_event_date_id: null,
		} );

	const { unmount } = renderTab();
	await editor();

	expect( window.wp.editor.initialize ).toHaveBeenCalledWith(
		'fair-events-booking-message-7',
		expect.objectContaining( {
			quicktags: true,
			mediaButtons: false,
			tinymce: expect.objectContaining( {
				plugins: 'lists,link',
				toolbar1: expect.stringContaining( 'link' ),
			} ),
		} )
	);

	// Content changed in the visual editor without a React event.
	content = '<p><a href="https://example.com">Link</a></p>';
	await clickSave();

	expect( apiFetch ).toHaveBeenLastCalledWith(
		expect.objectContaining( {
			data: { message: '<p><a href="https://example.com">Link</a></p>' },
		} )
	);

	unmount();
	expect( window.wp.editor.remove ).toHaveBeenCalledWith(
		'fair-events-booking-message-7'
	);
} );

test( 'a series date shows the series message read-only with a link to the series', async () => {
	apiFetch.mockResolvedValueOnce( {
		message: '<p>Series note</p>',
		series_event_date_id: 3,
	} );

	renderTab( {
		eventDate: { ...eventDate, occurrence_type: 'generated', master_id: 3 },
	} );

	expect( await screen.findByText( 'Series note' ) ).toBeInTheDocument();
	expect( screen.queryByLabelText( 'Message' ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Save message' } )
	).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'link', { name: 'Edit the message on the series' } )
	).toHaveAttribute(
		'href',
		'/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=3&tab=messages'
	);
} );

test( 'a link-only event explains there is nothing to edit', async () => {
	renderTab( { eventDate: { ...eventDate, link_type: 'external' } } );

	expect(
		await noticeText(
			'This event links to a page elsewhere, so bookings are not made here and there is no confirmation email to add a message to.'
		)
	).toBeInTheDocument();
	expect( apiFetch ).not.toHaveBeenCalled();
} );
