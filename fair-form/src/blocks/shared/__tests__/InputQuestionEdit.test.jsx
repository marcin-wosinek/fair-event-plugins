/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: ( props ) => ( { ...props, 'data-testid': 'question' } ),
	InspectorControls: ( { children } ) => children,
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { title, children } ) => (
		<section aria-label={ title }>{ children }</section>
	),
	TextControl: ( { label, value, onChange, help } ) => (
		<div>
			<label>
				{ label }
				<input
					value={ value }
					onChange={ ( e ) => onChange( e.target.value ) }
				/>
			</label>
			{ help }
		</div>
	),
	ToggleControl: ( { label, checked, onChange } ) => (
		<label>
			<input
				type="checkbox"
				checked={ checked }
				onChange={ ( e ) => onChange( e.target.checked ) }
			/>
			{ label }
		</label>
	),
} ) );

const mockAutosize = jest.fn();
jest.mock( 'fair-events-shared/src/questionnaire.js', () => ( {
	autosizeTextarea: ( ...args ) => mockAutosize( ...args ),
} ) );

// eslint-disable-next-line import/first
import { InputQuestionEdit } from '../InputQuestionEdit.js';

const baseAttributes = {
	questionText: '',
	questionKey: '',
	required: false,
	placeholder: '',
};

const renderEdit = ( props = {}, attributes = {}, setAttributes = jest.fn() ) =>
	render(
		<InputQuestionEdit
			attributes={ { ...baseAttributes, ...attributes } }
			setAttributes={ setAttributes }
			className="fair-form-question-test"
			inputType="email"
			keyHelp="Key help"
			{ ...props }
		/>
	);

const typeQuestion = ( value ) =>
	fireEvent.change( screen.getByPlaceholderText( 'Enter your question...' ), {
		target: { value },
	} );

describe( 'InputQuestionEdit', () => {
	beforeEach( () => mockAutosize.mockReset() );

	it( 'wraps the question in the shared and type classes', () => {
		renderEdit();

		expect( screen.getByTestId( 'question' ) ).toHaveClass(
			'fair-form-question',
			'fair-form-question-test'
		);
	} );

	it( 'generates the key from the question text when there is none', () => {
		const setAttributes = jest.fn();
		renderEdit( {}, {}, setAttributes );

		typeQuestion( 'Your email' );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Your email',
			questionKey: 'your_email',
		} );
	} );

	it( 'keeps following the text while the key is the generated one', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{},
			{ questionText: 'Your email', questionKey: 'your_email' },
			setAttributes
		);

		typeQuestion( 'Your work email' );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Your work email',
			questionKey: 'your_work_email',
		} );
	} );

	it( 'keeps a customized key', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{},
			{ questionText: 'Your email', questionKey: 'contact' },
			setAttributes
		);

		typeQuestion( 'Your work email' );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Your work email',
		} );
	} );

	it( 'edits the question key, required flag and placeholder', () => {
		const setAttributes = jest.fn();
		renderEdit( {}, {}, setAttributes );

		fireEvent.change( screen.getByLabelText( 'Question Key' ), {
			target: { value: 'contact' },
		} );
		fireEvent.click( screen.getByLabelText( 'Required' ) );
		fireEvent.change( screen.getByLabelText( 'Placeholder' ), {
			target: { value: 'name@example.com' },
		} );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionKey: 'contact',
		} );
		expect( setAttributes ).toHaveBeenCalledWith( { required: true } );
		expect( setAttributes ).toHaveBeenCalledWith( {
			placeholder: 'name@example.com',
		} );
		expect( screen.getByText( 'Key help' ) ).toBeInTheDocument();
	} );

	it( 'marks required questions', () => {
		const { container, rerender } = renderEdit();
		expect( container.querySelector( '.required' ) ).toBeNull();

		rerender(
			<InputQuestionEdit
				attributes={ { ...baseAttributes, required: true } }
				setAttributes={ jest.fn() }
				className="fair-form-question-test"
				inputType="email"
				keyHelp="Key help"
			/>
		);
		expect( container.querySelector( '.required' ) ).toHaveTextContent(
			'*'
		);
	} );

	it( 'previews a disabled native input of the given type', () => {
		const { container } = renderEdit( { inputType: 'datetime-local' } );

		const preview = container.querySelector(
			'input[type="datetime-local"]'
		);
		expect( preview ).toBeDisabled();
	} );

	it( 'previews the placeholder, falling back to the type default', () => {
		const { container, rerender } = renderEdit( {
			previewPlaceholder: 'your@email.com',
		} );
		const preview = () => container.querySelector( 'input[disabled]' );
		expect( preview() ).toHaveAttribute( 'placeholder', 'your@email.com' );

		rerender(
			<InputQuestionEdit
				attributes={ { ...baseAttributes, placeholder: 'Work email' } }
				setAttributes={ jest.fn() }
				className="fair-form-question-test"
				inputType="email"
				keyHelp="Key help"
				previewPlaceholder="your@email.com"
			/>
		);
		expect( preview() ).toHaveAttribute( 'placeholder', 'Work email' );
	} );

	it( 'edits the label in a single-line input by default', () => {
		renderEdit();

		const label = screen.getByPlaceholderText( 'Enter your question...' );
		expect( label.tagName ).toBe( 'INPUT' );
		expect( label ).toHaveAttribute( 'type', 'text' );
		expect( label ).toHaveClass( 'fair-form-question-label-input' );
	} );

	it( 'edits a multiline label in an autosizing textarea', () => {
		const setAttributes = jest.fn();
		const { container } = renderEdit(
			{ multilineLabel: true },
			{ required: true },
			setAttributes
		);

		const label = screen.getByPlaceholderText( 'Enter your question...' );
		expect( label.tagName ).toBe( 'TEXTAREA' );
		expect(
			container.querySelector(
				'.fair-form-question-header > textarea + .required'
			)
		).toBeInTheDocument();

		mockAutosize.mockClear();
		typeQuestion( 'Favorite color' );

		expect( mockAutosize ).toHaveBeenCalledWith( label );
		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Favorite color',
			questionKey: 'favorite_color',
		} );
	} );
} );
