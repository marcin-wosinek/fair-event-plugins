/**
 * @jest-environment jsdom
 *
 * Event Feeds management screen (#1808): the feature is presented as
 * "Event Feeds" while admin URLs and REST routes keep their `sources` names.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SourcesList from '../SourcesList.js';

jest.mock( '@wordpress/api-fetch' );

const FEEDS = [
	{
		id: 3,
		name: 'Club nights',
		slug: 'club-nights',
		enabled: true,
		data_sources: [
			{ source_type: 'categories', config: { category_ids: [ 1 ] } },
			{
				source_type: 'ical_url',
				config: { url: 'https://x.test/a.ics' },
			},
		],
	},
	{
		id: 4,
		name: 'Workshops',
		slug: 'workshops',
		enabled: false,
		data_sources: [ { source_type: 'categories', config: {} } ],
	},
];

beforeEach( () => {
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	apiFetch.mockImplementation( ( { path } ) =>
		Promise.resolve( path === '/fair-events/v1/sources' ? FEEDS : [] )
	);
} );

afterEach( () => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
} );

describe( 'SourcesList', () => {
	it( 'lists event feeds and keeps the existing view links', async () => {
		render( <SourcesList /> );

		expect(
			await screen.findByRole( 'link', { name: 'Club nights' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-events-source-view&source_id=3'
		);
		expect(
			screen.getByRole( 'heading', { name: 'Event Feeds' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'columnheader', { name: 'Feed inputs' } )
		).toBeInTheDocument();
		expect( screen.getByText( '2 feed inputs' ) ).toBeInTheDocument();
		expect( screen.getByText( '1 feed input' ) ).toBeInTheDocument();
	} );

	it( 'explains the empty state in event feed terms', async () => {
		apiFetch.mockResolvedValue( [] );

		render( <SourcesList /> );

		expect(
			await screen.findByText(
				'No event feeds yet. Add your first event feed to get started.'
			)
		).toBeInTheDocument();
	} );

	it( 'opens the add form with feed input controls', async () => {
		render( <SourcesList /> );
		await screen.findByRole( 'link', { name: 'Club nights' } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add Event Feed' } )
		);

		const dialog = screen.getByRole( 'dialog', { name: 'Add Event Feed' } );
		// Let the categories input finish loading before the test ends.
		await within( dialog ).findByText(
			'No categories found. Create categories first.'
		);
		expect(
			within( dialog ).getByLabelText( 'Event feed name' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'heading', { name: 'Feed input #1' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByLabelText( 'Input type' )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', { name: 'Add feed input' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Create event feed',
			} )
		).toBeInTheDocument();
	} );

	it( 'opens the edit form for an existing event feed', async () => {
		render( <SourcesList /> );
		await screen.findByRole( 'link', { name: 'Club nights' } );

		fireEvent.click(
			screen.getAllByRole( 'button', { name: 'Edit' } )[ 0 ]
		);

		const dialog = screen.getByRole( 'dialog', {
			name: 'Edit Event Feed',
		} );
		// Let the categories input finish loading before the test ends.
		await within( dialog ).findByText(
			'No categories found. Create categories first.'
		);
		expect(
			within( dialog ).getByLabelText( 'Event feed name' )
		).toHaveValue( 'Club nights' );
		expect(
			within( dialog ).getByRole( 'heading', { name: 'Feed input #2' } )
		).toBeInTheDocument();
		expect(
			within( dialog ).getByRole( 'button', {
				name: 'Update event feed',
			} )
		).toBeInTheDocument();
	} );

	describe( 'deleting an event feed', () => {
		const openDelete = async () => {
			render( <SourcesList /> );
			await screen.findByRole( 'link', { name: 'Club nights' } );
			fireEvent.click(
				screen.getAllByRole( 'button', { name: 'Delete' } )[ 0 ]
			);
			return screen.getByRole( 'dialog', {
				name: 'Delete event feed — Club nights',
			} );
		};
		const deleteCalls = () =>
			apiFetch.mock.calls.filter(
				( [ options ] ) => options.method === 'DELETE'
			);

		it( 'names the feed and its URLs, and cancelling sends nothing', async () => {
			const dialog = await openDelete();

			expect(
				within( dialog ).getByText( /slug “club-nights”/ )
			).toBeInTheDocument();
			expect(
				within( dialog ).getByRole( 'button', {
					name: 'Delete event feed',
				} )
			).toHaveClass( 'is-destructive' );

			fireEvent.click(
				within( dialog ).getByRole( 'button', { name: 'Cancel' } )
			);

			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect( deleteCalls() ).toHaveLength( 0 );
		} );

		it( 'keeps the dialog open on failure and retries', async () => {
			let failNext = true;
			apiFetch.mockImplementation( ( { path, method } ) => {
				if ( method === 'DELETE' ) {
					if ( failNext ) {
						failNext = false;
						return Promise.reject( {
							message: 'Event feed not found.',
						} );
					}
					return Promise.resolve( { deleted: true } );
				}
				return Promise.resolve(
					path === '/fair-events/v1/sources' ? FEEDS : []
				);
			} );
			const dialog = await openDelete();
			const confirm = within( dialog ).getByRole( 'button', {
				name: 'Delete event feed',
			} );

			await act( async () => fireEvent.click( confirm ) );

			expect(
				within( dialog ).getByText( 'Event feed not found.', {
					selector: '.components-notice__content',
				} )
			).toBeInTheDocument();

			await act( async () => fireEvent.click( confirm ) );

			expect( deleteCalls() ).toHaveLength( 2 );
			expect( deleteCalls()[ 1 ][ 0 ].path ).toBe(
				'/fair-events/v1/sources/3'
			);
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			expect(
				await screen.findByText( 'Event feed “Club nights” deleted.', {
					selector: '.components-notice__content',
				} )
			).toBeInTheDocument();
		} );
	} );
} );
