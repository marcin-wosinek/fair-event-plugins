/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventStatistics, {
	peoplePerActivity,
	activityCountDistribution,
	salesLeadTime,
} from '../EventStatistics.js';

jest.mock('@wordpress/api-fetch');

// recharts needs ResizeObserver / a sized container that jsdom doesn't provide,
// and renders SVG internals that aren't this component's concern. Stub the
// chart primitives so the test can focus on our headings, notice, and states.
jest.mock('recharts', () => {
	const Passthrough = ({ children }) => <div>{children}</div>;
	const Empty = () => null;
	return {
		ResponsiveContainer: Passthrough,
		BarChart: Passthrough,
		Bar: Empty,
		XAxis: Empty,
		YAxis: Empty,
		Tooltip: Empty,
		CartesianGrid: Empty,
	};
});

const signedUp = (overrides) => ({
	label: 'signed_up',
	ticket_option_ids: [],
	ticket_option_names: [],
	created_at: null,
	...overrides,
});

describe('peoplePerActivity', () => {
	it('counts confirmed participants per ticket option, sorted desc', () => {
		const participants = [
			signedUp({
				ticket_option_ids: [1, 2],
				ticket_option_names: ['Yoga', 'Acro'],
			}),
			signedUp({
				ticket_option_ids: [1],
				ticket_option_names: ['Yoga'],
			}),
			signedUp({
				ticket_option_ids: [1, 3],
				ticket_option_names: ['Yoga', 'Thai'],
			}),
		];
		expect(peoplePerActivity(participants)).toEqual([
			{ name: 'Yoga', count: 3 },
			{ name: 'Acro', count: 1 },
			{ name: 'Thai', count: 1 },
		]);
	});

	it('falls back to #id when a name is missing', () => {
		const participants = [
			signedUp({ ticket_option_ids: [7], ticket_option_names: [] }),
		];
		expect(peoplePerActivity(participants)).toEqual([
			{ name: '#7', count: 1 },
		]);
	});

	it('returns [] for no participants', () => {
		expect(peoplePerActivity([])).toEqual([]);
	});
});

describe('activityCountDistribution', () => {
	it('buckets people by number of activities, continuous range', () => {
		const participants = [
			signedUp({ ticket_option_ids: [1] }), // 1 activity
			signedUp({ ticket_option_ids: [1, 2] }), // 2 activities
			signedUp({ ticket_option_ids: [1, 2, 3] }), // 3 activities
			signedUp({ ticket_option_ids: [4, 5, 6] }), // 3 activities
		];
		expect(activityCountDistribution(participants)).toEqual([
			{ activities: 1, people: 1 },
			{ activities: 2, people: 1 },
			{ activities: 3, people: 2 },
		]);
	});

	it('fills gaps in the range with zero', () => {
		const participants = [
			signedUp({ ticket_option_ids: [1] }), // 1
			signedUp({ ticket_option_ids: [1, 2, 3] }), // 3
		];
		expect(activityCountDistribution(participants)).toEqual([
			{ activities: 1, people: 1 },
			{ activities: 2, people: 0 },
			{ activities: 3, people: 1 },
		]);
	});
});

describe('salesLeadTime', () => {
	const eventDate = '2026-06-15 00:00:00';

	it('buckets confirmed tickets by whole days before the event, desc', () => {
		const participants = [
			signedUp({ created_at: '2026-06-01 00:00:00' }), // 14 days out
			signedUp({ created_at: '2026-06-14 00:00:00' }), // 1 day out
			signedUp({ created_at: '2026-06-14 12:00:00' }), // 0 days out
		];
		expect(salesLeadTime(participants, eventDate)).toEqual([
			{ daysOut: 14, count: 1 },
			{ daysOut: 13, count: 0 },
			{ daysOut: 12, count: 0 },
			{ daysOut: 11, count: 0 },
			{ daysOut: 10, count: 0 },
			{ daysOut: 9, count: 0 },
			{ daysOut: 8, count: 0 },
			{ daysOut: 7, count: 0 },
			{ daysOut: 6, count: 0 },
			{ daysOut: 5, count: 0 },
			{ daysOut: 4, count: 0 },
			{ daysOut: 3, count: 0 },
			{ daysOut: 2, count: 0 },
			{ daysOut: 1, count: 1 },
			{ daysOut: 0, count: 1 },
		]);
	});

	it('ignores rows with missing/unparseable created_at', () => {
		const participants = [
			signedUp({ created_at: null }),
			signedUp({ created_at: '2026-06-14 00:00:00' }), // 1 day out
		];
		expect(salesLeadTime(participants, eventDate)).toEqual([
			{ daysOut: 1, count: 1 },
			{ daysOut: 0, count: 0 },
		]);
	});

	it('returns [] when the event date is missing', () => {
		expect(
			salesLeadTime([signedUp({ created_at: eventDate })], null)
		).toEqual([]);
	});
});

describe('EventStatistics component', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	function mockApi(participants, eventDate = '2026-06-15 00:00:00') {
		apiFetch.mockImplementation((opts) => {
			if (opts.path.endsWith('/participants')) {
				return Promise.resolve(participants);
			}
			return Promise.resolve({ event_date: eventDate });
		});
	}

	it('renders the three views and the exclusion note', async () => {
		mockApi([
			signedUp({
				ticket_option_ids: [1],
				ticket_option_names: ['Yoga'],
				created_at: '2026-06-10 00:00:00',
			}),
			// Excluded rows: not signed_up.
			{ label: 'pending_payment', ticket_option_ids: [1] },
			{ label: 'interested', ticket_option_ids: [] },
		]);

		render(<EventStatistics eventDateId={42} />);

		await waitFor(() =>
			expect(screen.getByText('People per activity')).toBeInTheDocument()
		);
		expect(screen.getByText('Activities per person')).toBeInTheDocument();
		expect(screen.getByText('Sales lead time')).toBeInTheDocument();
		// 2 of the 3 rows are excluded (pending_payment + interested).
		// getAllByText: WordPress Notice mirrors its text into an a11y live region.
		expect(screen.getAllByText(/2 excluded/).length).toBeGreaterThan(0);
	});

	it('shows an empty-state when there are no confirmed participants', async () => {
		mockApi([{ label: 'interested', ticket_option_ids: [] }]);

		render(<EventStatistics eventDateId={42} />);

		await waitFor(() =>
			expect(
				screen.getAllByText(/No confirmed participants yet/).length
			).toBeGreaterThan(0)
		);
		expect(
			screen.queryByText('People per activity')
		).not.toBeInTheDocument();
	});
});
