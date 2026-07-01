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
import { render, screen, waitFor } from '@testing-library/react';
import { addFilter, removeFilter } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import ManageEventApp from '../ManageEventApp.js';

jest.mock('@wordpress/api-fetch');

const mockEventDate = {
	id: 1,
	title: 'Test Event',
	start_datetime: '2026-07-01 18:00:00',
	end_datetime: '2026-07-01 20:00:00',
	all_day: false,
	occurrence_type: 'standalone',
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
