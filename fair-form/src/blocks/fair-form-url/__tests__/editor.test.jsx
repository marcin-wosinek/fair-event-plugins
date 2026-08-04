/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@wordpress/block-editor', () => ({
	useBlockProps: (props) => props || {},
	InspectorControls: ({ children }) => children,
}));

jest.mock('@wordpress/components', () => ({
	PanelBody: ({ children }) => children,
	TextControl: ({ label, value, onChange, help }) => (
		<div>
			<label>
				{label}
				<input
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
			</label>
			{help}
		</div>
	),
	ToggleControl: ({ label, checked, onChange }) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			{label}
		</label>
	),
}));

jest.mock('fair-events-shared', () => ({
	generateQuestionKey: (text) =>
		text
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, ''),
}));

let capturedSettings;
jest.mock('@wordpress/blocks', () => ({
	registerBlockType: (name, settings) => {
		capturedSettings = settings;
	},
	createBlock: (name, attributes) => ({ name, attributes }),
}));

describe('Fair Form URL Question Edit', () => {
	let Edit;

	beforeAll(() => {
		require('../editor.js');
		Edit = capturedSettings.edit;
	});

	const baseAttributes = {
		questionText: '',
		questionKey: '',
		required: false,
		placeholder: '',
		extractEventDetails: false,
	};

	const renderEdit = (attributes = {}, setAttributes = () => {}) =>
		render(
			<Edit
				attributes={{ ...baseAttributes, ...attributes }}
				setAttributes={setAttributes}
			/>
		);

	it('derives the question key from the question text', () => {
		const setAttributes = jest.fn();
		renderEdit({}, setAttributes);

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change(questionTextInput, {
			target: { value: 'Portfolio website' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Portfolio website',
			questionKey: 'portfolio_website',
		});
	});

	it('does not override a manually-edited question key', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{ questionText: 'Website', questionKey: 'custom_key' },
			setAttributes
		);

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change(questionTextInput, {
			target: { value: 'Website updated' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Website updated',
		});
	});

	it('renders the Required toggle and Placeholder controls', () => {
		renderEdit();

		expect(screen.getByLabelText('Required')).toBeInTheDocument();
		expect(screen.getByLabelText('Placeholder')).toBeInTheDocument();
		expect(screen.getByLabelText('Question Key')).toBeInTheDocument();
	});

	it('renders the "Read event details from the linked page" toggle, off by default', () => {
		renderEdit();

		const toggle = screen.getByLabelText(
			'Read event details from the linked page'
		);
		expect(toggle).toBeInTheDocument();
		expect(toggle).not.toBeChecked();
	});

	it('toggles the extractEventDetails attribute', () => {
		const setAttributes = jest.fn();
		renderEdit({}, setAttributes);

		fireEvent.click(
			screen.getByLabelText('Read event details from the linked page')
		);

		expect(setAttributes).toHaveBeenCalledWith({
			extractEventDetails: true,
		});
	});

	it('toggles the required attribute', () => {
		const setAttributes = jest.fn();
		renderEdit({}, setAttributes);

		fireEvent.click(screen.getByLabelText('Required'));

		expect(setAttributes).toHaveBeenCalledWith({ required: true });
	});

	it('updates the placeholder attribute', () => {
		const setAttributes = jest.fn();
		renderEdit({}, setAttributes);

		fireEvent.change(screen.getByLabelText('Placeholder'), {
			target: { value: 'https://example.com' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			placeholder: 'https://example.com',
		});
	});

	it('transforms to short-text, preserving attributes', () => {
		const transform = capturedSettings.transforms.to.find((t) =>
			t.blocks.includes('fair-audience/fair-form-short-text')
		);

		const attributes = {
			questionText: 'Website',
			questionKey: 'website',
			required: true,
			placeholder: 'https://example.com',
		};

		expect(transform.transform(attributes)).toEqual({
			name: 'fair-audience/fair-form-short-text',
			attributes,
		});
	});
});
