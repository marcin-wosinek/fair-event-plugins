/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import EditComponent from '../EditComponent.js';

// useBlockProps needs the editor's block context, which jsdom doesn't provide.
// InspectorControls renders into a sidebar slot; render its children inline.
jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: () => ( {} ),
	InspectorControls: ( { children } ) => (
		<div data-testid="inspector">{ children }</div>
	),
} ) );

// RangeControl's slider needs layout APIs jsdom lacks; a number input keeps
// the label/value/min/max/onChange contract under test.
jest.mock( '@wordpress/components', () => ( {
	...jest.requireActual( '@wordpress/components' ),
	RangeControl: ( { label, value, min, max, onChange } ) => (
		<label>
			{ label }
			<input
				type="number"
				value={ value }
				min={ min }
				max={ max }
				onChange={ ( event ) => onChange( event.target.value ) }
			/>
		</label>
	),
} ) );

// ServerSideRender hits the REST API. The stub exposes the attributes it
// receives and lets each test pick which of the placeholder states the real
// component would show: loading, a failed request, or an empty response.
// The "no linked recurring event" explanation is server markup from
// render.php's editor preview, covered by the block's E2E spec.
let mockSsrState = 'rendered';
jest.mock(
	'@wordpress/server-side-render',
	() =>
		( {
			attributes,
			LoadingResponsePlaceholder,
			ErrorResponsePlaceholder,
			EmptyResponsePlaceholder,
		} ) => {
			if ( mockSsrState === 'loading' ) {
				return <LoadingResponsePlaceholder />;
			}
			if ( mockSsrState === 'error' ) {
				return <ErrorResponsePlaceholder />;
			}
			if ( mockSsrState === 'empty' ) {
				return <EmptyResponsePlaceholder />;
			}
			return (
				<div
					data-testid="ssr"
					data-attributes={ JSON.stringify( attributes ) }
				/>
			);
		},
	{ virtual: true }
);

const renderBlock = ( attributes = { maxSessions: 5 } ) => {
	const setAttributes = jest.fn();
	render(
		<EditComponent
			attributes={ attributes }
			setAttributes={ setAttributes }
		/>
	);
	return setAttributes;
};

describe( 'OtherSessions EditComponent', () => {
	beforeEach( () => {
		mockSsrState = 'rendered';
	} );

	it( 'previews the server render with the block attributes', () => {
		renderBlock( { maxSessions: 3 } );

		expect( screen.getByTestId( 'ssr' ) ).toHaveAttribute(
			'data-attributes',
			JSON.stringify( { maxSessions: 3 } )
		);
	} );

	it( 'shows the maximum sessions control with its range', () => {
		renderBlock( { maxSessions: 3 } );

		const input = screen.getByLabelText( 'Maximum sessions' );
		expect( input ).toHaveValue( 3 );
		expect( input ).toHaveAttribute( 'min', '1' );
		expect( input ).toHaveAttribute( 'max', '20' );
	} );

	it( 'stores the chosen limit, clamped to 1–20', () => {
		const setAttributes = renderBlock();
		const input = screen.getByLabelText( 'Maximum sessions' );

		fireEvent.change( input, { target: { value: '8' } } );
		expect( setAttributes ).toHaveBeenLastCalledWith( { maxSessions: 8 } );

		fireEvent.change( input, { target: { value: '50' } } );
		expect( setAttributes ).toHaveBeenLastCalledWith( {
			maxSessions: 20,
		} );

		fireEvent.change( input, { target: { value: '-2' } } );
		expect( setAttributes ).toHaveBeenLastCalledWith( { maxSessions: 1 } );
	} );

	it( 'defaults the control to 5 sessions', () => {
		renderBlock( {} );

		expect( screen.getByLabelText( 'Maximum sessions' ) ).toHaveValue( 5 );
	} );

	it( 'shows a loading state while the preview renders', () => {
		mockSsrState = 'loading';
		renderBlock();

		expect(
			screen.getByText( 'Loading upcoming sessions…' )
		).toBeInTheDocument();
	} );

	it( 'explains a failed preview', () => {
		mockSsrState = 'error';
		renderBlock();

		// Notice also announces the message through the a11y live region.
		expect(
			screen.getAllByText(
				/Could not load the preview of upcoming sessions/
			)
		).toHaveLength( 2 );
	} );

	it( 'explains an empty preview as an unlinked post', () => {
		mockSsrState = 'empty';
		renderBlock();

		expect(
			screen.getByText( /no event is linked to this post/ )
		).toBeInTheDocument();
	} );
} );
