/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock( '@wordpress/block-editor', () => ( {
	useBlockProps: ( props ) => props || {},
	InspectorControls: ( { children } ) => children,
} ) );

jest.mock( '@wordpress/components', () => ( {
	PanelBody: ( { children } ) => children,
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

jest.mock( 'fair-events-shared/src/question-utils.js', () => ( {
	...jest.requireActual( 'fair-events-shared/src/question-utils.js' ),
	generateQuestionKey: ( text ) =>
		text
			.toLowerCase()
			.trim()
			.replace( /[^a-z0-9]+/g, '_' )
			.replace( /^_+|_+$/g, '' ),
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
} ) );

describe( 'Fair Form Email Question Edit', () => {
	let Edit;

	beforeAll( () => {
		require( '../editor.js' );
		Edit = capturedSettings.edit;
	} );

	const baseAttributes = {
		questionText: '',
		questionKey: '',
		required: false,
		placeholder: '',
	};

	const renderEdit = ( attributes = {}, setAttributes = () => {} ) =>
		render(
			<Edit
				attributes={ { ...baseAttributes, ...attributes } }
				setAttributes={ setAttributes }
			/>
		);

	it( 'derives the question key from the question text', () => {
		const setAttributes = jest.fn();
		renderEdit( {}, setAttributes );

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change( questionTextInput, {
			target: { value: 'Contact email' },
		} );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Contact email',
			questionKey: 'contact_email',
		} );
	} );

	it( 'does not override a manually-edited question key', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{ questionText: 'Email', questionKey: 'custom_key' },
			setAttributes
		);

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change( questionTextInput, {
			target: { value: 'Email updated' },
		} );

		expect( setAttributes ).toHaveBeenCalledWith( {
			questionText: 'Email updated',
		} );
	} );

	it( 'renders the Required toggle and Placeholder controls', () => {
		renderEdit();

		expect( screen.getByLabelText( 'Required' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Placeholder' ) ).toBeInTheDocument();
		expect( screen.getByLabelText( 'Question Key' ) ).toBeInTheDocument();
	} );

	it( 'renders a disabled native email input preview', () => {
		const { container } = renderEdit();

		const preview = container.querySelector( 'input[type="email"]' );
		expect( preview ).toBeDisabled();
		expect( preview ).toHaveAttribute( 'placeholder', 'your@email.com' );
		expect( preview.closest( '.fair-form-question-email' ) ).not.toBeNull();
	} );

	it( 'previews the configured placeholder instead of the default', () => {
		const { container } = renderEdit( { placeholder: 'Work email' } );

		expect(
			container.querySelector( 'input[type="email"]' )
		).toHaveAttribute( 'placeholder', 'Work email' );
	} );

	it( 'explains the question key with an email example', () => {
		renderEdit();

		expect(
			screen.getByText(
				'A unique identifier for this question (e.g. "email"). Used internally.'
			)
		).toBeInTheDocument();
	} );

	it( 'saves no markup', () => {
		expect( capturedSettings.save() ).toBeNull();
	} );

	it( 'toggles the required attribute', () => {
		const setAttributes = jest.fn();
		renderEdit( {}, setAttributes );

		fireEvent.click( screen.getByLabelText( 'Required' ) );

		expect( setAttributes ).toHaveBeenCalledWith( { required: true } );
	} );

	it( 'updates the placeholder attribute', () => {
		const setAttributes = jest.fn();
		renderEdit( {}, setAttributes );

		fireEvent.change( screen.getByLabelText( 'Placeholder' ), {
			target: { value: 'name@example.com' },
		} );

		expect( setAttributes ).toHaveBeenCalledWith( {
			placeholder: 'name@example.com',
		} );
	} );
} );
