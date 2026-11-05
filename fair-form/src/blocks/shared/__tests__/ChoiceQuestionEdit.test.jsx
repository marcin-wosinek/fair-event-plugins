/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// eslint-disable-next-line import/first
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( callback ) => callback( () => ( { getBlockCount: () => 2 } ) ),
} ) );

const mockInnerBlocksSettings = [];
jest.mock( '@wordpress/block-editor', () => {
	const ButtonBlockAppender = () => null;
	return {
		useBlockProps: ( props ) => ( {
			...props,
			'data-testid': 'question',
		} ),
		useInnerBlocksProps: ( props, settings ) => {
			mockInnerBlocksSettings.push( settings );
			return { ...props, 'data-testid': 'typed-options' };
		},
		InspectorControls: ( { children } ) => children,
		InnerBlocks: Object.assign( () => null, {
			Content: () => null,
			ButtonBlockAppender,
		} ),
	};
} );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { title, children } ) => (
		<section aria-label={ title }>{ children }</section>
	),
	TextControl: ( { label, value, onChange } ) => (
		<label>
			{ label }
			<input
				value={ value }
				onChange={ ( e ) => onChange( e.target.value ) }
			/>
		</label>
	),
	ToggleControl: ( { label, checked, onChange } ) => (
		<label>
			{ label }
			<input
				type="checkbox"
				checked={ checked }
				onChange={ ( e ) => onChange( e.target.checked ) }
			/>
		</label>
	),
	SelectControl: ( { label, value, options, onChange } ) => (
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
	),
	ComboboxControl: () => null,
	Notice: ( { children } ) => <div>{ children }</div>,
	Button: ( { children } ) => <button>{ children }</button>,
	Spinner: () => null,
} ) );

jest.mock( 'fair-events-shared/src/questionnaire.js', () => ( {
	autosizeTextarea: () => {},
} ) );

// eslint-disable-next-line import/first
import { InnerBlocks } from '@wordpress/block-editor';
// eslint-disable-next-line import/first
import {
	ChoiceQuestionEdit,
	CategoryChoiceQuestionEdit,
	questionTextUpdates,
} from '../ChoiceQuestionEdit.js';

const baseAttributes = {
	questionText: 'Which group?',
	questionKey: 'which_group',
	required: false,
};

const typeQuestion = ( value ) =>
	fireEvent.change( screen.getByPlaceholderText( 'Enter your question...' ), {
		target: { value },
	} );

describe( 'questionTextUpdates', () => {
	it( 'generates a key when there is none', () => {
		expect(
			questionTextUpdates(
				{ questionText: '', questionKey: '' },
				'Your T-shirt size?'
			)
		).toEqual( {
			questionText: 'Your T-shirt size?',
			questionKey: 'your_tshirt_size',
		} );
	} );

	it( 'keeps following the text while the key is the generated one', () => {
		expect(
			questionTextUpdates( baseAttributes, 'Which group do you join?' )
		).toEqual( {
			questionText: 'Which group do you join?',
			questionKey: 'which_group_do_you_join',
		} );
	} );

	it( 'keeps a customized key', () => {
		expect(
			questionTextUpdates(
				{ ...baseAttributes, questionKey: 'group' },
				'Which group do you join?'
			)
		).toEqual( { questionText: 'Which group do you join?' } );
	} );
} );

