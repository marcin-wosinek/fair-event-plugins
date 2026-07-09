/**
 * @jest-environment jsdom
 *
 * Component tests for the All Participants page:
 *   - Header/columns polish pass (#1055): "Add Participant" renders as a
 *     header page-title-action outside the card; default columns drop
 *     Phone/Instagram/Status/Email Profile in favor of a single Mailing
 *     column; profile and status filters remain available even though their
 *     columns are hidden.
 *   - Confirm-then-delete flow (#1056): `window.confirm` / `alert` were
 *     replaced with a state-controlled `ConfirmDialog` and notices; this
 *     covers the delete confirmation dialog opening, confirming (fires the
 *     DELETE requests and reloads), and cancelling (fires no request).
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	waitFor,
	fireEvent,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AllParticipants from '../AllParticipants.js';

jest.mock('@wordpress/api-fetch');

const PARTICIPANTS = [
	{
		id: 1,
		name: 'Jane',
		surname: 'Doe',
		email: 'jane@example.com',
		phone: '',
		instagram: '',
		email_profile: 'marketing',
		status: 'confirmed',
		groups: [],
		wp_user: null,
		events_signed_up: 0,
		events_collaborated: 0,
	},
	{
		id: 2,
		name: 'John',
		surname: 'Roe',
		email: 'john@example.com',
		phone: '',
		instagram: '',
		email_profile: 'marketing',
		status: 'pending',
		groups: [],
		wp_user: null,
		events_signed_up: 0,
		events_collaborated: 0,
	},
	{
		id: 3,
		name: 'Amy',
		surname: 'Fox',
		email: 'amy@example.com',
		phone: '',
		instagram: '',
		email_profile: 'minimal',
		status: 'confirmed',
		groups: [],
		wp_user: null,
		events_signed_up: 0,
		events_collaborated: 0,
	},
	{
		id: 4,
		name: 'Bo',
		surname: 'Lee',
		email: 'bo@example.com',
		phone: '',
		instagram: '',
		email_profile: 'declined',
		status: 'confirmed',
		groups: [],
		wp_user: null,
		events_signed_up: 0,
		events_collaborated: 0,
	},
];

function mockApiFetch() {
	apiFetch.mockImplementation(({ path, parse }) => {
		if (
			path.startsWith('/fair-audience/v1/participants') &&
			parse === false
		) {
			return Promise.resolve({
				headers: new Map([
					['X-WP-Total', String(PARTICIPANTS.length)],
					['X-WP-TotalPages', '1'],
				]),
				json: () => Promise.resolve(PARTICIPANTS),
			});
		}
		if (path === '/fair-audience/v1/groups') {
			return Promise.resolve([]);
		}
		return Promise.resolve([]);
	});
}

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
		participantsUrl: 'admin.php?page=fair-audience&event_date_id=',
	};
	jest.spyOn(console, 'error').mockImplementation(() => {});
	mockApiFetch();
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('AllParticipants — header action', () => {
	it('renders Add Participant as a page-title-action outside the card and opens the modal', async () => {
		render(<AllParticipants />);

		await screen.findByText('Jane Doe');

		const addButton = screen.getByRole('button', {
			name: 'Add Participant',
		});
		expect(addButton).toHaveClass('page-title-action');
		expect(addButton.closest('.components-card')).toBeNull();

		fireEvent.click(addButton);
		expect(await screen.findByRole('dialog')).toBeInTheDocument();

		// ParticipantEditModal's SelectControl pre-dates the WP 6.8 40px
		// default-size opt-in; not part of this change, just acknowledged here.
		expect(console).toHaveWarned();
	});
});

describe('AllParticipants — default columns', () => {
	it('hides Phone/Instagram/Status/Email Profile and shows Mailing', async () => {
		render(<AllParticipants />);

		await screen.findByText('Jane Doe');

		expect(
			screen.queryByRole('columnheader', { name: 'Phone' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', { name: 'Instagram' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', { name: 'Status' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', { name: 'Email Profile' })
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('columnheader', { name: 'Mailing' })
		).toBeInTheDocument();
	});
});

describe('AllParticipants — Mailing column mapping', () => {
	it('maps email_profile/status combinations to readable labels', async () => {
		render(<AllParticipants />);

		const janeRow = (await screen.findByText('Jane Doe')).closest('tr');
		expect(within(janeRow).getByText('Marketing')).toBeInTheDocument();

		const johnRow = screen.getByText('John Roe').closest('tr');
		expect(
			within(johnRow).getByText('Marketing — pending confirmation')
		).toBeInTheDocument();

		const amyRow = screen.getByText('Amy Fox').closest('tr');
		expect(within(amyRow).getByText('Minimal')).toBeInTheDocument();

		const boRow = screen.getByText('Bo Lee').closest('tr');
		expect(within(boRow).getByText('No')).toBeInTheDocument();
	});
});

describe('AllParticipants — filters preserved', () => {
	it('still offers profile and status filters despite hidden columns', async () => {
		render(<AllParticipants />);

		await screen.findByText('Jane Doe');

		fireEvent.click(screen.getByRole('button', { name: /add filter/i }));

		expect(
			screen.getByRole('menuitem', { name: 'Email Profile' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('menuitem', { name: 'Status' })
		).toBeInTheDocument();
	});
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
