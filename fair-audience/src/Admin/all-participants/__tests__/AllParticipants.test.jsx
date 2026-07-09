/**
 * @jest-environment jsdom
 *
 * Tests for the confirm-then-delete flow on All Participants (#1056).
 *
 * `window.confirm` / `alert` were replaced with a state-controlled
 * `ConfirmDialog` and notices; this covers the delete confirmation dialog
 * opening, confirming (fires the DELETE requests and reloads), and
 * cancelling (fires no request).
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AllParticipants from '../AllParticipants.js';

jest.mock('@wordpress/api-fetch');

const mockParticipant = {
	id: 1,
	name: 'John',
	surname: 'Doe',
	email: 'john@example.com',
	status: 'pending',
};

function mockList(items) {
	apiFetch.mockImplementation((opts) => {
		if (opts.parse === false) {
			return Promise.resolve({
				headers: new Map([
					['X-WP-Total', String(items.length)],
					['X-WP-TotalPages', '1'],
				]),
				json: () => Promise.resolve(items),
			});
		}
		return Promise.resolve({});
	});
}

beforeEach(() => {
	window.fairAudienceAllParticipantsData = {
		participantsUrl:
			'admin.php?page=fair-audience-event-participants&event_date_id=',
	};
});

describe('confirm-then-delete flow (#1056)', () => {
	it('names the participant and requires confirmation before deleting', async () => {
		mockList([mockParticipant]);

		render(<AllParticipants />);
		await waitFor(() =>
			expect(screen.getByText('John Doe')).toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
		fireEvent.click(await screen.findByText('Delete'));

		expect(
			screen.getByText('Delete John Doe? This cannot be undone.')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Delete participant' })
		).toBeInTheDocument();
	});

	it('fires no DELETE request when cancelled', async () => {
		mockList([mockParticipant]);

		render(<AllParticipants />);
		await waitFor(() =>
			expect(screen.getByText('John Doe')).toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
		fireEvent.click(await screen.findByText('Delete'));
		await screen.findByText('Delete John Doe? This cannot be undone.');
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		await waitFor(() =>
			expect(
				screen.queryByText('Delete John Doe? This cannot be undone.')
			).not.toBeInTheDocument()
		);

		expect(apiFetch).not.toHaveBeenCalledWith(
			expect.objectContaining({ method: 'DELETE' })
		);
	});

	it('fires a DELETE request and reloads when confirmed', async () => {
		mockList([mockParticipant]);

		render(<AllParticipants />);
		await waitFor(() =>
			expect(screen.getByText('John Doe')).toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
		fireEvent.click(await screen.findByText('Delete'));
		await screen.findByText('Delete John Doe? This cannot be undone.');
		fireEvent.click(
			screen.getByRole('button', { name: 'Delete participant' })
		);

		await waitFor(() =>
			expect(apiFetch).toHaveBeenCalledWith(
				expect.objectContaining({
					path: '/fair-audience/v1/participants/1',
					method: 'DELETE',
				})
			)
		);

		await waitFor(() =>
			expect(
				screen.queryByText('Delete John Doe? This cannot be undone.')
			).not.toBeInTheDocument()
		);
	});
});
