/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EditComponent from '../EditComponent.js';

jest.mock( '@wordpress/api-fetch' );

// useBlockProps needs the editor's block context, which jsdom doesn't provide;
// stub it to a plain spread so we can render the component in isolation.
// InspectorControls renders into a sidebar slot; render its children inline.
jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	InspectorControls: ( { children } ) => (
		<div data-testid="inspector">{ children }</div>
	),
} ) );

// ServerSideRender hits the REST API for a live render; stub it to a marker so
// we can assert "the preview rendered" without a server. The "no public
// prices configured" placeholder render.php returns for editor requests is
// part of that same server-rendered markup, so it isn't separately tested
// here — only the linked/not-linked split this component itself decides.
jest.mock(
	'@wordpress/server-side-render',
	() =>
		( { attributes } ) => (
			<div
				data-testid="ssr"
				data-attributes={ JSON.stringify( attributes ) }
			/>
		),
	{
		virtual: true,
	}
);

const PLACEHOLDER = 'Event Prices block is disabled';

// A single, non-recurring event whose primary post is id 16 (a page).
const primaryLinked = {
	id: 11,
	event_id: 16,
	linked_posts: [ { id: 16, is_primary: true } ],
};

// An event linked to post 42 only through the junction table (event_id is a
// different fair_event post), so it is NOT the primary event_id.
const junctionLinked = {
	id: 12,
	event_id: 99,
	linked_posts: [
		{ id: 99, is_primary: true },
		{ id: 42, is_primary: false },
	],
};

const renderBlock = ( postId, postType ) =>
	render(
		<EditComponent attributes={ {} } context={ { postId, postType } } />
	);

