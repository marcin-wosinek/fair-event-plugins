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
	useBlockProps: ( props ) => ( { ...props, 'data-testid': 'question' } ),
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
	...jest.requireActual( 'fair-events-shared/src/question-utils.js' ),
	generateQuestionKey: ( text ) => text,
} ) );

let capturedSettings;
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		// The legacy fair-audience alias is registered too; keep the
		// canonical block's settings.
		if ( name.startsWith( 'fair-form/' ) ) {
			capturedSettings = settings;
		}
	},
	createBlock: ( name, attributes, innerBlocks ) => ( {
		name,
		attributes,
		innerBlocks,
	} ),
} ) );

describe( 'Fair Form Radio Question', () => {
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
	};

	it( 'keeps its own wrapper and offers typed options only', () => {
		render(
			<Edit
				attributes={ baseAttributes }
				setAttributes={ () => {} }
				clientId="q-1"
			/>
		);
		expect( screen.getByTestId( 'question' ) ).toHaveClass(
			'fair-form-question',
			'fair-form-question-radio'
		);
		expect( screen.getByTestId( 'typed-options' ) ).toBeInTheDocument();
		expect(
			screen.queryByLabelText( 'Where do the choices come from?' )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'becomes a dropdown Select One question with its options', () => {
		const innerBlocks = [ { name: 'fair-form/fair-form-option' } ];
		const block = transformTo( 'fair-form/fair-form-select-one' ).transform(
			baseAttributes,
			innerBlocks
		);

		expect( block.name ).toBe( 'fair-form/fair-form-select-one' );
		expect( block.attributes ).toEqual( {
			...baseAttributes,
			displayAs: 'select',
		} );
		expect( block.innerBlocks ).toBe( innerBlocks );
	} );

	it( 'becomes a Multiselect question with its options', () => {
		const innerBlocks = [ { name: 'fair-form/fair-form-option' } ];
		const block = transformTo(
			'fair-form/fair-form-multiselect'
		).transform( baseAttributes, innerBlocks );

		expect( block.name ).toBe( 'fair-form/fair-form-multiselect' );
		expect( block.attributes ).toEqual( baseAttributes );
		expect( block.innerBlocks ).toBe( innerBlocks );
	} );
} );
