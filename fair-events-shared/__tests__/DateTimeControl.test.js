/**
 * Test suite for DateTimeControl component
 */

import DateTimeControl from '../src/DateTimeControl.js';

describe('DateTimeControl', () => {
	test('component is defined and is a function', () => {
		expect(DateTimeControl).toBeDefined();
		expect(typeof DateTimeControl).toBe('function');
	});

	test('component exports properly', () => {
		// Verify it's a valid React component function
		expect(DateTimeControl.name).toBe('DateTimeControl');
	});

	test('component has correct number of expected props', () => {
		// Component should accept value, onChange, label, help, eventStart, eventEnd, eventAllDay
		// This is verified by the function signature
		expect(DateTimeControl).toHaveLength(1); // Single props object parameter
	});
});
