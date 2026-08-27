/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventMetaBox from '../EventMetaBox.js';

jest.mock( '@wordpress/api-fetch' );
jest.mock( '../store.js', () => ( { STORE_NAME: 'fair-events/event-data' } ) );
jest.mock( '@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{ useDispatch: () => ( { setEventData: jest.fn() } ) },
		{
			get( target, prop ) {
				if ( prop in target ) return target[ prop ];
				return stub;
			},
		}
	);
} );
jest.mock( '../EventEditForm.js', () => ( { eventDateId } ) => (
	<div>Edit event { eventDateId }</div>
) );
jest.mock( '../LinkOptions.js', () => ( { onEventLinked } ) => (
	<button onClick={ () => onEventLinked( 99 ) }>Create New Event</button>
) );

const flushPromises = async () => {
	await act( async () => Promise.resolve() );
};

describe( 'EventMetaBox recovery', () => {
	beforeEach( () => {
		jest.useFakeTimers();
		apiFetch.mockReset();
	} );

	afterEach( () => {
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	} );

	it( 'keeps fallback hidden until a retry finds the event', async () => {
		apiFetch
			.mockResolvedValueOnce( [] )
			.mockResolvedValueOnce( [ { id: 42, event_id: 7 } ] );
		render( <EventMetaBox postId={ 7 } postType="fair_event" /> );

		await flushPromises();
		expect(
			screen.queryByRole( 'button', { name: 'Create New Event' } )
		).not.toBeInTheDocument();

		await act( async () => jest.advanceTimersByTime( 500 ) );
		await waitFor( () =>
			expect( screen.getByText( 'Edit event 42' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows fallback after all retries are exhausted', async () => {
		apiFetch.mockResolvedValue( [] );
		render( <EventMetaBox postId={ 7 } postType="fair_event" /> );

		await flushPromises();
		await act( async () => jest.advanceTimersByTime( 1000 ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Create New Event' } )
			).toBeInTheDocument()
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'renders an initially linked event without looking it up', () => {
		render(
			<EventMetaBox
				postId={ 7 }
				postType="fair_event"
				eventDateId={ 42 }
			/>
		);
		expect( screen.getByText( 'Edit event 42' ) ).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'ignores a late lookup after recovery resolves the event', async () => {
		let resolveLookup;
		apiFetch.mockReturnValue(
			new Promise( ( resolve ) => {
				resolveLookup = resolve;
			} )
		);
		const { unmount } = render(
			<EventMetaBox postId={ 7 } postType="fair_event" />
		);

		unmount();
		await act( async () => resolveLookup( [ { id: 42, event_id: 7 } ] ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );
} );
