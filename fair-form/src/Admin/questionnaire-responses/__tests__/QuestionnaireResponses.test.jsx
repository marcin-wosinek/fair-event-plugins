/**
 * @jest-environment jsdom
 *
 * Component tests for the per-form Questionnaire Responses table (#1268):
 * the participant columns, the "Add participants to group" button, and the
 * export column picker must all follow whether the loaded responses actually
 * carry a participant link — not the presence of fair-audience itself — so a
 * standalone form's responses aren't shown next to five permanently empty
 * columns and a permanently-disabled button.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import QuestionnaireResponses from '../QuestionnaireResponses.js';

jest.mock('@wordpress/api-fetch');

const STANDALONE_RESPONSES = [
	{
		id: 1,
		participant_id: 0,
		participant_name: '',
		participant_email: '',
		participant_status: '',
		participant_mailing: '',
		participant_categories: [],
		created_at: '2026-01-15 10:00:00',
		answers: [
			{
				question_key: 'q1',
				question_text: 'How did you hear about us?',
				question_type: 'short_text',
				answer_value: 'Google',
			},
		],
	},
];

const LINKED_RESPONSES = [
	{
		id: 2,
		participant_id: 7,
		participant_name: 'Jane Doe',
		participant_email: 'jane@example.com',
		participant_status: 'confirmed',
		participant_mailing: 'marketing',
		participant_categories: [],
		created_at: '2026-01-16 11:00:00',
		answers: [
			{
				question_key: 'q1',
				question_text: 'How did you hear about us?',
				question_type: 'short_text',
				answer_value: 'Friend',
			},
		],
	},
];

function mockResponses(responses) {
	apiFetch.mockImplementation(({ path }) => {
		if (path.startsWith('/fair-form/v1/questionnaire-responses')) {
			return Promise.resolve(responses);
		}
		if (path.startsWith('/fair-audience/v1/groups')) {
			return Promise.resolve([]);
		}
		return Promise.resolve([]);
	});
}

beforeEach(() => {
	jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
});

describe('QuestionnaireResponses — standalone (no participant link)', () => {
	it('hides participant columns, hides the group button, and links the date to the detail view', async () => {
		mockResponses(STANDALONE_RESPONSES);

		render(<QuestionnaireResponses />);

		await screen.findByText('Google');

		expect(
			screen.queryByRole('columnheader', { name: 'Email' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', { name: 'Status' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', { name: 'Mailing' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('columnheader', {
				name: 'Subscribed Categories',
			})
		).not.toBeInTheDocument();

		expect(
			screen.queryByRole('button', {
				name: 'Add participants to group',
			})
		).not.toBeInTheDocument();

		const dateLink = screen.getByRole('link', {
			name: new Date('2026-01-15 10:00:00Z').toLocaleString(),
		});
		expect(dateLink).toHaveAttribute(
			'href',
			'admin.php?page=fair-form-submission-detail&submission_id=1'
		);
	});
});

describe('QuestionnaireResponses — linked to participants', () => {
	it('shows participant columns and the group button', async () => {
		mockResponses(LINKED_RESPONSES);

		render(<QuestionnaireResponses />);

		await screen.findByText('Friend');

		expect(
			screen.getByRole('columnheader', { name: 'Email' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('columnheader', { name: 'Status' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('columnheader', { name: 'Mailing' })
		).toBeInTheDocument();

		expect(
			screen.getByRole('button', { name: 'Add participants to group' })
		).toBeInTheDocument();

		const nameLink = screen.getByRole('link', { name: 'Jane Doe' });
		expect(nameLink).toHaveAttribute(
			'href',
			'admin.php?page=fair-audience-participant-detail&participant_id=7'
		);
	});
});

describe('QuestionnaireResponses — row actions', () => {
	it('offers a View action that navigates to the submission detail page', async () => {
		mockResponses(STANDALONE_RESPONSES);

		render(<QuestionnaireResponses />);
		const row = (await screen.findByText('Google')).closest('tr');

		fireEvent.click(within(row).getByRole('button', { name: 'Actions' }));

		expect(
			await screen.findByRole('menuitem', { name: 'View' })
		).toBeInTheDocument();
	});
});

describe('QuestionnaireResponses — empty state', () => {
	it('renders without throwing when there are no responses', async () => {
		mockResponses([]);

		render(<QuestionnaireResponses />);

		expect(await screen.findByText('No results')).toBeInTheDocument();
	});
});
