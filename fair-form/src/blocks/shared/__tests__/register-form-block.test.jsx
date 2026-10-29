/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

const mockRegistered = {};
jest.mock( '@wordpress/blocks', () => ( {
	registerBlockType: ( name, settings ) => {
		mockRegistered[ name ] = settings;
		return { name, ...settings };
	},
	createBlock: ( name, attributes, innerBlocks ) => ( {
		name,
		attributes,
		innerBlocks,
	} ),
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	store: 'core/block-editor',
} ) );

const mockEditor = {};
jest.mock( '@wordpress/data', () => ( {
	useSelect: ( mapSelect ) =>
		typeof mapSelect === 'function'
			? mapSelect( () => mockEditor.selectors )
			: mockEditor.selectors,
	useDispatch: () => mockEditor.actions,
} ) );

import {
	registerFormBlockType,
	toCanonicalFormBlock,
} from '../register-form-block.js';

const legacyForm = {
	clientId: 'form',
	name: 'fair-audience/fair-form',
	attributes: { formId: 'f-1' },
	innerBlocks: [
		{
			clientId: 'paragraph',
			name: 'core/paragraph',
			attributes: { content: 'Intro' },
			innerBlocks: [],
		},
		{
			clientId: 'conditional',
			name: 'fair-audience/fair-form-conditional',
			attributes: { conditionQuestionKey: 'size' },
			innerBlocks: [
				{
					clientId: 'select',
					name: 'fair-audience/fair-form-select-one',
					attributes: { questionKey: 'size' },
					innerBlocks: [
						{
							clientId: 'option',
							name: 'fair-audience/fair-form-option',
							attributes: { value: 'S' },
							innerBlocks: [],
						},
					],
				},
			],
		},
		{
			clientId: 'email',
			name: 'fair-form/fair-form-email',
			attributes: { questionKey: 'email' },
			innerBlocks: [],
		},
	],
};

const canonicalForm = {
	name: 'fair-form/fair-form',
	attributes: { formId: 'f-1' },
	innerBlocks: [
		{
			name: 'core/paragraph',
			attributes: { content: 'Intro' },
			innerBlocks: [],
		},
		{
			name: 'fair-form/fair-form-conditional',
			attributes: { conditionQuestionKey: 'size' },
			innerBlocks: [
				{
					name: 'fair-form/fair-form-select-one',
					attributes: { questionKey: 'size' },
					innerBlocks: [
						{
							name: 'fair-form/fair-form-option',
							attributes: { value: 'S' },
							innerBlocks: [],
						},
					],
				},
			],
		},
		{
			name: 'fair-form/fair-form-email',
			attributes: { questionKey: 'email' },
			innerBlocks: [],
		},
	],
};

/**
 * Point the mocked block editor at a tree: `parents` maps a client ID to
 * its parent's client ID and `blocks` maps client IDs to blocks.
 *
 * @param {Object}  options
 * @param {Object}  options.blocks    Blocks by client ID.
 * @param {Object}  options.parents   Parent client ID by client ID.
 * @param {boolean} options.canInsert Whether the canonical block may go there.
 */
function setEditor( { blocks, parents = {}, canInsert = true } ) {
	mockEditor.canInsert = canInsert;
	mockEditor.selectors = {
		getBlock: ( clientId ) => blocks[ clientId ] ?? null,
		getBlockName: ( clientId ) => blocks[ clientId ]?.name ?? null,
		getBlockRootClientId: ( clientId ) => parents[ clientId ] ?? null,
		canInsertBlockType: jest.fn( () => mockEditor.canInsert ),
	};
	mockEditor.actions = {
		replaceBlocks: jest.fn(),
		__unstableMarkNextChangeAsNotPersistent: jest.fn(),
	};
}

