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
	autosizeTextarea: () => {},
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

describe('Fair Form Short Text Question Edit', () => {
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
			target: { value: 'Favorite color' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Favorite color',
			questionKey: 'favorite_color',
		});
	});

	it('does not override a manually-edited question key', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{ questionText: 'Color', questionKey: 'custom_key' },
			setAttributes
		);

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change(questionTextInput, {
			target: { value: 'Color updated' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Color updated',
		});
	});

	it('renders the Required toggle and Placeholder controls', () => {
		renderEdit();

		expect(screen.getByLabelText('Required')).toBeInTheDocument();
		expect(screen.getByLabelText('Placeholder')).toBeInTheDocument();
		expect(screen.getByLabelText('Question Key')).toBeInTheDocument();
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
			target: { value: 'Type your answer...' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			placeholder: 'Type your answer...',
		});
	});

	describe('transforms.to', () => {
		const attributes = {
			questionText: 'Website',
			questionKey: 'website',
			required: true,
			placeholder: '',
		};

		it('includes long-text, phone, and url, preserving attributes', () => {
			const targets = [
				'fair-audience/fair-form-long-text',
				'fair-audience/fair-form-phone',
				'fair-audience/fair-form-url',
			];

			for (const target of targets) {
				const transform = capturedSettings.transforms.to.find((t) =>
					t.blocks.includes(target)
				);

				expect(transform).toBeDefined();
				expect(transform.transform(attributes)).toEqual({
					name: target,
					attributes,
				});
			}
		});
	});
});
