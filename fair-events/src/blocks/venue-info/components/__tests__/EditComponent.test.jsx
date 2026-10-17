/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EditComponent from '../EditComponent.js';

jest.mock( '@wordpress/api-fetch' );

// ComboboxControl measures itself via ResizeObserver, which jsdom doesn't implement.
global.ResizeObserver =
	global.ResizeObserver ||
	class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
// ComboboxControl scrolls the highlighted option into view.
window.HTMLElement.prototype.scrollIntoView =
	window.HTMLElement.prototype.scrollIntoView || function () {};

// useBlockProps needs the editor's block context, which jsdom doesn't provide;
// InspectorControls renders into a slot that doesn't exist here, so render its
// children inline to reach the sidebar controls.
jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	InspectorControls: ( { children } ) => (
		<div data-testid="sidebar">{ children }</div>
	),
} ) );

// ServerSideRender hits the REST API for a live render; stub it to a marker
// exposing the requested venue and a render id so remounts are observable.
let mockSsrMounts = 0;
jest.mock(
	'@wordpress/server-side-render',
	() => {
		const { useState } = jest.requireActual( 'react' );
		return function MockServerSideRender( { attributes } ) {
			const [ mount ] = useState( () => ++mockSsrMounts );
			return (
				<div
					data-testid="ssr"
					data-venue={ attributes.venueId }
					data-mount={ mount }
				/>
			);
		};
	},
	{ virtual: true }
);

// Placeholder instructions and notices are also spoken through the a11y live
// region; match only the visible copy.
const VISIBLE = { ignore: '.a11y-speak-region, script, style' };

const VENUES = [
	{ id: 1, name: 'Riverside Hall' },
	{ id: 2, name: 'Garden Studio' },
];

/**
 * Render the block as the editor would, feeding attribute changes back in.
 *
 * @param {Object} initialAttributes Saved attributes.
 * @return {Object} Helpers: getAttributes().
 */
function renderBlock( initialAttributes = {} ) {
	let attributes = { ...initialAttributes };
	const setAttributes = jest.fn( ( changes ) => {
		attributes = { ...attributes, ...changes };
		rerender(
			<EditComponent
				attributes={ attributes }
				setAttributes={ setAttributes }
			/>
		);
	} );
	const { rerender, container } = render(
		<EditComponent
			attributes={ attributes }
			setAttributes={ setAttributes }
		/>
	);
	return { getAttributes: () => attributes, setAttributes, container };
}

async function chooseVenue( name, scope = screen ) {
	const input = scope.getByRole( 'combobox', { name: 'Venue' } );
	act( () => {
		fireEvent.focus( input );
		fireEvent.change( input, { target: { value: name.slice( 0, 4 ) } } );
	} );
	const option = await scope.findByRole( 'option', { name } );
	act( () => {
		fireEvent.click( option );
	} );
}

function click( element ) {
	act( () => {
		fireEvent.click( element );
	} );
}

