/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventEditForm from '../EventEditForm.js';

jest.mock('@wordpress/api-fetch');

jest.mock('../store.js', () => ({ STORE_NAME: 'fair-events/event-data' }));

jest.mock('@wordpress/data', () => {
	const stub = () => stub;
	return new Proxy(
		{
			useDispatch: () => ({ setEventData: jest.fn() }),
			useSelect: () => ({}),
		},
		{
			get(target, prop) {
				if (prop in target) return target[prop];
				return stub;
			},
		}
	);
});

const eventDate = {
	id: 42,
	start_datetime: '2026-06-10 10:00:00',
	end_datetime: '2026-06-10 11:00:00',
	all_day: false,
	venue_id: null,
	rrule: null,
};

beforeEach(() => {
	apiFetch.mockImplementation(({ path, method }) => {
		if (path === '/fair-events/v1/venues') {
			return Promise.resolve([]);
		}
		if (path.startsWith('/fair-events/v1/event-dates/') && !method) {
			return Promise.resolve(eventDate);
		}
		return Promise.resolve({});
	});
});

afterEach(() => {
	jest.clearAllMocks();
});

const renderForm = async (props = {}) => {
	render(
		<EventEditForm
			eventDateId={42}
			manageEventUrl="/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=42"
			postId={1}
			postType="post"
			{...props}
		/>
	);
	await waitFor(() =>
		expect(
			screen.getByRole('button', { name: 'Save Event' })
		).toBeInTheDocument()
	);
};

describe('EventEditForm secondary actions', () => {
	it('renders Edit Full Details and Unlink when onUnlink is provided', async () => {
		await renderForm({ onUnlink: jest.fn(), unlinking: false });
		expect(
			screen.getByRole('link', { name: 'Edit Full Details' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Unlink from event' })
		).toBeInTheDocument();
		expect(console).toHaveWarned();
	});

	it('hides Unlink when onUnlink is not provided (fair_event post)', async () => {
		await renderForm({
			postType: 'fair_event',
			onUnlink: undefined,
		});
		expect(
			screen.getByRole('link', { name: 'Edit Full Details' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Unlink from event' })
		).not.toBeInTheDocument();
	});

	it('calls onUnlink when Unlink is clicked', async () => {
		const onUnlink = jest.fn();
		await renderForm({ onUnlink, unlinking: false });
		fireEvent.click(
			screen.getByRole('button', { name: 'Unlink from event' })
		);
		expect(onUnlink).toHaveBeenCalledTimes(1);
	});

	it('disables Save and Unlink while unlinking is in flight', async () => {
		await renderForm({ onUnlink: jest.fn(), unlinking: true });
		expect(
			screen.getByRole('button', { name: 'Save Event' })
		).toBeDisabled();
		expect(
			screen.getByRole('button', { name: 'Unlink from event' })
		).toBeDisabled();
	});
});
