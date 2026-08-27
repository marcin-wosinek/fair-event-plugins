/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import LinkOptions from '../LinkOptions.js';

jest.mock( '@wordpress/api-fetch' );

describe( 'LinkOptions fair_event recovery', () => {
	beforeEach( () => apiFetch.mockReset() );

	it( 'uses one ensure request and transitions to the returned event', async () => {
		let resolveEnsure;
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.includes( 'include_linked' ) ) {
				return Promise.resolve( [] );
			}
			return new Promise( ( resolve ) => {
				resolveEnsure = resolve;
			} );
		} );
		const onEventLinked = jest.fn();
		render(
			<LinkOptions
				postId={ 7 }
				postType="fair_event"
				onEventLinked={ onEventLinked }
				setError={ jest.fn() }
			/>
		);

		const createButton = screen.getByRole( 'button', {
			name: 'Create New Event',
		} );
		fireEvent.click( createButton );
		expect( createButton ).toBeDisabled();
		fireEvent.click( createButton );

		resolveEnsure( { id: 42 } );
		await waitFor( () =>
			expect( onEventLinked ).toHaveBeenCalledWith( 42 )
		);
		expect(
			apiFetch.mock.calls.filter(
				( [ options ] ) =>
					options.path ===
					'/fair-events/v1/event-dates/ensure-for-post'
			)
		).toHaveLength( 1 );
	} );
} );
