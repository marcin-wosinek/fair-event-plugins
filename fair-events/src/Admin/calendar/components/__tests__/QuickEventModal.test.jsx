/**
 * @jest-environment jsdom
 *
 * Tests for QuickEventModal (#976).
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import QuickEventModal from '../QuickEventModal.js';

jest.mock('@wordpress/api-fetch');

const availableCategories = [
	{ id: 1, name: 'Music' },
	{ id: 2, name: 'Sports' },
];

const createdEventDate = { id: 99, title: 'Test Event' };

beforeEach(() => {
	apiFetch.mockImplementation(({ path, method }) => {
		if (path === '/fair-events/v1/venues') {
			return Promise.resolve([]);
		}
		if (path === '/fair-events/v1/sources/categories') {
			return Promise.resolve(availableCategories);
		}
		if (path.startsWith('/wp/v2/search')) {
			return Promise.resolve([{ id: 7, title: 'About Us' }]);
		}
		if (path === '/fair-events/v1/event-dates' && method === 'POST') {
			return Promise.resolve(createdEventDate);
		}
		if (path.endsWith('/link-post') && method === 'POST') {
			return Promise.resolve(createdEventDate);
		}
		return Promise.resolve({});
	});
});

afterEach(() => {
	jest.clearAllMocks();
});

const renderModal = async (props = {}) => {
	const onClose = jest.fn();
	const onSuccess = jest.fn();
	render(
		<QuickEventModal
			date={new Date('2026-06-10T00:00:00')}
			onClose={onClose}
			onSuccess={onSuccess}
			{...props}
		/>
	);
	// Let the venues/categories useEffect fetches resolve before interacting.
	await waitFor(() =>
		expect(apiFetch).toHaveBeenCalledWith({
			path: '/fair-events/v1/sources/categories',
		})
	);
	return { onClose, onSuccess };
};

const fillTitle = (title = 'Test Event') => {
	fireEvent.change(screen.getByLabelText('Title'), {
		target: { value: title },
	});
};

const openMoreOptions = () => {
	fireEvent.click(screen.getByRole('button', { name: 'More options' }));
};

describe('QuickEventModal', () => {
	it('hides advanced fields behind "More options" by default', async () => {
		await renderModal();
		expect(screen.queryByText('Categories')).not.toBeInTheDocument();
		expect(screen.queryByText('Link to')).not.toBeInTheDocument();
		expect(screen.queryByText('Repeat this event')).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'More options' })
		).toBeInTheDocument();

		// The always-visible Venue SelectControl emits a 40px-default-size notice.
		expect(console).toHaveWarned();
	});

	it('sends selected category IDs on create', async () => {
		const { onSuccess } = await renderModal();
		fillTitle();
		openMoreOptions();

		const categoryField = await screen.findByLabelText('Categories');
		fireEvent.change(categoryField, { target: { value: 'Music' } });
		fireEvent.keyDown(categoryField, { key: 'Enter', code: 'Enter' });

		fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

		await waitFor(() => expect(onSuccess).toHaveBeenCalled());

		const createCall = apiFetch.mock.calls.find(
			([opts]) =>
				opts.path === '/fair-events/v1/event-dates' &&
				opts.method === 'POST'
		);
		expect(createCall[0].data.categories).toEqual([1]);

		// FormTokenField/SelectControl emit an expected 40px-default-size notice.
		expect(console).toHaveWarned();
	});

	it('sends link_type external with the URL', async () => {
		const { onSuccess } = await renderModal();
		fillTitle();
		openMoreOptions();

		fireEvent.click(screen.getByLabelText('An external website'));
		fireEvent.change(screen.getByLabelText('External URL'), {
			target: { value: 'https://example.com' },
		});

		fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

		await waitFor(() => expect(onSuccess).toHaveBeenCalled());

		const createCall = apiFetch.mock.calls.find(
			([opts]) =>
				opts.path === '/fair-events/v1/event-dates' &&
				opts.method === 'POST'
		);
		expect(createCall[0].data.link_type).toBe('external');
		expect(createCall[0].data.external_url).toBe('https://example.com');
	});

	it('chains a link-post call when linking an existing post', async () => {
		const { onSuccess } = await renderModal();
		fillTitle();
		openMoreOptions();

		fireEvent.click(screen.getByLabelText('A page on this site'));
		fireEvent.change(screen.getByLabelText('Search posts by title'), {
			target: { value: 'about' },
		});

		const postSelect = await screen.findByLabelText('Select a post');
		fireEvent.change(postSelect, { target: { value: '7' } });

		fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

		await waitFor(() => expect(onSuccess).toHaveBeenCalled());

		const linkCall = apiFetch.mock.calls.find(([opts]) =>
			opts.path?.endsWith('/link-post')
		);
		expect(linkCall[0].data.post_id).toBe(7);
	});

	it('sends a non-empty rrule when recurrence is enabled', async () => {
		const { onSuccess } = await renderModal();
		fillTitle();
		openMoreOptions();

		fireEvent.click(screen.getByLabelText('Repeat this event'));

		fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

		await waitFor(() => expect(onSuccess).toHaveBeenCalled());

		const createCall = apiFetch.mock.calls.find(
			([opts]) =>
				opts.path === '/fair-events/v1/event-dates' &&
				opts.method === 'POST'
		);
		expect(createCall[0].data.rrule).toBeTruthy();

		expect(console).toHaveWarned();
	});
});