describe( 'VenueInfo EditComponent', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockSsrMounts = 0;
	} );

	it( 'shows a loading state while venues are fetched', async () => {
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		renderBlock();

		expect(
			screen.getByText( 'Loading venues…', VISIBLE )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-events/v1/venues',
		} );
	} );

	it( 'asks for a venue when none is selected, then previews the choice', async () => {
		apiFetch.mockResolvedValue( VENUES );

		const { getAttributes } = renderBlock();

		expect(
			await screen.findByText(
				'Choose the venue whose details this block shows.',
				VISIBLE
			)
		).toBeInTheDocument();
		expect( screen.queryByTestId( 'ssr' ) ).toBeNull();

		await chooseVenue( 'Garden Studio' );

		expect( getAttributes().venueId ).toBe( 2 );
		expect( screen.getByTestId( 'ssr' ) ).toHaveAttribute(
			'data-venue',
			'2'
		);
	} );

	it( 'changes and clears the selection from the sidebar', async () => {
		apiFetch.mockResolvedValue( VENUES );

		const { getAttributes } = renderBlock( { venueId: 1 } );

		expect( await screen.findByTestId( 'ssr' ) ).toHaveAttribute(
			'data-venue',
			'1'
		);
		const input = screen.getByRole( 'combobox', { name: 'Venue' } );
		expect( input ).toHaveValue( 'Riverside Hall' );

		await chooseVenue( 'Garden Studio' );
		expect( getAttributes().venueId ).toBe( 2 );
		expect( screen.getByTestId( 'ssr' ) ).toHaveAttribute(
			'data-venue',
			'2'
		);

		click( screen.getByRole( 'button', { name: 'Reset' } ) );
		expect( getAttributes().venueId ).toBeUndefined();
		expect( screen.queryByTestId( 'ssr' ) ).toBeNull();
		expect(
			screen.getByText(
				'Choose the venue whose details this block shows.',
				VISIBLE
			)
		).toBeInTheDocument();
	} );

	it( 'keeps independent selections in separate block instances', async () => {
		apiFetch.mockResolvedValue( VENUES );

		const first = renderBlock( { venueId: 1 } );
		const second = renderBlock();

		await screen.findByTestId( 'ssr' );
		await chooseVenue( 'Garden Studio', within( second.container ) );

		expect( first.setAttributes ).not.toHaveBeenCalled();
		expect( first.getAttributes().venueId ).toBe( 1 );
		expect( second.getAttributes().venueId ).toBe( 2 );
		expect(
			screen
				.getAllByTestId( 'ssr' )
				.map( ( el ) => el.getAttribute( 'data-venue' ) )
		).toEqual( [ '1', '2' ] );
	} );

	it( 'explains a deleted venue and offers another choice', async () => {
		apiFetch.mockResolvedValue( VENUES );

		const { getAttributes } = renderBlock( { venueId: 42 } );

		expect(
			await screen.findByText(
				'The selected venue has been deleted. Visitors see nothing for this block until you choose another venue.',
				VISIBLE
			)
		).toBeInTheDocument();
		expect( screen.queryByTestId( 'ssr' ) ).toBeNull();
		expect(
			screen.getByRole( 'combobox', { name: 'Venue' } )
		).toBeInTheDocument();
		// The stale ID is not silently dropped.
		expect( getAttributes().venueId ).toBe( 42 );
	} );

	it( 'explains an empty venue list with a link to manage venues', async () => {
		apiFetch.mockResolvedValue( [] );

		renderBlock();

		expect(
			await screen.findByText(
				'There are no venues yet. Add a venue, then refresh.',
				VISIBLE
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByRole( 'link', {
				name: 'Manage venues (opens in a new tab)',
			} )[ 0 ]
		).toHaveAttribute( 'href', 'admin.php?page=fair-events-venues' );
	} );

	it( 'keeps the selection on a failed load and recovers on retry', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'offline' ) );
		apiFetch.mockResolvedValueOnce( VENUES );

		const { setAttributes } = renderBlock( { venueId: 1 } );

		expect(
			await screen.findByText(
				'Venues could not be loaded. Your venue selection is kept; try again.',
				VISIBLE
			)
		).toBeInTheDocument();

		click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( await screen.findByTestId( 'ssr' ) ).toHaveAttribute(
			'data-venue',
			'1'
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( setAttributes ).not.toHaveBeenCalled();
	} );

	it( 'refreshes the venue list and the preview on demand', async () => {
		apiFetch.mockResolvedValue( VENUES );

		renderBlock( { venueId: 1 } );

		const firstMount = ( await screen.findByTestId( 'ssr' ) ).getAttribute(
			'data-mount'
		);

		click(
			screen.getByRole( 'button', { name: 'Refresh venue details' } )
		);

		await waitFor( () =>
			expect(
				Number(
					screen.getByTestId( 'ssr' ).getAttribute( 'data-mount' )
				)
			).toBeGreaterThan( Number( firstMount ) )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
	} );
} );
