/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// eslint-disable-next-line import/first
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( callback ) => callback( () => ( { getBlockCount: () => 2 } ) ),
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: ( props ) => props || {},
	useInnerBlocksProps: ( props ) => ( {
		...props,
		'data-testid': 'typed-options',
	} ),
	InspectorControls: ( { children } ) => children,
	InnerBlocks: Object.assign( () => null, {
		Content: () => null,
		ButtonBlockAppender: () => null,
	} ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
	TextControl: () => null,
	ToggleControl: () => null,
	SelectControl: ( { label, value, options } ) => (
		<label>
			{ label }
			<select value={ value } onChange={ () => {} }>
				{ options.map( ( opt ) => (
					<option key={ opt.value } value={ opt.value }>
						{ opt.label }
					</option>
				) ) }
			</select>
		</label>
	),
	ComboboxControl: () => null,
	Notice: ( { children } ) => <div>{ children }</div>,
	Button: ( { children } ) => <button>{ children }</button>,
	Spinner: () => null,
} ) );

jest.mock( 'fair-events-shared/src/questionnaire.js', () => ( {
	autosizeTextarea: () => {},
} ) );

jest.mock( 'fair-events-shared/src/question-utils.js', () => ( {
	generateQuestionKey: ( text ) => text,
} ) );

let capturedSettings;
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		capturedSettings = settings;
	},
	createBlock: ( name, attributes, innerBlocks ) => ( {
		name,
		attributes,
		innerBlocks,
	} ),
} ) );

describe( 'Fair Form Select One Question', () => {
	let Edit;
	const transformTo = ( blockName ) =>
		capturedSettings.transforms.to.find( ( t ) =>
			t.blocks.includes( blockName )
		);

	beforeAll( () => {
		require( '../editor.js' );
		Edit = capturedSettings.edit;
	} );

	beforeEach( () => apiFetch.mockReset() );

	const baseAttributes = {
		questionText: 'Which group?',
		questionKey: 'group',
		required: false,
		optionSource: 'manual',
		parentCategoryId: 0,
	};

	it( 'shows the typed options and loads no categories in manual mode', () => {
		render(
			<Edit
				attributes={ baseAttributes }
				setAttributes={ () => {} }
				clientId="q-1"
			/>
		);
		expect( screen.getByTestId( 'typed-options' ) ).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'previews category choices and keeps the typed options aside', async () => {
		apiFetch.mockResolvedValue( {
			headers: { get: () => '1' },
			json: async () => [
				{ id: 10, name: 'Workshops', parent: 0 },
				{ id: 11, name: 'Juggling', parent: 10 },
			],
		} );
		render(
			<Edit
				attributes={ {
					...baseAttributes,
					optionSource: 'categoryChildren',
					parentCategoryId: 10,
				} }
				setAttributes={ () => {} }
				clientId="q-1"
			/>
		);

		await waitFor( () =>
			expect( screen.getByText( 'Juggling' ) ).toBeInTheDocument()
		);
		expect( screen.queryByText( 'Workshops' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByTestId( 'typed-options' )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /Your 2 typed options are kept/ )
		).toBeInTheDocument();
	} );

	it( 'carries the option source into a Multiselect question', () => {
		const attributes = {
			...baseAttributes,
			optionSource: 'categoryChildren',
			parentCategoryId: 10,
		};
		const innerBlocks = [ { name: 'fair-audience/fair-form-option' } ];
		const block = transformTo(
			'fair-audience/fair-form-multiselect'
		).transform( attributes, innerBlocks );

		expect( block.attributes ).toMatchObject( {
			optionSource: 'categoryChildren',
			parentCategoryId: 10,
		} );
		expect( block.innerBlocks ).toBe( innerBlocks );
	} );

	it( 'offers the radio transform only for typed options', () => {
		const toRadio = transformTo( 'fair-audience/fair-form-radio' );
		expect( toRadio.isMatch( baseAttributes ) ).toBe( true );
		expect( toRadio.isMatch( {} ) ).toBe( true );
		expect(
			toRadio.isMatch( { ...baseAttributes, optionSource: 'categories' } )
		).toBe( false );
		expect(
			toRadio.isMatch( {
				...baseAttributes,
				optionSource: 'categoryChildren',
			} )
		).toBe( false );
	} );
} );
