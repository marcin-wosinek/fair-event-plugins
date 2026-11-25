/**
 * @jest-environment jsdom
 *
 * Component tests for the participant selector shared by the "Add
 * participants" dialogs (#2437).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ParticipantSelector, {
	filterParticipantsBySearch,
	useParticipantSelection,
} from '../ParticipantSelector.js';

const PEOPLE = [
	{ id: 1, name: 'Ana', surname: 'García', email: 'ana@example.test' },
	{ id: 2, name: 'Bruno', surname: 'Díaz', email: 'bruno@example.test' },
	{ id: 3, name: 'Ana', surname: 'García', email: 'ana.g@other.test' },
	{ id: 4, name: 'Carla', surname: null, email: null },
];

/**
 * Renders a selector with its own state, as a caller does.
 *
 * @param {Object} props Selector props, without `selection`.
 * @return {Element} The selector.
 */
function Harness( props ) {
	const selection = useParticipantSelection();
	return (
		<section aria-label={ props.region }>
			<ParticipantSelector selection={ selection } { ...props } />
			<output data-testid={ `${ props.region }-ids` }>
				{ Array.from( selection.selectedIds ).join( ',' ) }
			</output>
		</section>
	);
}

const search = ( region, value ) =>
	fireEvent.change(
		within( screen.getByRole( 'region', { name: region } ) ).getByRole(
			'textbox',
			{ name: 'Search participants' }
		),
		{ target: { value } }
	);

const rowNames = ( region ) =>
	within( screen.getByRole( 'region', { name: region } ) )
		.queryAllByRole( 'checkbox' )
		.map( ( box ) => box.getAttribute( 'aria-labelledby' ) )
		.map( ( id ) => document.getElementById( id ).textContent );

const ids = ( region ) => screen.getByTestId( `${ region }-ids` ).textContent;

describe( 'filterParticipantsBySearch', () => {
	it( 'matches name, surname and email ignoring case', () => {
		expect(
			filterParticipantsBySearch( PEOPLE, 'BRUNO' ).map( ( p ) => p.id )
		).toEqual( [ 2 ] );
		expect(
			filterParticipantsBySearch( PEOPLE, 'garcía' ).map( ( p ) => p.id )
		).toEqual( [ 1, 3 ] );
		expect(
			filterParticipantsBySearch( PEOPLE, 'Other.TEST' ).map(
				( p ) => p.id
			)
		).toEqual( [ 3 ] );
	} );

	it( 'treats a blank search as no search only when asked to', () => {
		expect(
			filterParticipantsBySearch( PEOPLE, '  ', { ignoreBlank: true } )
		).toHaveLength( 4 );
		// Literal matching: nobody's fields contain two spaces.
		expect( filterParticipantsBySearch( PEOPLE, '  ' ) ).toHaveLength( 0 );
	} );
} );

describe( 'ParticipantSelector', () => {
	it( 'names each checkbox after the person and their email', () => {
		render( <Harness region="Add" participants={ PEOPLE } /> );

		expect(
			screen.getByRole( 'checkbox', {
				name: 'Ana García ana.g@other.test',
			} )
		).toBeInTheDocument();
		expect(
			screen.getByText( '4 participant(s) available' )
		).toBeVisible();
	} );

	it( 'selects with the checkbox and keeps a hidden selection while searching', () => {
		render( <Harness region="Add" participants={ PEOPLE } /> );

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Bruno Díaz bruno@example.test',
			} )
		);
		expect( screen.getByText( '1 selected, 4 shown' ) ).toBeVisible();

		search( 'Add', 'ana' );
		expect( rowNames( 'Add' ) ).toHaveLength( 2 );
		expect( screen.getByText( '1 selected, 2 shown' ) ).toBeVisible();

		search( 'Add', '' );
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Bruno Díaz bruno@example.test',
			} )
		).toBeChecked();
		expect( ids( 'Add' ) ).toBe( '2' );
	} );

	it( 'says when nobody matches the search', () => {
		render( <Harness region="Add" participants={ PEOPLE } /> );

		search( 'Add', 'zzz' );

		expect( rowNames( 'Add' ) ).toHaveLength( 0 );
		expect(
			screen.getByText( 'No participants match your search.' )
		).toBeVisible();
		expect(
			screen.getByText( '0 participant(s) available' )
		).toBeVisible();
	} );

	it( 'keeps two selectors independent', () => {
		render(
			<>
				<Harness region="First" participants={ PEOPLE } />
				<Harness region="Second" participants={ PEOPLE } />
			</>
		);

		search( 'First', 'bruno' );
		fireEvent.click(
			within( screen.getByRole( 'region', { name: 'First' } ) ).getByRole(
				'checkbox'
			)
		);

		expect( ids( 'First' ) ).toBe( '2' );
		expect( ids( 'Second' ) ).toBe( '' );
		expect( rowNames( 'Second' ) ).toHaveLength( 4 );
		// Each row's label points at its own selector's details.
		const firstId = within(
			screen.getByRole( 'region', { name: 'First' } )
		)
			.getByRole( 'checkbox' )
			.getAttribute( 'aria-labelledby' );
		const secondIds = within(
			screen.getByRole( 'region', { name: 'Second' } )
		)
			.getAllByRole( 'checkbox' )
			.map( ( box ) => box.getAttribute( 'aria-labelledby' ) );
		expect( secondIds ).not.toContain( firstId );
	} );

	it( 'selects and deselects only the shown people with Select All', () => {
		render(
			<Harness region="Add" participants={ PEOPLE } showSelectAll />
		);

		fireEvent.click(
			screen.getByRole( 'checkbox', {
				name: 'Bruno Díaz bruno@example.test',
			} )
		);
		search( 'Add', 'ana' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Select All' } ) );
		expect( ids( 'Add' ) ).toBe( '2,1,3' );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Deselect All' } )
		);
		expect( ids( 'Add' ) ).toBe( '2' );
		expect(
			screen.getByRole( 'button', { name: 'Select All' } )
		).toBeVisible();
	} );

	it( 'offers no Select All unless asked to', () => {
		render( <Harness region="Add" participants={ PEOPLE } /> );

		expect(
			screen.queryByRole( 'button', { name: 'Select All' } )
		).not.toBeInTheDocument();
	} );

	it( 'reports the count its caller gives', () => {
		render(
			<Harness region="Add" participants={ PEOPLE } selectedCount={ 3 } />
		);

		expect( screen.getByText( '3 selected, 4 shown' ) ).toBeVisible();
	} );

	it( 'renders the caller controls beside the search', () => {
		render(
			<Harness
				region="Add"
				participants={ PEOPLE }
				controls={ <button type="button">Role</button> }
			/>
		);

		expect( screen.getByRole( 'button', { name: 'Role' } ) ).toBeVisible();
	} );
} );