describe( 'ChoiceQuestionEdit', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		mockInnerBlocksSettings.length = 0;
	} );

	it( 'names the question type on the wrapper', () => {
		render(
			<ChoiceQuestionEdit
				attributes={ baseAttributes }
				setAttributes={ () => {} }
				className="fair-form-question-radio"
			/>
		);
		expect( screen.getByTestId( 'question' ) ).toHaveClass(
			'fair-form-question',
			'fair-form-question-radio'
		);
	} );

	it( 'updates the label and the generated key together', () => {
		const setAttributes = jest.fn();
		render(
			<ChoiceQuestionEdit
				attributes={ baseAttributes }
				setAttributes={ setAttributes }
				className="fair-form-question-radio"
			/>
		);
		typeQuestion( 'Which team?' );
		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Which team?',
			questionKey: 'which_team',
		} );
	} );

	it( 'keeps a customized key when the label changes', () => {
		const setAttributes = jest.fn();
		render(
			<ChoiceQuestionEdit
				attributes={ { ...baseAttributes, questionKey: 'team' } }
				setAttributes={ setAttributes }
				className="fair-form-question-radio"
			/>
		);
		typeQuestion( 'Which team?' );
		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Which team?',
		} );
	} );

	it( 'edits the key and the required setting', () => {
		const setAttributes = jest.fn();
		const { rerender } = render(
			<ChoiceQuestionEdit
				attributes={ baseAttributes }
				setAttributes={ setAttributes }
				className="fair-form-question-radio"
			/>
		);
		expect( screen.queryByText( '*' ) ).not.toBeInTheDocument();

		fireEvent.change( screen.getByLabelText( 'Question Key' ), {
			target: { value: 'team' },
		} );
		expect( setAttributes ).toHaveBeenCalledWith( { questionKey: 'team' } );

		fireEvent.click( screen.getByLabelText( 'Required' ) );
		expect( setAttributes ).toHaveBeenCalledWith( { required: true } );

		rerender(
			<ChoiceQuestionEdit
				attributes={ { ...baseAttributes, required: true } }
				setAttributes={ setAttributes }
				className="fair-form-question-radio"
			/>
		);
		expect( screen.getByText( '*' ) ).toHaveClass( 'required' );
		expect( screen.getByLabelText( 'Required' ) ).toBeChecked();
	} );

	it( 'offers only option blocks as typed options', () => {
		render(
			<ChoiceQuestionEdit
				attributes={ baseAttributes }
				setAttributes={ () => {} }
				className="fair-form-question-radio"
			/>
		);
		expect( screen.getByTestId( 'typed-options' ) ).toHaveClass(
			'fair-form-options-list'
		);
		expect( mockInnerBlocksSettings[ 0 ] ).toEqual( {
			allowedBlocks: [ 'fair-form/fair-form-option' ],
			renderAppender: InnerBlocks.ButtonBlockAppender,
		} );
		expect(
			screen.queryByLabelText( 'Where do the choices come from?' )
		).not.toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );
} );

describe( 'CategoryChoiceQuestionEdit', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		mockInnerBlocksSettings.length = 0;
		apiFetch.mockResolvedValue( {
			headers: { get: () => '1' },
			json: async () => [
				{ id: 10, name: 'Workshops', parent: 0 },
				{ id: 11, name: 'Juggling', parent: 10 },
			],
		} );
	} );

	const renderEdit = ( attributes, setAttributes = () => {} ) => (
		<CategoryChoiceQuestionEdit
			attributes={ { ...baseAttributes, ...attributes } }
			setAttributes={ setAttributes }
			clientId="q-1"
			className="fair-form-question-select-one"
		/>
	);

	it( 'shares the question settings and adds the choice source', () => {
		render( renderEdit( { optionSource: 'manual' } ) );
		expect( screen.getByLabelText( 'Question Key' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Required' ) ).toBeInTheDocument();
		expect(
			screen.getByLabelText( 'Where do the choices come from?' )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'typed-options' ) ).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'switches sources without touching the typed options', async () => {
		const setAttributes = jest.fn();
		const { rerender } = render(
			renderEdit( { optionSource: 'manual' }, setAttributes )
		);

		fireEvent.change(
			screen.getByLabelText( 'Where do the choices come from?' ),
			{ target: { value: 'categories' } }
		);
		expect( setAttributes ).toHaveBeenCalledWith( {
			optionSource: 'categories',
		} );

		rerender( renderEdit( { optionSource: 'categories' }, setAttributes ) );
		await waitFor( () =>
			expect( screen.getByText( 'Juggling' ) ).toBeInTheDocument()
		);
		expect(
			screen.queryByTestId( 'typed-options' )
		).not.toBeInTheDocument();
		expect(
			screen.getByText( /Your 2 typed options are kept/ )
		).toBeInTheDocument();

		rerender( renderEdit( { optionSource: 'manual' }, setAttributes ) );
		expect( screen.getByTestId( 'typed-options' ) ).toBeInTheDocument();
		// Only the source changed; nothing replaced the nested options.
		expect( setAttributes ).toHaveBeenCalledTimes( 1 );
	} );
} );
