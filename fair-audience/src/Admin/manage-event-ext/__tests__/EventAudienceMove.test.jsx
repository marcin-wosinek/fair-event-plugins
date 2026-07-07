/**
 * @jest-environment jsdom
 *
 * Component tests for the "Move signup to another occurrence" action (#954).
 *
 * Exercises:
 *   - Move button is hidden when there is only one occurrence.
 *   - Move button appears for non-series-pass rows when siblings exist.
 *   - Opening the modal lists the other occurrences (current one excluded).
 *   - Confirming calls the move endpoint and refreshes the participant list.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventAudience from '../EventAudience.js';

jest.mock('@wordpress/api-fetch');

const PARTICIPANT = {
	id: 1,
	participant_id: 10,
	event_date_id: 5,
	is_series_pass: false,
	participant_name: 'Jane Doe',
	name: 'Jane',
	surname: 'Doe',
	participant_email: 'jane@example.com',
	email_profile: 'marketing',
	label: 'signed_up',
	ticket_type_id: null,
	ticket_type_name: null,
	attended_at: null,
	created_at: '2026-01-01 10:00:00',
	payment_expires_at: null,
	ticket_option_names: [],
	ticket_option_ids: [],
	admin_comment: '',
};

const SIBLINGS = [
	{ id: 5, start_datetime: '2026-01-01 10:00:00', occurrence_type: 'master' },
	{
		id: 6,
		start_datetime: '2026-01-08 10:00:00',
		occurrence_type: 'generated',
	},
	{
		id: 7,
		start_datetime: '2026-01-15 10:00:00',
		occurrence_type: 'generated',
	},
];

function mockApiFetchFor({ siblings }) {
	apiFetch.mockImplementation(({ path, method }) => {
		if (path.includes('/participants/10/move')) {
			return Promise.resolve({
				message: 'moved',
				target_event_date_id: 6,
			});
		}
		if (path.endsWith('/participants')) {
			return Promise.resolve([PARTICIPANT]);
		}
		if (path.includes('/siblings')) {
			return Promise.resolve(siblings);
		}
		if (path.includes('/tickets')) {
			return Promise.resolve({ options: [], ticket_types: [] });
		}
		if (path.includes('forms-summary')) {
			return Promise.resolve([]);
		}
		if (path.includes('group-permission-rules')) {
			return Promise.resolve([]);
		}
		if (path.includes('/groups')) {
			return Promise.resolve([]);
		}
		return Promise.resolve([]);
	});
}

function renderAudience() {
	render(
		<EventAudience
			eventId={1}
			eventDateId={5}
			audienceUrl="admin.php?page=fair-audience&event_date_id="
			eventTitle="Weekly class"
		/>
	);
}

beforeEach(() => {
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('EventAudience — Move action', () => {
	it('hides the Move button when there is only one occurrence', async () => {
		mockApiFetchFor({ siblings: [SIBLINGS[0]] });
		renderAudience();

		expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Move' })
		).not.toBeInTheDocument();
	});

	it('shows the Move button and lists sibling occurrences in the modal', async () => {
		mockApiFetchFor({ siblings: SIBLINGS });
		renderAudience();

		const moveButton = await screen.findByRole('button', { name: 'Move' });
		fireEvent.click(moveButton);

		const modal = screen.getByRole('dialog');
		const select = within(modal).getByRole('combobox');
		const options = within(select).getAllByRole('option');

		// Current occurrence (id 5) is excluded; the other two are listed.
		expect(options).toHaveLength(2);
	});

	it('confirming the move calls the move endpoint with the selected target', async () => {
		mockApiFetchFor({ siblings: SIBLINGS });
		renderAudience();

		const moveButton = await screen.findByRole('button', { name: 'Move' });
		fireEvent.click(moveButton);

		const modal = screen.getByRole('dialog');
		fireEvent.click(within(modal).getByRole('button', { name: 'Move' }));

		expect(apiFetch).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/fair-audience/v1/event-dates/5/participants/10/move',
				method: 'POST',
				data: { target_event_date_id: 6 },
			})
		);
	});
});
