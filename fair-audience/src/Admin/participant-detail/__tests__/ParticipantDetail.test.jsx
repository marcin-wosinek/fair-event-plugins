/**
 * @jest-environment jsdom
 *
 * Component test for the Participant Detail page (#1167): the mobile layout
 * fix relies on the root carrying `wrap fair-audience-participant-detail`
 * and the activity tables carrying `fair-audience-participant-detail__table`
 * so the scoped stylesheet actually applies — pin that class contract, plus
 * that the Profile rows and both activity tables render, so a future
 * refactor can't silently break the selector the CSS depends on.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ParticipantDetail from '../ParticipantDetail.js';

jest.mock('@wordpress/api-fetch');

const PARTICIPANT = {
	id: 144,
	name: 'Jane',
	surname: 'Doe',
	email: 'jane@example.com',
	status: 'confirmed',
	email_profile: 'marketing',
	weekly_summary_opt_out: false,
	phone: '',
	instagram: '',
	wp_user: null,
	created_at: '2026-01-15 10:00:00',
};

const ACTIVITY = {
	events: [
		{
			id: 1,
			event_date_id: 5,
			event_title: 'Spring Meetup',
			start_datetime: '2026-03-01 18:00:00',
			label: 'signed_up',
			created_at: '2026-01-15 10:00:00',
			transaction_id: 0,
			transaction_status: null,
		},
	],
	submissions: [
		{
			id: 9,
			title: 'Signup form',
			page_title: 'Signup',
			event_title: 'Spring Meetup',
			created_at: '2026-01-15 10:00:00',
		},
	],
};

beforeEach(() => {
	window.history.pushState(
		{},
		'',
		'/wp-admin/admin.php?page=fair-audience-participant-detail&participant_id=144'
	);
	apiFetch.mockImplementation(({ path }) => {
		if (path.endsWith('/activity')) {
			return Promise.resolve(ACTIVITY);
		}
		return Promise.resolve(PARTICIPANT);
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('ParticipantDetail', () => {
	it('renders the root with the wrap and page classes, and both activity tables', async () => {
		const { container } = render(<ParticipantDetail />);

		await screen.findAllByText('Jane Doe');

		const root = container.querySelector(
			'.wrap.fair-audience-participant-detail'
		);
		expect(root).toBeInTheDocument();

		const tables = container.querySelectorAll(
			'.fair-audience-participant-detail__table'
		);
		expect(tables).toHaveLength(2);

		const cards = container.querySelectorAll(
			'.fair-audience-participant-detail__card'
		);
		expect(cards).toHaveLength(3);

		expect(
			container.querySelector('.fair-audience-participant-detail__back')
		).toBeInTheDocument();

		expect(screen.getByText('jane@example.com')).toBeInTheDocument();
		expect(screen.getAllByText('Spring Meetup').length).toBeGreaterThan(0);
		expect(screen.getByText('Signup form')).toBeInTheDocument();
	});
});
