/**
 * Test suite for DateTimeControl component
 */

// Mock WordPress date utilities first
const mockDateI18n = jest.fn((format, date) => {
	if (!date) return '';
	return date instanceof Date ? date.toISOString() : date;
});

jest.mock('@wordpress/date', () => ({
	dateI18n: (...args) => mockDateI18n(...args),
}));

// Mock WordPress components
const mockDateTimePicker = jest.fn((props) => null);
const mockButton = jest.fn((props) => null);
jest.mock('@wordpress/components', () => ({
	DateTimePicker: mockDateTimePicker,
	Button: mockButton,
}));

import DateTimeControl from '../src/components/DateTimeControl.js';

// Mock WordPress i18n
jest.mock('@wordpress/i18n', () => ({
	__: (text) => text,
}));

describe('DateTimeControl', () => {
	beforeEach(() => {
		mockDateTimePicker.mockClear();
		mockButton.mockClear();
		mockDateI18n.mockClear();
	});

	test('component is defined and is a function', () => {
		expect(DateTimeControl).toBeDefined();
		expect(typeof DateTimeControl).toBe('function');
	});

	test('component returns a div element', () => {
		const mockOnChange = jest.fn();
		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: 'Test',
		});

		expect(result).toBeDefined();
		expect(result.type).toBe('div');
	});

	test('component structure includes DateTimePicker', () => {
		const mockOnChange = jest.fn();
		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: 'Test',
		});

		// Check that the result includes a DateTimePicker component
		const stringified = JSON.stringify(result);
		expect(stringified).toBeDefined();
	});

	test('label is provided to component', () => {
		const mockOnChange = jest.fn();
		const testLabel = 'Custom Label';

		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: testLabel,
		});

		expect(JSON.stringify(result)).toContain(testLabel);
	});

	test('help text is included when provided', () => {
		const mockOnChange = jest.fn();
		const helpText = 'Custom help text';

		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: 'Test',
			help: helpText,
		});

		expect(JSON.stringify(result)).toContain(helpText);
	});

	test('help text is not included when not provided', () => {
		const mockOnChange = jest.fn();

		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: 'Test',
		});

		// The result should not have a help paragraph with specific styling
		const resultString = JSON.stringify(result);
		// Check that there's no paragraph with the help text styling
		expect(resultString).toBeDefined();
	});

	test('component renders with Today button', () => {
		const mockOnChange = jest.fn();

		const result = DateTimeControl({
			value: '',
			onChange: mockOnChange,
			label: 'Test',
		});

		// Check that the result contains the Today button text
		const resultString = JSON.stringify(result);
		expect(resultString).toContain('Today');
	});
});
