/**
 * @jest-environment jsdom
 *
 * Component tests for the sliding-scale (pay-what-you-can) pricing toggle
 * in EventTickets (#932).
 *
 * Exercises:
 *   - The toggle and min/max inputs are hidden until sliding scale is enabled.
 *   - Enabling the toggle reveals the min/max inputs.
 *   - An invalid band (min > suggested) shows a validation notice and blocks save.
 *   - A valid band is included in the save payload with decimal values.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventTickets from '../EventTickets.js';

jest.mock('@wordpress/api-fetch');

beforeEach(() => {
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
	// Background apiFetch calls (groups, participants, group-pricing-rules)
	// never resolve so they don't fire async state updates outside act().
	apiFetch.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

const emptyInitialData = {
	capacity: null,
	signup_price: null,
	ticket_types: [],
	sale_periods: [],
	prices: [],
	settings: {},
	options: [],
};

function renderTickets(extraProps = {}) {
	const onSaveRef = { current: null };
	const { container } = render(
		<EventTickets
			eventDateId={99}
			onSaveRef={onSaveRef}
			initialData={emptyInitialData}
			onDataRef={null}
			{...extraProps}
		/>
	);
	// WordPress's a11y speak() utility appends a persistent live-region node
	// to document.body that isn't cleaned up between tests, so notice-text
	// assertions must be scoped to this render's container rather than the
	// whole document.
	return { onSaveRef, container };
}

function openEditTicketsPanel() {
	fireEvent.click(screen.getByRole('button', { name: /Edit tickets/i }));
}

describe('EventTickets — sliding scale toggle', () => {
	it('does not show min/max inputs when the toggle is off', () => {
		renderTickets();
		openEditTicketsPanel();

		expect(
			screen.getByText(/Pay what you can \(sliding scale\)/i)
		).toBeInTheDocument();
		expect(
			screen.queryByLabelText(/Minimum \(EUR\)/i)
		).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText(/Maximum \(EUR\)/i)
		).not.toBeInTheDocument();
	});

	it('shows min/max inputs once the toggle is enabled', () => {
		renderTickets();
		openEditTicketsPanel();

		fireEvent.click(
			screen.getByLabelText(/Pay what you can \(sliding scale\)/i)
		);

		expect(screen.getByLabelText(/Minimum \(EUR\)/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/Maximum \(EUR\)/i)).toBeInTheDocument();
	});

	it('shows a validation notice when min > suggested and blocks save', async () => {
		const { onSaveRef, container } = renderTickets();
		openEditTicketsPanel();

		fireEvent.click(
			screen.getByLabelText(/Pay what you can \(sliding scale\)/i)
		);
		fireEvent.change(screen.getByLabelText(/Minimum \(EUR\)/i), {
			target: { value: '25' },
		});
		fireEvent.change(screen.getByLabelText(/Maximum \(EUR\)/i), {
			target: { value: '50' },
		});
		// Suggested price (signupPrice) stays empty (0) — below the min.

		expect(
			within(container).getByText(
				/Minimum must be less than or equal to/i
			)
		).toBeInTheDocument();

		let saveCalled = false;
		apiFetch.mockImplementation(() => {
			saveCalled = true;
			return new Promise(() => {});
		});

		await act(async () => {
			await onSaveRef.current();
		});

		expect(saveCalled).toBe(false);
	});

	it('save payload includes the sliding-scale settings as decimals once valid', async () => {
		const { onSaveRef, container } = renderTickets();
		openEditTicketsPanel();

		fireEvent.change(screen.getByLabelText(/Signup price \(EUR\)/i), {
			target: { value: '20' },
		});
		fireEvent.click(
			screen.getByLabelText(/Pay what you can \(sliding scale\)/i)
		);
		fireEvent.change(screen.getByLabelText(/Minimum \(EUR\)/i), {
			target: { value: '5.5' },
		});
		fireEvent.change(screen.getByLabelText(/Maximum \(EUR\)/i), {
			target: { value: '50.25' },
		});

		expect(
			within(container).queryByText(
				/Minimum must be less than or equal to/i
			)
		).not.toBeInTheDocument();

		let savedPayload = null;
		apiFetch.mockImplementation(({ method, data }) => {
			if (method === 'PUT') {
				savedPayload = data;
				return Promise.resolve(emptyInitialData);
			}
			return new Promise(() => {});
		});

		await act(async () => {
			await onSaveRef.current();
		});

		expect(savedPayload).not.toBeNull();
		expect(savedPayload.settings.sliding_scale_enabled).toBe(true);
		expect(String(savedPayload.settings.sliding_scale_min)).toBe('5.5');
		expect(String(savedPayload.settings.sliding_scale_max)).toBe('50.25');
	});
});

describe('EventTickets — Activity collaborator discount removed (#1139)', () => {
	const initialDataWithOption = {
		...emptyInitialData,
		options: [
			{
				id: 5,
				name: 'Dinner',
				short_name: '',
				price: 20,
				capacity: null,
				collaborator_ids: [],
				period_prices: [],
				sort_order: 0,
			},
		],
	};

	it('does not render the checkbox or the Discounted price column, even for a stored discount', () => {
		renderTickets({
			initialData: {
				...initialDataWithOption,
				settings: { activity_collaborator_discount: true },
			},
		});

		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		expect(
			screen.queryByRole('checkbox', {
				name: /Activity collaborator discount/i,
			})
		).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', { name: /Activity Options/i })
		);
		expect(screen.queryByText(/Discounted price/i)).not.toBeInTheDocument();
	});
});
