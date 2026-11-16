/**
 * @jest-environment jsdom
 *
 * Tests for the shared category input (#2292).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { useState } from '@wordpress/element';
import CategoryInput, {
	buildCategoryOptions,
	getCategoryLabel,
	mergeCategories,
} from '../CategoryInput.js';

const multilingual = [
	{ id: 1, name: 'Arancha', language: 'English' },
	{ id: 2, name: 'Arancha', language: 'Español' },
	{ id: 3, name: 'Music' },
];

// Keeps the selection in real state, as the parent screens do.
function Harness( { initial = [], categories, onChange, onCreate } ) {
	const [ value, setValue ] = useState( initial );
	const [ known, setKnown ] = useState( categories );
	return (
		<CategoryInput
			value={ value }
			categories={ known }
			onChange={ ( ids ) => {
				setValue( ids );
				onChange?.( ids );
			} }
			onCreate={
				onCreate &&
				( async ( name ) => {
					const created = await onCreate( name );
					if ( created ) {
						setKnown( ( prev ) =>
							mergeCategories( prev, [ created ] )
						);
					}
					return created;
				} )
			}
		/>
	);
}

const field = () => screen.getByLabelText( 'Categories' );

const type = ( text ) => {
	fireEvent.change( field(), { target: { value: text } } );
	fireEvent.keyDown( field(), { key: 'Enter', code: 'Enter' } );
};

const tokenNames = () =>
	Array.from(
		document.querySelectorAll(
			'.components-form-token-field__token-text [aria-hidden="true"]'
		)
	).map( ( node ) => node.textContent.trim() );

const suggestionNames = () =>
	Array.from(
		document.querySelectorAll( '.components-form-token-field__suggestion' )
	).map( ( node ) => node.textContent.trim() );

const removeToken = ( label ) => {
	const token = Array.from(
		document.querySelectorAll( '.components-form-token-field__token' )
	).find(
		( node ) =>
			node.querySelector( '[aria-hidden="true"]' ).textContent === label
	);
	fireEvent.click(
		within( token ).getByRole( 'button', { name: 'Remove item' } )
	);
};

const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise( ( res, rej ) => {
		resolve = res;
		reject = rej;
	} );
	return { promise, resolve, reject };
};

describe( 'getCategoryLabel', () => {
	it( 'adds the language when known and falls back to the name', () => {
		expect( getCategoryLabel( multilingual[ 0 ] ) ).toBe(
			'Arancha — English'
		);
		expect( getCategoryLabel( multilingual[ 2 ] ) ).toBe( 'Music' );
	} );
} );

describe( 'mergeCategories', () => {
	it( 'keeps omitted categories and never drops a known language', () => {
		const merged = mergeCategories( multilingual, [
			{ id: 1, name: 'Arancha' },
			{ id: 4, name: 'New' },
		] );
		expect( merged ).toEqual( [ ...multilingual, { id: 4, name: 'New' } ] );
	} );

	it( 'lets a language-rich record replace a language-less one', () => {
		expect(
			mergeCategories(
				[ { id: 1, name: 'Arancha' } ],
				[ multilingual[ 0 ] ]
			)
		).toEqual( [ multilingual[ 0 ] ] );
	} );
} );

describe( 'buildCategoryOptions', () => {
	it( 'disambiguates identical complete labels with the term ID', () => {
		const { suggestions, idByLabel } = buildCategoryOptions( [
			{ id: 7, name: 'Bart' },
			{ id: 8, name: 'Bart' },
			{ id: 9, name: 'Other' },
		] );
		expect( suggestions ).toEqual( [
			'Bart (ID 7)',
			'Bart (ID 8)',
			'Other',
		] );
		expect( idByLabel.get( 'Bart (ID 8)' ) ).toBe( 8 );
	} );
} );

describe( 'CategoryInput', () => {
	it( 'shows language labels in suggestions and tokens', () => {
		render( <Harness initial={ [ 2 ] } categories={ multilingual } /> );
		expect( tokenNames() ).toEqual( [ 'Arancha — Español' ] );

		fireEvent.focus( field() );
		fireEvent.change( field(), { target: { value: 'ara' } } );
		expect( suggestionNames() ).toEqual( [ 'Arancha — English' ] );
	} );

	it( 'selects and removes same-named categories by ID', () => {
		const onChange = jest.fn();
		render( <Harness categories={ multilingual } onChange={ onChange } /> );

		type( 'Arancha — Español' );
		expect( onChange ).toHaveBeenLastCalledWith( [ 2 ] );
		type( 'Arancha — English' );
		expect( onChange ).toHaveBeenLastCalledWith( [ 2, 1 ] );
		expect( tokenNames() ).toEqual( [
			'Arancha — Español',
			'Arancha — English',
		] );

		removeToken( 'Arancha — Español' );
		expect( onChange ).toHaveBeenLastCalledWith( [ 1 ] );
		expect( tokenNames() ).toEqual( [ 'Arancha — English' ] );
	} );

	it( 'shows plain names when no language metadata exists', () => {
		const onChange = jest.fn();
		render(
			<Harness
				categories={ [
					{ id: 1, name: 'Music' },
					{ id: 2, name: 'Sports' },
				] }
				onChange={ onChange }
			/>
		);
		type( 'Sports' );
		expect( tokenNames() ).toEqual( [ 'Sports' ] );
		expect( onChange ).toHaveBeenLastCalledWith( [ 2 ] );
	} );

	it( 'keeps a selected category no response has described', () => {
		const onChange = jest.fn();
		render(
			<Harness
				initial={ [ 42 ] }
				categories={ multilingual }
				onChange={ onChange }
			/>
		);
		expect( tokenNames() ).toEqual( [ 'Category ID 42' ] );

		// An unrelated selection keeps the undescribed category.
		type( 'Music' );
		expect( onChange ).toHaveBeenLastCalledWith( [ 42, 3 ] );
	} );

	it( 'ignores unknown names when creation is not offered', () => {
		const onChange = jest.fn();
		render( <Harness categories={ multilingual } onChange={ onChange } /> );
		type( 'Nonexistent' );
		expect( tokenNames() ).toEqual( [] );
		expect( onChange ).not.toHaveBeenCalled();
	} );

	describe( 'creation', () => {
		it( 'creates an unknown name once and selects the returned ID', async () => {
			const request = deferred();
			const onCreate = jest.fn( () => request.promise );
			const onChange = jest.fn();
			render(
				<Harness
					initial={ [ 1 ] }
					categories={ multilingual }
					onChange={ onChange }
					onCreate={ onCreate }
				/>
			);

			type( 'Workshops' );
			expect( tokenNames() ).toEqual( [
				'Arancha — English',
				'Workshops',
			] );
			// Re-adding the pending name does not repeat the request.
			removeToken( 'Workshops' );
			type( 'Workshops' );
			await act( async () => {} );
			expect( onCreate ).toHaveBeenCalledTimes( 1 );
			expect( onCreate ).toHaveBeenCalledWith( 'Workshops' );

			await act( async () => {
				request.resolve( { id: 9, name: 'Workshops' } );
			} );
			expect( tokenNames() ).toEqual( [
				'Arancha — English',
				'Workshops',
			] );
			expect( onChange ).toHaveBeenLastCalledWith( [ 1, 9 ] );
		} );

		it( 'does not reselect a pending token the user removed', async () => {
			const request = deferred();
			const onChange = jest.fn();
			render(
				<Harness
					categories={ multilingual }
					onChange={ onChange }
					onCreate={ () => request.promise }
				/>
			);

			type( 'Workshops' );
			removeToken( 'Workshops' );
			await act( async () => {
				request.resolve( { id: 9, name: 'Workshops' } );
			} );
			expect( tokenNames() ).toEqual( [] );
			expect( onChange ).toHaveBeenLastCalledWith( [] );
		} );

		it( 'drops the pending token when creation fails', async () => {
			const request = deferred();
			const onChange = jest.fn();
			render(
				<Harness
					initial={ [ 3 ] }
					categories={ multilingual }
					onChange={ onChange }
					onCreate={ () => request.promise }
				/>
			);

			type( 'Workshops' );
			await act( async () => {
				request.reject( new Error( 'nope' ) );
			} );
			expect( tokenNames() ).toEqual( [ 'Music' ] );
			expect( onChange ).toHaveBeenLastCalledWith( [ 3 ] );
		} );
	} );
} );
