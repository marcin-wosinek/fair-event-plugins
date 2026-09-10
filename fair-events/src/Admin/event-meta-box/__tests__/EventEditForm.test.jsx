/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventEditForm from '../EventEditForm.js';

jest.mock( '@wordpress/api-fetch' );

jest.mock( '../store.js', () => ( { STORE_NAME: 'fair-events/event-data' } ) );

jest.mock( '@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{
			useDispatch: () => ( { setEventData: jest.fn() } ),
			useSelect: () => ( {} ),
		},
		{
			get( target, prop ) {
				if ( prop in target ) return target[ prop ];
				return stub;
			},
		}
	);
} );

const eventDate = {
	id: 42,
	start_datetime: '2026-06-10 10:00:00',
	end_datetime: '2026-06-10 11:00:00',
	all_day: false,
	venue_id: null,
	rrule: null,
};

const createDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );

	return { promise, resolve, reject };
};

beforeEach( () => {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/fair-events/v1/venues' ) {
			return Promise.resolve( [] );
		}
		if ( path.startsWith( '/fair-events/v1/event-dates/' ) && ! method ) {
			return Promise.resolve( eventDate );
		}
		return Promise.resolve( {} );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

const renderForm = async ( props = {} ) => {
	render(
		<EventEditForm
			eventDateId={ 42 }
			manageEventUrl="/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42"
			postId={ 1 }
			postType="post"
			{ ...props }
		/>
	);
	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: 'Save Event' } )
		).toBeInTheDocument()
	);
};

const getSaveActions = () =>
	document.querySelector( '.fair-events-event-save-actions' );

describe( 'EventEditForm secondary actions', () => {
	it( 'renders Edit Full Details and Unlink when onUnlink is provided', async () => {
		await renderForm( { onUnlink: jest.fn(), unlinking: false } );
		expect(
			screen.getByRole( 'link', { name: 'Edit Full Details' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Unlink from event' } )
		).toBeInTheDocument();
	} );

	it( 'hides Unlink when onUnlink is not provided (fair_event post)', async () => {
		await renderForm( {
			postType: 'fair_event',
			onUnlink: undefined,
		} );
		expect(
			screen.getByRole( 'link', { name: 'Edit Full Details' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Unlink from event' } )
		).not.toBeInTheDocument();
	} );

	it( 'calls onUnlink when Unlink is clicked', async () => {
		const onUnlink = jest.fn();
		await renderForm( { onUnlink, unlinking: false } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Unlink from event' } )
		);
		expect( onUnlink ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables Save and Unlink while unlinking is in flight', async () => {
		await renderForm( { onUnlink: jest.fn(), unlinking: true } );
		expect(
			screen.getByRole( 'button', { name: 'Save Event' } )
		).toBeDisabled();
		expect(
			screen.getByRole( 'button', { name: 'Unlink from event' } )
		).toBeDisabled();
	} );
} );

describe( 'EventEditForm save feedback', () => {
	it( 'keeps the save button busy and disabled while saving', async () => {
		const request = createDeferred();
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/fair-events/v1/venues' )
				return Promise.resolve( [] );
			if ( ! method ) return Promise.resolve( eventDate );
			return request.promise;
		} );
		await renderForm();

		const saveButton = screen.getByRole( 'button', { name: 'Save Event' } );
		fireEvent.click( saveButton );

		expect( saveButton ).toBeDisabled();
		expect( saveButton ).toHaveClass( 'is-busy' );
		request.resolve( eventDate );
		await within( getSaveActions() ).findByText( 'Event saved.' );
	} );

	it( 'shows successful feedback in the save action area', async () => {
		await renderForm();
		fireEvent.click( screen.getByRole( 'button', { name: 'Save Event' } ) );

		await waitFor( () =>
			expect(
				getSaveActions().querySelector(
					'.components-notice.is-success'
				)
			).toHaveTextContent( 'Event saved.' )
		);
		expect( getSaveActions() ).toContainElement(
			screen.getByRole( 'button', { name: 'Save Event' } )
		);
	} );

	it( 'shows failed feedback without a success notice', async () => {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/fair-events/v1/venues' )
				return Promise.resolve( [] );
			if ( ! method ) return Promise.resolve( eventDate );
			return Promise.reject(
				new Error( 'Save could not be completed.' )
			);
		} );
		await renderForm();
		fireEvent.click( screen.getByRole( 'button', { name: 'Save Event' } ) );

		await waitFor( () =>
			expect(
				getSaveActions().querySelector( '.components-notice.is-error' )
			).toHaveTextContent( 'Save could not be completed.' )
		);
		expect(
			within( getSaveActions() ).queryByText( 'Event saved.' )
		).not.toBeInTheDocument();
	} );

	it.each( [
		[ 'success', null ],
		[ 'error', new Error( 'Save could not be completed.' ) ],
	] )( 'clears %s feedback after a field edit', async ( state, failure ) => {
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/fair-events/v1/venues' )
				return Promise.resolve( [] );
			if ( ! method ) return Promise.resolve( eventDate );
			return failure
				? Promise.reject( failure )
				: Promise.resolve( eventDate );
		} );
		await renderForm();
		fireEvent.click( screen.getByRole( 'button', { name: 'Save Event' } ) );
		const feedback = failure
			? 'Save could not be completed.'
			: 'Event saved.';
		await within( getSaveActions() ).findByText( feedback );

		fireEvent.change( screen.getByRole( 'textbox', { name: 'Address' } ), {
			target: { value: 'New address' },
		} );

		expect(
			within( getSaveActions() ).queryByText( feedback )
		).not.toBeInTheDocument();
	} );

	it( 'clears earlier feedback when a new save starts', async () => {
		const secondRequest = createDeferred();
		let saveCount = 0;
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/fair-events/v1/venues' )
				return Promise.resolve( [] );
			if ( ! method ) return Promise.resolve( eventDate );
			saveCount += 1;
			return saveCount === 1
				? Promise.resolve( eventDate )
				: secondRequest.promise;
		} );
		await renderForm();
		const saveButton = screen.getByRole( 'button', { name: 'Save Event' } );
		fireEvent.click( saveButton );
		await within( getSaveActions() ).findByText( 'Event saved.' );

		fireEvent.click( saveButton );

		expect(
			within( getSaveActions() ).queryByText( 'Event saved.' )
		).not.toBeInTheDocument();
		secondRequest.resolve( eventDate );
		await within( getSaveActions() ).findByText( 'Event saved.' );
	} );

	it( 'does not show stale success after an edit made while saving', async () => {
		const request = createDeferred();
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( path === '/fair-events/v1/venues' )
				return Promise.resolve( [] );
			if ( ! method ) return Promise.resolve( eventDate );
			return request.promise;
		} );
		await renderForm();
		const saveButton = screen.getByRole( 'button', { name: 'Save Event' } );
		fireEvent.click( saveButton );
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Address' } ), {
			target: { value: 'Edited while saving' },
		} );

		request.resolve( eventDate );
		await waitFor( () => expect( saveButton ).not.toBeDisabled() );
		expect(
			within( getSaveActions() ).queryByText( 'Event saved.' )
		).not.toBeInTheDocument();
	} );
} );
