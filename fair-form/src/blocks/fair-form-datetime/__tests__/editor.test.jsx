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
}));

describe('Fair Form Date & Time Question Edit', () => {
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
			target: { value: 'Preferred appointment slot' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Preferred appointment slot',
			questionKey: 'preferred_appointment_slot',
		});
	});

	it('does not override a manually-edited question key', () => {
		const setAttributes = jest.fn();
		renderEdit(
			{ questionText: 'Appointment', questionKey: 'custom_key' },
			setAttributes
		);

		const questionTextInput = screen.getByPlaceholderText(
			'Enter your question...'
		);
		fireEvent.change(questionTextInput, {
			target: { value: 'Appointment updated' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			questionText: 'Appointment updated',
		});
	});

	it('renders the Required toggle and Placeholder controls', () => {
		renderEdit();

		expect(screen.getByLabelText('Required')).toBeInTheDocument();
		expect(screen.getByLabelText('Placeholder')).toBeInTheDocument();
		expect(screen.getByLabelText('Question Key')).toBeInTheDocument();
	});

	it('renders a disabled native datetime-local input preview', () => {
		renderEdit();

		const preview = document.querySelector('input[type="datetime-local"]');
		expect(preview).toBeInTheDocument();
		expect(preview).toBeDisabled();
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
			target: { value: 'YYYY-MM-DD HH:mm' },
		});

		expect(setAttributes).toHaveBeenCalledWith({
			placeholder: 'YYYY-MM-DD HH:mm',
		});
	});
});
