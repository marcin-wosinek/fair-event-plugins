/**
 * @jest-environment jsdom
 *
 * Component tests for EventTickets.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
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