describe( 'registerFormBlockType', () => {
	const edit = ( { clientId } ) => <p>Edit { clientId }</p>;
	const save = () => null;

	beforeAll( () => {
		registerFormBlockType( 'fair-form-select-one', { edit, save } );
		registerFormBlockType( 'fair-form-future-type', { edit, save } );
	} );

	it( 'registers the canonical block with its settings unchanged', () => {
		expect( mockRegistered[ 'fair-form/fair-form-select-one' ] ).toEqual( {
			edit,
			save,
		} );
	} );

	it( 'registers the legacy alias with the same save and a wrapped edit', () => {
		const alias = mockRegistered[ 'fair-audience/fair-form-select-one' ];
		expect( alias.save ).toBe( save );
		expect( alias.edit ).not.toBe( edit );
	} );

	it( 'registers no legacy alias for a block type added after the rename', () => {
		expect(
			mockRegistered[ 'fair-form/fair-form-future-type' ]
		).toBeTruthy();
		expect(
			mockRegistered[ 'fair-audience/fair-form-future-type' ]
		).toBeUndefined();
	} );

	it( 'converts the outermost legacy block with everything nested in it', () => {
		const select = legacyForm.innerBlocks[ 1 ].innerBlocks[ 0 ];
		setEditor( { blocks: { select }, parents: { select: 'root' } } );
		mockEditor.selectors.getBlockName = ( clientId ) =>
			'root' === clientId
				? 'fair-form/fair-form-conditional'
				: select.name;

		const LegacyEdit =
			mockRegistered[ 'fair-audience/fair-form-select-one' ].edit;
		const { getByText } = render( <LegacyEdit clientId="select" /> );

		// Renders the canonical edit until the replacement lands.
		expect( getByText( 'Edit select' ) ).toBeInTheDocument();
		expect( mockEditor.selectors.canInsertBlockType ).toHaveBeenCalledWith(
			'fair-form/fair-form-select-one',
			'root'
		);
		expect(
			mockEditor.actions.__unstableMarkNextChangeAsNotPersistent
		).toHaveBeenCalled();
		expect( mockEditor.actions.replaceBlocks ).toHaveBeenCalledWith(
			'select',
			canonicalForm.innerBlocks[ 1 ].innerBlocks[ 0 ]
		);
	} );

	it( 'leaves a legacy block nested in a legacy parent to the parent', () => {
		const select = legacyForm.innerBlocks[ 1 ].innerBlocks[ 0 ];
		setEditor( {
			blocks: { select, conditional: legacyForm.innerBlocks[ 1 ] },
			parents: { select: 'conditional' },
		} );

		const LegacyEdit =
			mockRegistered[ 'fair-audience/fair-form-select-one' ].edit;
		render( <LegacyEdit clientId="select" /> );

		expect( mockEditor.actions.replaceBlocks ).not.toHaveBeenCalled();
	} );

	it( 'keeps the legacy block where the canonical one is not allowed', () => {
		const select = legacyForm.innerBlocks[ 1 ].innerBlocks[ 0 ];
		setEditor( {
			blocks: { select },
			parents: { select: 'signup' },
			canInsert: false,
		} );
		mockEditor.selectors.getBlockName = ( clientId ) =>
			'signup' === clientId ? 'fair-events/event-signup' : select.name;

		const LegacyEdit =
			mockRegistered[ 'fair-audience/fair-form-select-one' ].edit;
		const { rerender } = render( <LegacyEdit clientId="select" /> );

		expect( mockEditor.actions.replaceBlocks ).not.toHaveBeenCalled();
		expect(
			mockEditor.actions.__unstableMarkNextChangeAsNotPersistent
		).not.toHaveBeenCalled();

		// The parent's allow-list can be registered after the block mounts.
		mockEditor.canInsert = true;
		rerender( <LegacyEdit clientId="select" /> );

		expect( mockEditor.actions.replaceBlocks ).toHaveBeenCalledTimes( 1 );
		expect( mockEditor.actions.replaceBlocks ).toHaveBeenCalledWith(
			'select',
			canonicalForm.innerBlocks[ 1 ].innerBlocks[ 0 ]
		);
	} );
} );

describe( 'toCanonicalFormBlock', () => {
	it( 'renames legacy blocks at every depth and keeps attributes and other blocks', () => {
		expect( toCanonicalFormBlock( legacyForm ) ).toEqual( canonicalForm );
	} );
} );
