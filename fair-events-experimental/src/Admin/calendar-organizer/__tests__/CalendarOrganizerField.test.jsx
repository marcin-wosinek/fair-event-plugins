/**
 * @jest-environment jsdom
 *
 * Tests for the organizer field of the calendar's Create Event popup
 * (#2305): its registration, the sitewide default, choosing an organizer,
 * the request data it adds and a failed options load.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import CalendarOrganizerField, {
	organizerRequestData,
} from '../CalendarOrganizerField.js';
import '../index.js';

jest.mock( '@wordpress/api-fetch' );

const NORTH = '11111111-1111-4111-8111-111111111111';

const options = {
	organizer_id: 'default',
	organizers: [
		{ id: 'default', name: 'Acme Club', is_default: true },
		{ id: NORTH, name: 'North Club', is_default: false },
	],
};

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'Calendar organizer field registration', () => {
	it( 'adds an organizer field to the Create Event popup', () => {
		const fields = applyFilters(
			'fairEvents.calendar.quickEventFields',
			[]
		);
		expect( fields.map( ( f ) => f.name ) ).toEqual( [ 'organizer' ] );
		expect( fields[ 0 ].requestData( NORTH ) ).toEqual( {
			organizer_id: NORTH,
		} );
	} );
} );

describe( 'organizerRequestData', () => {
	it( 'sends nothing for the sitewide default or no choice', () => {
		expect( organizerRequestData( undefined ) ).toEqual( {} );
		expect( organizerRequestData( 'default' ) ).toEqual( {} );
	} );
} );

describe( 'CalendarOrganizerField', () => {
	it( 'starts on the sitewide default and reports a choice', async () => {
		apiFetch.mockResolvedValueOnce( options );
		const onChange = jest.fn();
		render( <CalendarOrganizerField onChange={ onChange } /> );

		const select = await screen.findByLabelText( 'Organizer' );
		expect( select ).toHaveValue( 'default' );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-organizers',
		} );
		expect(
			screen.getByRole( 'option', {
				name: 'Sitewide default (Acme Club)',
			} )
		).toBeInTheDocument();

		fireEvent.change( select, { target: { value: NORTH } } );
		expect( onChange.mock.calls[ 0 ][ 0 ] ).toBe( NORTH );
	} );

	it( 'shows the chosen organizer and is disabled while saving', async () => {
		apiFetch.mockResolvedValueOnce( options );
		render(
			<CalendarOrganizerField
				value={ NORTH }
				onChange={ jest.fn() }
				disabled
			/>
		);

		const select = await screen.findByLabelText( 'Organizer' );
		expect( select ).toHaveValue( NORTH );
		expect( select ).toBeDisabled();
	} );

	it( 'explains a failed load and retries', async () => {
		apiFetch
			.mockRejectedValueOnce( { message: 'Network down.' } )
			.mockResolvedValueOnce( options );
		render( <CalendarOrganizerField onChange={ jest.fn() } /> );

		expect(
			await screen.findByText( /Network down\./, {
				selector: '.components-notice__content',
			} )
		).toHaveTextContent(
			'Unless you try again, the event uses the sitewide organizer.'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		expect( await screen.findByLabelText( 'Organizer' ) ).toHaveValue(
			'default'
		);
	} );
} );
