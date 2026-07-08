/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import RecurrenceControl from '../RecurrenceControl.js';

// jsdom has no layout engine; @wordpress/components' VStack/HStack use
// matchMedia for responsive spacing, which jsdom doesn't implement.
beforeAll(() => {
	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
});

const baseValue = {
	enabled: false,
	frequency: 'weekly',
	endType: 'count',
	count: 10,
	until: '',
};

describe('RecurrenceControl', () => {
	test('hides Frequency/Ends controls when disabled', () => {
		render(<RecurrenceControl value={baseValue} onChange={jest.fn()} />);
		expect(
			screen.queryByRole('combobox', { name: 'Frequency' })
		).not.toBeInTheDocument();
	});

	test('shows Frequency/Ends controls when enabled', () => {
		render(
			<RecurrenceControl
				value={{ ...baseValue, enabled: true }}
				onChange={jest.fn()}
			/>
		);
		expect(
			screen.getByRole('combobox', { name: 'Frequency' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('combobox', { name: 'Ends' })
		).toBeInTheDocument();
	});

	test('toggling the checkbox emits enabled:true with the rest of the value', () => {
		const onChange = jest.fn();
		render(<RecurrenceControl value={baseValue} onChange={onChange} />);
		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Repeat this event' })
		);
		expect(onChange).toHaveBeenCalledWith({ ...baseValue, enabled: true });
	});

	test('shows the count field when endType is count, and the date field when until', () => {
		render(
			<RecurrenceControl
				value={{ ...baseValue, enabled: true, endType: 'count' }}
				onChange={jest.fn()}
			/>
		);
		expect(
			screen.getByRole('spinbutton', { name: 'Number of occurrences' })
		).toBeInTheDocument();

		render(
			<RecurrenceControl
				value={{ ...baseValue, enabled: true, endType: 'until' }}
				onChange={jest.fn()}
			/>
		);
		expect(screen.getByLabelText('End date')).toBeInTheDocument();
	});

	test('changing frequency emits the merged value', () => {
		const onChange = jest.fn();
		render(
			<RecurrenceControl
				value={{ ...baseValue, enabled: true }}
				onChange={onChange}
			/>
		);
		fireEvent.change(screen.getByRole('combobox', { name: 'Frequency' }), {
			target: { value: 'monthly' },
		});
		expect(onChange).toHaveBeenCalledWith({
			...baseValue,
			enabled: true,
			frequency: 'monthly',
		});
	});
});
