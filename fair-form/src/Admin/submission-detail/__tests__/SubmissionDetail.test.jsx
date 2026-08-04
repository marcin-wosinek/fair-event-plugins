/**
 * @jest-environment jsdom
 *
 * Component test for the Submission Detail page (#1166): the mobile layout
 * fix relies on the root carrying `wrap fair-form-submission-detail` so the
 * scoped stylesheet actually applies — pin that class contract, plus that
 * both tables render, so a future refactor can't silently break the
 * selector the CSS depends on (as happened in 7331b65b).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SubmissionDetail from '../SubmissionDetail.js';

jest.mock('@wordpress/api-fetch');

const SUBMISSION = {
	id: 117,
	title: 'Form Submission',
	participant_id: 0,
	participant_name: 'Jane Doe',
	participant_email: 'jane@example.com',
	created_at: '2026-01-15 10:00:00',
	event_date_id: 0,
	event_name: '',
	answers: [
		{
			question_key: 'q1',
			question_text: 'How did you hear about us?',
			question_type: 'short_text',
			answer_value: 'Google',
		},
	],
};

const SUBMISSION_WITH_EVENT_DETAILS = {
	...SUBMISSION,
	answers: [
		{
			question_key: 'website',
			question_text: 'Event page',
			question_type: 'url',
			answer_value: 'https://example.com/my-event',
			event_details: {
				title: 'Community Picnic',
				start_datetime: '2026-09-12 18:00:00',
				end_datetime: '2026-09-12 20:00:00',
				all_day: false,
				location: 'Central Park',
				source: 'schema',
			},
		},
	],
};

beforeEach(() => {
	window.history.pushState(
		{},
		'',
		'/wp-admin/admin.php?page=fair-form-submission-detail&submission_id=117'
	);
	apiFetch.mockResolvedValue(SUBMISSION);
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('SubmissionDetail', () => {
	it('renders the root with the wrap and page classes, and both tables', async () => {
		const { container } = render(<SubmissionDetail />);

		await screen.findByText('Google');

		const root = container.querySelector(
			'.wrap.fair-form-submission-detail'
		);
		expect(root).toBeInTheDocument();

		expect(
			screen.getByRole('columnheader', { name: 'Question' })
		).toBeInTheDocument();
		expect(screen.getByText('Submitted by')).toBeInTheDocument();
	});

	it('renders captured event details beneath a url answer, marked as read from the page', async () => {
		apiFetch.mockResolvedValue(SUBMISSION_WITH_EVENT_DETAILS);

		render(<SubmissionDetail />);

		await screen.findByText('https://example.com/my-event');

		expect(
			screen.getByText('Read from the linked page:')
		).toBeInTheDocument();
		expect(screen.getByText('Community Picnic')).toBeInTheDocument();
		expect(screen.getByText('Central Park')).toBeInTheDocument();
	});

	it('renders a url answer with no captured details exactly as before', async () => {
		const { container } = render(<SubmissionDetail />);

		await screen.findByText('Google');

		expect(
			container.querySelector(
				'.fair-form-submission-detail__event-details'
			)
		).not.toBeInTheDocument();
	});
});
