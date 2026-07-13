/**
 * @jest-environment jsdom
 *
 * Tests for the tab registry mechanism in ManageEventApp (#919).
 *
 * Exercises:
 *   - Built-in tabs render after the event loads.
 *   - A tab registered via addFilter('fairEvents.manageEvent.tabs') appears.
 *   - A descriptor with isVisible:false is omitted from the tab bar.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { addFilter, removeFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import { formatSiteLocalDatetime } from 'fair-events-shared';
import ManageEventApp from '../ManageEventApp.js';

jest.mock('@wordpress/api-fetch');

const mockEventDate = {
	id: 1,
	title: 'Test Event',
	start_datetime: '2026-07-01 18:00:00',
	end_datetime: '2026-07-01 20:00:00',
	all_day: false,
	occurrence_type: 'single',
	link_type: 'none',
	external_url: '',
	venue_id: null,
	address: '',
	categories: [],
	linked_posts: [],
	rrule: null,
	display_url: null,
	event_id: null,
	master: null,
	generated_occurrences: [],
	cancelled_dates: [],
	status: 'active',
	recurrence_mode: 'none',
};

beforeEach(() => {
	// Use the Admin tab as the landing tab so the event-details form
	// (SelectControl / FormTokenField) does not render by default.
	// Those components emit @wordpress/components deprecation warnings that
	// would fail the @wordpress/jest-console check.
	window.history.replaceState({}, '', '?tab=admin');

	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: {},
	};

	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});

	apiFetch.mockImplementation((opts) => {
		if (opts.path && opts.path.includes('/event-dates/')) {
			return Promise.resolve(mockEventDate);
		}
		return Promise.resolve([]);
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
	delete window.fairEventsManageEventData;
	window.history.replaceState({}, '', '/');
});

it('renders built-in Event Details and Admin tabs after loading', async () => {
	render(<ManageEventApp />);
	// Admin is the initial tab (set via URL in beforeEach). Wait for it to
	// appear, which confirms the event loaded and the tab bar rendered.
	await waitFor(() =>
		expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
	);
	expect(
		screen.getByRole('tab', { name: 'Event Details' })
	).toBeInTheDocument();
});

it('renders a tab registered via addFilter', async () => {
	const NAMESPACE = 'test/custom-tab-919';
	addFilter('fairEvents.manageEvent.tabs', NAMESPACE, (descriptors) => [
		...descriptors,
		{
			name: 'custom',
			title: 'Custom Tab',
			order: 999,
			isVisible: true,
			render: () => <div>Custom content</div>,
		},
	]);

	render(<ManageEventApp />);
	await waitFor(() =>
		expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
	);
	expect(screen.getByRole('tab', { name: 'Custom Tab' })).toBeInTheDocument();

	removeFilter('fairEvents.manageEvent.tabs', NAMESPACE);
});

it('renders extra admin actions registered via addFilter', async () => {
	const NAMESPACE = 'test/admin-action-919';
	addFilter('fairEvents.manageEvent.adminActions', NAMESPACE, (actions) => [
		...actions,
		<div key="custom-action">Custom action</div>,
	]);

	render(<ManageEventApp />);
	await waitFor(() =>
		expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
	);
	expect(screen.getByText('Custom action')).toBeInTheDocument();

	removeFilter('fairEvents.manageEvent.adminActions', NAMESPACE);
});

it('disables Tickets and Finance tabs for external-URL events', async () => {
	window.history.replaceState({}, '', '?tab=tickets');
	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: { ticketing: true },
		paymentEntriesUrl: 'http://example.com/entries',
	};
	apiFetch.mockImplementation((opts) => {
		if (opts.path && opts.path.includes('/event-dates/')) {
			return Promise.resolve({ ...mockEventDate, link_type: 'external' });
		}
		return Promise.resolve([]);
	});

	render(<ManageEventApp />);
	// Tickets tab is disabled, so the initial tab falls back to Event Details.
	await waitFor(() =>
		expect(
			screen.getByRole('tab', { name: 'Event Details' })
		).toBeInTheDocument()
	);
	expect(screen.getByRole('tab', { name: 'Tickets' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect(screen.getByRole('tab', { name: 'Finance' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
});

it('keeps Tickets and Finance tabs enabled for post-linked events', async () => {
	window.history.replaceState({}, '', '?tab=admin');
	window.fairEventsManageEventData = {
		eventDateId: '1',
		calendarUrl: 'http://example.com/calendar',
		manageEventUrl: 'http://example.com/manage',
		enabledPostTypes: [],
		enabledFeatures: { ticketing: true },
		paymentEntriesUrl: 'http://example.com/entries',
	};
	apiFetch.mockImplementation((opts) => {
		if (opts.path && opts.path.includes('/event-dates/')) {
			return Promise.resolve({ ...mockEventDate, link_type: 'post' });
		}
		return Promise.resolve([]);
	});

	render(<ManageEventApp />);
	await waitFor(() =>
		expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
	);
	expect(screen.getByRole('tab', { name: 'Tickets' })).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect(screen.getByRole('tab', { name: 'Finance' })).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);
});

it('omits a descriptor with isVisible: false', async () => {
	const NAMESPACE = 'test/hidden-tab-919';
	addFilter('fairEvents.manageEvent.tabs', NAMESPACE, (descriptors) => [
		...descriptors,
		{
			name: 'hidden',
			title: 'Hidden Tab',
			order: 999,
			isVisible: false,
			render: () => null,
		},
	]);

	render(<ManageEventApp />);
	await waitFor(() =>
		expect(screen.getByRole('tab', { name: 'Admin' })).toBeInTheDocument()
	);
	expect(
		screen.queryByRole('tab', { name: 'Hidden Tab' })
	).not.toBeInTheDocument();

	removeFilter('fairEvents.manageEvent.tabs', NAMESPACE);
});

describe('context header (#986)', () => {
	it('shows the date and no series/occurrence badge for a one-off event', async () => {
		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		expect(
			screen.getByText(
				new RegExp(
					formatSiteLocalDatetime(
						mockEventDate.start_datetime
					).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
				)
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/Recurring series/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Occurrence of/)).not.toBeInTheDocument();
	});

	it('shows a series badge with the occurrence count for a master', async () => {
		apiFetch.mockImplementation((opts) => {
			if (opts.path && opts.path.includes('/event-dates/')) {
				return Promise.resolve({
					...mockEventDate,
					occurrence_type: 'master',
					rrule: 'FREQ=WEEKLY',
					generated_occurrences: [
						{ id: 2, start_datetime: '2026-07-08 18:00:00' },
						{ id: 3, start_datetime: '2026-07-15 18:00:00' },
					],
				});
			}
			return Promise.resolve([]);
		});

		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		expect(
			screen.getByText('Recurring series — 3 dates')
		).toBeInTheDocument();
	});

	it('links a generated occurrence to its master and removes the bottom notice', async () => {
		apiFetch.mockImplementation((opts) => {
			if (opts.path && opts.path.includes('/event-dates/')) {
				return Promise.resolve({
					...mockEventDate,
					occurrence_type: 'generated',
					master: {
						id: 1,
						title: 'Master Event',
						start_datetime: '2026-07-01 18:00:00',
					},
				});
			}
			return Promise.resolve([]);
		});

		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		expect(screen.getByText(/Occurrence of/)).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'view series' })
		).toHaveAttribute('href', 'http://example.com/manage&event_date_id=1');
		expect(
			screen.queryByText('This is a recurring occurrence of:')
		).not.toBeInTheDocument();
		expect(
			screen.getByText(/Tickets are managed on the series/)
		).toBeInTheDocument();
		expect(
			screen.getByRole('link', { name: 'open the master event' })
		).toHaveAttribute('href', 'http://example.com/manage&event_date_id=1');
	});
});

describe('create-on-the-fly categories (#992)', () => {
	beforeEach(() => {
		window.history.replaceState({}, '', '?tab=event-details');
	});

	it('creates and links a category typed as an unknown token', async () => {
		apiFetch.mockImplementation((opts) => {
			if (opts.path && opts.path.includes('/event-dates/')) {
				return Promise.resolve(mockEventDate);
			}
			if (opts.path === '/fair-events/v1/sources/categories') {
				if (opts.method === 'POST') {
					return Promise.resolve({
						id: 5,
						name: 'Workshops',
						slug: 'workshops',
					});
				}
				return Promise.resolve([
					{ id: 1, name: 'Music', slug: 'music' },
				]);
			}
			return Promise.resolve([]);
		});

		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Event Details' })
			).toBeInTheDocument()
		);

		const input = await screen.findByLabelText('Categories');
		fireEvent.change(input, { target: { value: 'Workshops' } });
		fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

		await waitFor(() =>
			expect(apiFetch).toHaveBeenCalledWith(
				expect.objectContaining({
					path: '/fair-events/v1/sources/categories',
					method: 'POST',
					data: { name: 'Workshops' },
				})
			)
		);

		expect(await screen.findByText('Workshops')).toBeInTheDocument();
	});
});

describe('delete confirmation dialog (#991)', () => {
	it('shows the title and date, and no occurrence count, for a one-off event', async () => {
		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', { name: 'Delete Event' }));

		expect(
			screen.getByText(
				`Delete Test Event on ${formatSiteLocalDatetime(
					mockEventDate.start_datetime
				)}? This cannot be undone.`
			)
		).toBeInTheDocument();
	});

	it('shows the occurrence count for a recurring master', async () => {
		apiFetch.mockImplementation((opts) => {
			if (opts.path && opts.path.includes('/event-dates/')) {
				return Promise.resolve({
					...mockEventDate,
					occurrence_type: 'master',
					generated_occurrences: Array.from(
						{ length: 9 },
						(_, i) => ({
							id: i + 2,
							start_datetime: '2026-07-08 18:00:00',
						})
					),
				});
			}
			return Promise.resolve([]);
		});

		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', { name: 'Delete Event' }));

		expect(
			screen.getByText(
				'Delete Test Event and its 9 occurrences? This cannot be undone.'
			)
		).toBeInTheDocument();
	});
});

describe('per-tab save model (#987)', () => {
	it('renders no save button on the read-only Admin tab', async () => {
		render(<ManageEventApp />);
		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Admin' })
			).toBeInTheDocument()
		);

		expect(
			screen.queryByRole('button', { name: 'Save event details' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Save tickets' })
		).not.toBeInTheDocument();
	});

	it('renders "Save event details" only on the Event Details tab', async () => {
		window.history.replaceState({}, '', '?tab=event-details');
		render(<ManageEventApp />);

		expect(
			await screen.findByRole('button', { name: 'Save event details' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Save tickets' })
		).not.toBeInTheDocument();
		// The old tab-dependent global button is gone.
		expect(
			screen.queryByRole('button', { name: 'Save Changes' })
		).not.toBeInTheDocument();
	});

	it('disables the save button and shows an inline message when the title is empty', async () => {
		window.history.replaceState({}, '', '?tab=event-details');
		render(<ManageEventApp />);

		const titleInput = await screen.findByLabelText('Title');
		fireEvent.change(titleInput, { target: { value: '' } });

		expect(
			screen.getByRole('button', { name: 'Save event details' })
		).toBeDisabled();
		expect(screen.getByText('Title is required')).toBeInTheDocument();
	});

	it('enables the save button once a title is entered', async () => {
		window.history.replaceState({}, '', '?tab=event-details');
		render(<ManageEventApp />);

		const titleInput = await screen.findByLabelText('Title');
		fireEvent.change(titleInput, { target: { value: '' } });
		fireEvent.change(titleInput, { target: { value: 'New title' } });

		expect(
			screen.getByRole('button', { name: 'Save event details' })
		).not.toBeDisabled();
		expect(screen.queryByText('Title is required')).not.toBeInTheDocument();
	});

	it('marks the Event Details tab dirty and guards navigation while editing', async () => {
		window.history.replaceState({}, '', '?tab=event-details');
		const addListenerSpy = jest.spyOn(window, 'addEventListener');
		render(<ManageEventApp />);

		const titleInput = await screen.findByLabelText('Title');
		expect(
			screen.getByRole('tab', { name: 'Event Details' })
		).toBeInTheDocument();

		fireEvent.change(titleInput, { target: { value: 'Edited title' } });

		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Event Details •' })
			).toBeInTheDocument()
		);
		expect(addListenerSpy).toHaveBeenCalledWith(
			'beforeunload',
			expect.any(Function)
		);

		addListenerSpy.mockRestore();
	});

	it('clears the dirty marker after a successful save', async () => {
		window.history.replaceState({}, '', '?tab=event-details');
		apiFetch.mockImplementation((opts) => {
			if (opts.method === 'PUT') {
				return Promise.resolve({
					...mockEventDate,
					title: 'Edited title',
				});
			}
			if (opts.path && opts.path.includes('/event-dates/')) {
				return Promise.resolve(mockEventDate);
			}
			return Promise.resolve([]);
		});

		render(<ManageEventApp />);

		const titleInput = await screen.findByLabelText('Title');
		fireEvent.change(titleInput, { target: { value: 'Edited title' } });

		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Event Details •' })
			).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Save event details' })
		);

		await waitFor(() =>
			expect(
				screen.getByRole('tab', { name: 'Event Details' })
			).toBeInTheDocument()
		);
	});
});