describe( 'EventPrices EditComponent', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'shows the preview for a page linked as the primary event_id', async () => {
		apiFetch.mockResolvedValue( [ primaryLinked, junctionLinked ] );

		renderBlock( 16, 'page' );

		await waitFor( () =>
			expect( screen.getByTestId( 'ssr' ) ).toBeInTheDocument()
		);
		expect(
			screen.queryByText( PLACEHOLDER, { exact: false } )
		).toBeNull();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/event-dates?include_linked=true',
		} );
	} );

	it( 'shows the preview for a page linked only via the junction table', async () => {
		apiFetch.mockResolvedValue( [ primaryLinked, junctionLinked ] );

		renderBlock( 42, 'page' );

		await waitFor( () =>
			expect( screen.getByTestId( 'ssr' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows the placeholder when the post is not linked to any event', async () => {
		apiFetch.mockResolvedValue( [ primaryLinked, junctionLinked ] );

		renderBlock( 7, 'page' );

		await waitFor( () =>
			expect(
				screen.getByText( PLACEHOLDER, { exact: false } )
			).toBeInTheDocument()
		);
		expect( screen.queryByTestId( 'ssr' ) ).toBeNull();
	} );

	it( 'still renders the preview for a linked fair_event post (no regression)', async () => {
		apiFetch.mockResolvedValue( [ primaryLinked ] );

		renderBlock( 16, 'fair_event' );

		await waitFor( () =>
			expect( screen.getByTestId( 'ssr' ) ).toBeInTheDocument()
		);
	} );

	it( 'shows the placeholder when the lookup fails', async () => {
		apiFetch.mockRejectedValue( new Error( 'network' ) );

		renderBlock( 16, 'page' );

		await waitFor( () =>
			expect(
				screen.getByText( PLACEHOLDER, { exact: false } )
			).toBeInTheDocument()
		);
	} );

	it( 'shows the placeholder when there is no post ID at all', async () => {
		renderBlock( undefined, 'page' );

		await waitFor( () =>
			expect(
				screen.getByText( PLACEHOLDER, { exact: false } )
			).toBeInTheDocument()
		);
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	describe( 'visibility settings', () => {
		const tickets = {
			ticket_types: [
				{ id: 7, name: 'Full Pass', disabled: false },
				{ id: 8, name: 'Day Pass', disabled: false },
				{ id: 9, name: 'Retired', disabled: true },
			],
			sale_periods: [
				{ id: 5, name: 'Early Bird' },
				{ id: 6, name: 'Regular' },
				{ id: 7, name: 'Last minute' },
			],
			prices: [],
		};

		// Route the two lookups the component makes: linkage, then tickets.
		const mockApi = ( eventDates, ticketsResponse ) => {
			apiFetch.mockImplementation( ( { path } ) => {
				if ( path.startsWith( '/fair-events/v1/event-dates?' ) ) {
					return Promise.resolve( eventDates );
				}
				return typeof ticketsResponse === 'function'
					? ticketsResponse( path )
					: Promise.resolve( ticketsResponse );
			} );
		};

		const renderWithAttributes = ( attributes, setAttributes ) =>
			render(
				<EditComponent
					attributes={ attributes }
					setAttributes={ setAttributes }
					context={ { postId: 16, postType: 'page' } }
				/>
			);

		it( 'lists enabled ticket types and all sale periods, checked = visible', async () => {
			mockApi( [ primaryLinked ], tickets );

			renderWithAttributes(
				{ hiddenTicketTypeIds: [ 8 ], hiddenSalePeriodIds: [ 7 ] },
				jest.fn()
			);

			expect( await screen.findByLabelText( 'Full Pass' ) ).toBeChecked();
			// Hidden entries stay listed so editors can restore them.
			expect( screen.getByLabelText( 'Day Pass' ) ).not.toBeChecked();
			expect( screen.queryByLabelText( 'Retired' ) ).toBeNull();
			expect( screen.getByLabelText( 'Early Bird' ) ).toBeChecked();
			expect( screen.getByLabelText( 'Last minute' ) ).not.toBeChecked();
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/event-dates/11/tickets',
			} );
		} );

		it( 'unchecking hides an entry and checking restores it', async () => {
			mockApi( [ primaryLinked ], tickets );
			const setAttributes = jest.fn();

			renderWithAttributes(
				{ hiddenTicketTypeIds: [ 8 ], hiddenSalePeriodIds: [] },
				setAttributes
			);

			fireEvent.click( await screen.findByLabelText( 'Full Pass' ) );
			expect( setAttributes ).toHaveBeenLastCalledWith( {
				hiddenTicketTypeIds: [ 8, 7 ],
			} );

			fireEvent.click( screen.getByLabelText( 'Day Pass' ) );
			expect( setAttributes ).toHaveBeenLastCalledWith( {
				hiddenTicketTypeIds: [],
			} );

			fireEvent.click( screen.getByLabelText( 'Last minute' ) );
			expect( setAttributes ).toHaveBeenLastCalledWith( {
				hiddenSalePeriodIds: [ 7 ],
			} );
		} );

		it( 'forwards the hidden IDs to the server-rendered preview', async () => {
			mockApi( [ primaryLinked ], tickets );
			const attributes = {
				hiddenTicketTypeIds: [ 8 ],
				hiddenSalePeriodIds: [ 7 ],
			};

			renderWithAttributes( attributes, jest.fn() );

			const ssr = await screen.findByTestId( 'ssr' );
			expect( JSON.parse( ssr.dataset.attributes ) ).toEqual(
				attributes
			);
		} );

		it( 'loads options from the series master for a generated occurrence', async () => {
			mockApi(
				[
					{
						id: 30,
						event_id: 16,
						occurrence_type: 'generated',
						master_id: 21,
						linked_posts: [],
					},
				],
				tickets
			);

			renderWithAttributes( {}, jest.fn() );

			await screen.findByLabelText( 'Full Pass' );
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-events/v1/event-dates/21/tickets',
			} );
		} );

		it( 'shows an error with retry, keeping saved selections', async () => {
			let calls = 0;
			mockApi( [ primaryLinked ], () => {
				calls++;
				return calls === 1
					? Promise.reject( new Error( 'network' ) )
					: Promise.resolve( tickets );
			} );
			const setAttributes = jest.fn();

			renderWithAttributes(
				{ hiddenTicketTypeIds: [ 8 ], hiddenSalePeriodIds: [] },
				setAttributes
			);

			const retryButtons = await screen.findAllByRole( 'button', {
				name: 'Try again',
			} );
			expect( setAttributes ).not.toHaveBeenCalled();

			fireEvent.click( retryButtons[ 0 ] );

			expect(
				await screen.findByLabelText( 'Day Pass' )
			).not.toBeChecked();
			expect( setAttributes ).not.toHaveBeenCalled();
		} );

		it( 'shows no settings panels when the post is not linked', async () => {
			mockApi( [ primaryLinked ], tickets );

			render(
				<EditComponent
					attributes={ {} }
					setAttributes={ jest.fn() }
					context={ { postId: 7, postType: 'page' } }
				/>
			);

			await screen.findByText( PLACEHOLDER, { exact: false } );
			expect( screen.queryByTestId( 'inspector' ) ).toBeNull();
		} );
	} );
} );
