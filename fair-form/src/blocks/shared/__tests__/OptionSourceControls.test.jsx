/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
	SelectControl: ( { label, value, options, onChange, help } ) => (
		<div>
			<label>
				{ label }
				<select
					value={ value }
					onChange={ ( e ) => onChange( e.target.value ) }
				>
					{ options.map( ( opt ) => (
						<option key={ opt.value } value={ opt.value }>
							{ opt.label }
						</option>
					) ) }
				</select>
			</label>
			{ help }
		</div>
	),
	ComboboxControl: ( { label, value, options, onChange } ) => (
		<label>
			{ label }
			<select
				value={ value }
				onChange={ ( e ) => onChange( e.target.value ) }
			>
				<option value="" />
				{ options.map( ( opt ) => (
					<option key={ opt.value } value={ opt.value }>
						{ opt.label }
					</option>
				) ) }
			</select>
		</label>
	),
	Notice: ( { status, children } ) => (
		<div data-status={ status }>{ children }</div>
	),
	Button: ( { children, onClick } ) => (
		<button onClick={ onClick }>{ children }</button>
	),
	Spinner: () => <span>spinner</span>,
} ) );

// eslint-disable-next-line import/first
import {
	OptionSourcePanel,
	CategoryChoicesPreview,
} from '../OptionSourceControls.js';

const CATEGORIES = [
	{ id: 10, name: 'Workshops', parent: 0 },
	{ id: 11, name: 'Juggling', parent: 10 },
	{ id: 20, name: 'Empty parent', parent: 0 },
];

const loaded = ( categories = CATEGORIES ) => ( {
	status: 'success',
	categories,
	retry: jest.fn(),
} );

describe( 'OptionSourcePanel', () => {
	it( 'switches the source without touching anything else', () => {
		const setAttributes = jest.fn();
		render(
			<OptionSourcePanel
				attributes={ { optionSource: 'manual' } }
				setAttributes={ setAttributes }
				categoriesState={ loaded() }
			/>
		);

		fireEvent.change(
			screen.getByLabelText( 'Where do the choices come from?' ),
			{ target: { value: 'categoryChildren' } }
		);

		expect( setAttributes ).toHaveBeenCalledWith( {
			optionSource: 'categoryChildren',
		} );
		expect(
			screen.queryByLabelText( 'Parent category' )
		).not.toBeInTheDocument();
	} );

	it( 'picks a parent by ID, labelling categories with their path', () => {
		const setAttributes = jest.fn();
		render(
			<OptionSourcePanel
				attributes={ {
					optionSource: 'categoryChildren',
					parentCategoryId: 0,
				} }
				setAttributes={ setAttributes }
				categoriesState={ loaded() }
			/>
		);

		const parent = screen.getByLabelText( 'Parent category' );
		expect(
			screen.getByRole( 'option', { name: 'Workshops › Juggling' } )
		).toBeInTheDocument();

		fireEvent.change( parent, { target: { value: '10' } } );
		expect( setAttributes ).toHaveBeenCalledWith( {
			parentCategoryId: 10,
		} );

		fireEvent.change( parent, { target: { value: '' } } );
		expect( setAttributes ).toHaveBeenLastCalledWith( {
			parentCategoryId: 0,
		} );
	} );

	it( 'explains how to reach radio buttons from a category source', () => {
		render(
			<OptionSourcePanel
				attributes={ { optionSource: 'categories' } }
				setAttributes={ () => {} }
				categoriesState={ loaded() }
			/>
		);
		expect(
			screen.getByText( /switch back to typed options first/ )
		).toBeInTheDocument();
	} );
} );

describe( 'CategoryChoicesPreview', () => {
	it( 'shows loading while categories load', () => {
		render(
			<CategoryChoicesPreview
				attributes={ { optionSource: 'categories' } }
				categoriesState={ {
					status: 'loading',
					categories: [],
					retry: jest.fn(),
				} }
			/>
		);
		expect( screen.getByText( 'Loading categories…' ) ).toBeInTheDocument();
	} );

	it( 'offers a retry when loading fails', () => {
		const retry = jest.fn();
		render(
			<CategoryChoicesPreview
				attributes={ { optionSource: 'categories' } }
				categoriesState={ { status: 'error', categories: [], retry } }
			/>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect( retry ).toHaveBeenCalled();
	} );

	it( 'warns about a missing parent instead of listing other categories', () => {
		render(
			<CategoryChoicesPreview
				attributes={ {
					optionSource: 'categoryChildren',
					parentCategoryId: 999,
				} }
				categoriesState={ loaded() }
			/>
		);
		expect(
			screen.getByText( /no longer exists/ ).closest( '[data-status]' )
		).toHaveAttribute( 'data-status', 'warning' );
		expect( screen.queryByText( 'Workshops' ) ).not.toBeInTheDocument();
	} );

	it( 'asks for a parent before one is chosen', () => {
		render(
			<CategoryChoicesPreview
				attributes={ {
					optionSource: 'categoryChildren',
					parentCategoryId: 0,
				} }
				categoriesState={ loaded() }
			/>
		);
		expect(
			screen.getByText( /Choose a parent category/ )
		).toBeInTheDocument();
	} );

	it( 'explains an empty subcategory group', () => {
		render(
			<CategoryChoicesPreview
				attributes={ {
					optionSource: 'categoryChildren',
					parentCategoryId: 20,
				} }
				categoriesState={ loaded() }
			/>
		);
		expect(
			screen.getByText( /has no subcategories yet/ )
		).toBeInTheDocument();
	} );

	it( 'previews the first ten choices with the total count', () => {
		const many = Array.from( { length: 12 }, ( _, i ) => ( {
			id: i + 1,
			name: `Category ${ String( i + 1 ).padStart( 2, '0' ) }`,
			parent: 0,
		} ) );
		render(
			<CategoryChoicesPreview
				attributes={ { optionSource: 'categories' } }
				categoriesState={ loaded( many ) }
			/>
		);
		expect(
			screen.getByText( '12 choices from categories:' )
		).toBeInTheDocument();
		expect( screen.getAllByRole( 'listitem' ) ).toHaveLength( 10 );
		expect( screen.getByText( '…and 2 more.' ) ).toBeInTheDocument();
	} );

	it( 'says typed options are kept while a category source is active', () => {
		render(
			<CategoryChoicesPreview
				attributes={ { optionSource: 'categories' } }
				categoriesState={ loaded() }
				manualOptionCount={ 3 }
			/>
		);
		expect(
			screen.getByText(
				'Your 3 typed options are kept. Switch back to typed options to use them again.'
			)
		).toBeInTheDocument();
	} );
} );
