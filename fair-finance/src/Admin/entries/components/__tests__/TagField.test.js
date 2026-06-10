/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import TagField from '../TagField.js';

const tags = ['catering', 'travel', 'venue'];

describe('TagField', () => {
	it('renders a text input', () => {
		render(<TagField value="" tags={tags} onChange={jest.fn()} />);
		expect(
			screen.getByRole('textbox', { name: /tag/i })
		).toBeInTheDocument();
	});

	it('calls onChange when typing', () => {
		const onChange = jest.fn();
		render(<TagField value="" tags={tags} onChange={onChange} />);
		fireEvent.change(screen.getByRole('textbox', { name: /tag/i }), {
			target: { value: 'cat' },
		});
		expect(onChange).toHaveBeenCalledWith('cat');
	});

	it('shows matching suggestions when focused and value matches', () => {
		render(<TagField value="ca" tags={tags} onChange={jest.fn()} />);
		fireEvent.focus(screen.getByRole('textbox', { name: /tag/i }));
		expect(screen.getByText('catering')).toBeInTheDocument();
		expect(screen.queryByText('travel')).not.toBeInTheDocument();
	});

	it('calls onChange with suggestion value on mousedown', () => {
		const onChange = jest.fn();
		render(<TagField value="ca" tags={tags} onChange={onChange} />);
		fireEvent.focus(screen.getByRole('textbox', { name: /tag/i }));
		fireEvent.mouseDown(screen.getByText('catering'));
		expect(onChange).toHaveBeenCalledWith('catering');
	});

	it('does not show the current value as a suggestion', () => {
		render(<TagField value="catering" tags={tags} onChange={jest.fn()} />);
		fireEvent.focus(screen.getByRole('textbox', { name: /tag/i }));
		// "catering" matches but equals value — should not appear
		expect(screen.queryByText('catering')).not.toBeInTheDocument();
	});

	it('shows no suggestions when tags list is empty', () => {
		render(<TagField value="cat" tags={[]} onChange={jest.fn()} />);
		fireEvent.focus(screen.getByRole('textbox', { name: /tag/i }));
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});
});
