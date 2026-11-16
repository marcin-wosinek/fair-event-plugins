/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import TagField from '../TagField.js';

const tags = [ 'catering', 'travel', 'venue' ];

describe( 'TagField', () => {
	it( 'renders a text input', () => {
		render( <TagField value="" tags={ tags } onChange={ jest.fn() } /> );
		expect(
			screen.getByRole( 'textbox', { name: /tag/i } )
		).toBeInTheDocument();
	} );

	it( 'calls onChange when typing', () => {
		const onChange = jest.fn();
		render( <TagField value="" tags={ tags } onChange={ onChange } /> );
		fireEvent.change( screen.getByRole( 'textbox', { name: /tag/i } ), {
			target: { value: 'cat' },
		} );
		expect( onChange ).toHaveBeenCalledWith( 'cat' );
	} );

	it( 'shows matching suggestions when focused and value matches', () => {
		render( <TagField value="ca" tags={ tags } onChange={ jest.fn() } /> );
		fireEvent.focus( screen.getByRole( 'textbox', { name: /tag/i } ) );
		expect( screen.getByText( 'catering' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'travel' ) ).not.toBeInTheDocument();
	} );

	it( 'calls onChange with suggestion value on mousedown', () => {
		const onChange = jest.fn();
		render( <TagField value="ca" tags={ tags } onChange={ onChange } /> );
		fireEvent.focus( screen.getByRole( 'textbox', { name: /tag/i } ) );
		fireEvent.mouseDown( screen.getByText( 'catering' ) );
		expect( onChange ).toHaveBeenCalledWith( 'catering' );
	} );

	it( 'does not show the current value as a suggestion', () => {
		render(
			<TagField value="catering" tags={ tags } onChange={ jest.fn() } />
		);
		fireEvent.focus( screen.getByRole( 'textbox', { name: /tag/i } ) );
		// "catering" matches but equals value — should not appear
		expect( screen.queryByText( 'catering' ) ).not.toBeInTheDocument();
	} );

	it( 'shows no suggestions when tags list is empty', () => {
		render( <TagField value="cat" tags={ [] } onChange={ jest.fn() } /> );
		fireEvent.focus( screen.getByRole( 'textbox', { name: /tag/i } ) );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );

	const renderControlled = ( initial = '' ) => {
		const onChange = jest.fn();
		const Wrapper = () => {
			const [ value, setValue ] = useState( initial );
			return (
				<>
					<TagField
						value={ value }
						tags={ tags }
						onChange={ ( v ) => {
							onChange( v );
							setValue( v );
						} }
					/>
					<button type="button">Outside</button>
				</>
			);
		};
		render( <Wrapper /> );
		return {
			onChange,
			input: screen.getByRole( 'textbox', { name: /tag/i } ),
		};
	};

	it( 'keeps suggestions open while focus moves to one with the keyboard', () => {
		const { input } = renderControlled( 'ca' );
		fireEvent.focus( input );
		const suggestion = screen.getByRole( 'button', { name: 'catering' } );

		fireEvent.blur( input, { relatedTarget: suggestion } );

		expect(
			screen.getByRole( 'button', { name: 'catering' } )
		).toBeInTheDocument();
	} );

	it( 'selects a suggestion with Enter and returns focus to the field', () => {
		const { input, onChange } = renderControlled( 'ca' );
		fireEvent.focus( input );
		const suggestion = screen.getByRole( 'button', { name: 'catering' } );
		fireEvent.blur( input, { relatedTarget: suggestion } );
		suggestion.focus();

		fireEvent.keyDown( suggestion, { key: 'Enter' } );

		expect( onChange ).toHaveBeenLastCalledWith( 'catering' );
		expect( input ).toHaveValue( 'catering' );
		expect( input ).toHaveFocus();
		expect(
			screen.queryByRole( 'button', { name: 'catering' } )
		).not.toBeInTheDocument();
	} );

	it( 'closes suggestions when focus leaves the field', () => {
		const { input } = renderControlled( 'ca' );
		fireEvent.focus( input );

		fireEvent.blur( input, {
			relatedTarget: screen.getByRole( 'button', { name: 'Outside' } ),
		} );

		expect(
			screen.queryByRole( 'button', { name: 'catering' } )
		).not.toBeInTheDocument();
	} );

	it( 'closes suggestions on Escape without letting it reach a modal', () => {
		const onParentKeyDown = jest.fn();
		render(
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div onKeyDown={ onParentKeyDown }>
				<TagField value="ca" tags={ tags } onChange={ jest.fn() } />
			</div>
		);
		const input = screen.getByRole( 'textbox', { name: /tag/i } );
		fireEvent.focus( input );

		fireEvent.keyDown( input, { key: 'Escape' } );

		expect(
			screen.queryByRole( 'button', { name: 'catering' } )
		).not.toBeInTheDocument();
		expect( onParentKeyDown ).not.toHaveBeenCalled();

		// With the list closed, Escape is left for the modal to handle.
		fireEvent.keyDown( input, { key: 'Escape' } );
		expect( onParentKeyDown ).toHaveBeenCalled();
	} );
} );
