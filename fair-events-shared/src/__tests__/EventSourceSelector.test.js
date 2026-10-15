/**
 * @jest-environment jsdom
 *
 * Component tests for the shared event feed selector used by the calendar,
 * week and list blocks (#1808).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventSourceSelector from '../EventSourceSelector.js';

jest.mock( '@wordpress/api-fetch' );

// jsdom has no layout engine; @wordpress/components' HStack/Button use
// matchMedia for responsive spacing, which jsdom doesn't implement.
beforeAll( () => {
	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
} );

const FEEDS = [
	{ slug: 'club-nights', name: 'Club nights' },
	{ slug: 'workshops', name: 'Workshops' },
];

describe( 'EventSourceSelector', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'lists enabled event feeds and keeps saved selections checked', async () => {
		apiFetch.mockResolvedValue( FEEDS );

		render(
			<EventSourceSelector
				selectedSources={ [ 'workshops' ] }
				onChange={ jest.fn() }
			/>
		);

		expect( await screen.findByText( 'Event Feeds' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Select event feeds to display' )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/sources?enabled_only=true',
		} );
		expect( screen.getByLabelText( 'Workshops' ) ).toBeChecked();
		expect( screen.getByLabelText( 'Club nights' ) ).not.toBeChecked();
		expect(
			screen.getByRole( 'link', { name: 'Manage Event Feeds' } )
		).toHaveAttribute( 'href', 'admin.php?page=fair-events-sources' );
	} );

	it( 'reports the selection as event feed slugs', async () => {
		apiFetch.mockResolvedValue( FEEDS );
		const onChange = jest.fn();

		render(
			<EventSourceSelector
				selectedSources={ [ 'workshops' ] }
				onChange={ onChange }
			/>
		);

		fireEvent.click( await screen.findByLabelText( 'Club nights' ) );
		expect( onChange ).toHaveBeenCalledWith( [
			'workshops',
			'club-nights',
		] );
	} );

	it( 'explains when no event feeds are configured', async () => {
		apiFetch.mockResolvedValue( [] );

		render( <EventSourceSelector onChange={ jest.fn() } /> );

		expect(
			await screen.findByText(
				'No event feeds configured. Create event feeds in Fair Events settings.',
				{ selector: '.components-notice__content' }
			)
		).toBeInTheDocument();
	} );

	it( 'falls back to an event feed error message', async () => {
		apiFetch.mockRejectedValue( {} );

		render( <EventSourceSelector onChange={ jest.fn() } /> );

		expect(
			await screen.findByText( 'Failed to load event feeds', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );
