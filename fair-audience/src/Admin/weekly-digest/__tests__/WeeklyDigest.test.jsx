/**
 * @jest-environment jsdom
 *
 * Component tests for the Weekly Digest admin page (#916, PR 4): loading the
 * config, saving settings, previewing, and sending a test digest.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import WeeklyDigest from '../WeeklyDigest.js';

jest.mock('@wordpress/api-fetch');

const CONFIG = {
	enabled: false,
	source_slug: '',
	day_of_week: 1,
	time_of_day: '08:00',
	week_scope: 'current',
	skip_empty: true,
	subject: 'This week’s events: {week_start} – {week_end}',
	intro: '',
	outro: '',
};

const SOURCES = [
	{ slug: 'main-calendar', name: 'Main Calendar' },
	{ slug: 'meetups', name: 'Meetups' },
];

function mockApiFetch({
	config = CONFIG,
	lastSentWeek = '',
	lastRunResult = {},
	nextSend = '',
	sources = SOURCES,
} = {}) {
	apiFetch.mockImplementation(({ path, method }) => {
		if (
			path === '/fair-audience/v1/weekly-digest' &&
			(!method || method === 'GET')
		) {
			return Promise.resolve({
				config,
				last_sent_week: lastSentWeek,
				last_run_result: lastRunResult,
				next_send: nextSend,
			});
		}
		if (path === '/fair-audience/v1/weekly-digest' && method === 'PUT') {
			return Promise.resolve({ config });
		}
		if (path === '/fair-audience/v1/weekly-digest/sources') {
			return Promise.resolve(sources);
		}
		if (path === '/fair-audience/v1/weekly-digest/preview') {
			return Promise.resolve({
				subject: 'Events this week',
				html: '<p>Standup at 9am</p>',
				week: { start: '2026-07-06', end: '2026-07-12' },
				empty: false,
			});
		}
		if (path === '/fair-audience/v1/weekly-digest/test') {
			return Promise.resolve({ sent_to: 'admin@example.test' });
		}
		return Promise.reject(new Error(`Unhandled apiFetch call: ${path}`));
	});
}

beforeEach(() => {
	window.wp = {
		editor: {
			initialize: jest.fn(),
			remove: jest.fn(),
		},
	};
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
	delete window.wp;
});

describe('WeeklyDigest — loading', () => {
	it('loads config and sources, then renders the settings form', async () => {
		mockApiFetch();
		render(<WeeklyDigest />);

		expect(
			await screen.findByRole('button', { name: 'Save settings' })
		).toBeInTheDocument();

		expect(
			screen.getByRole('checkbox', { name: 'Send the weekly digest' })
		).not.toBeChecked();
		expect(
			screen.getByText('The digest has not run yet.')
		).toBeInTheDocument();

		// SelectControl's 36px default size is deprecated as of WP 6.8;
		// pre-existing in this component, not part of this change.
		expect(console).toHaveWarned();
	});
});

describe('WeeklyDigest — save settings', () => {
	it('sends the updated config via PUT and shows a success notice', async () => {
		mockApiFetch();
		render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		fireEvent.click(
			screen.getByRole('checkbox', { name: 'Send the weekly digest' })
		);
		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		await waitFor(() =>
			expect(apiFetch).toHaveBeenCalledWith(
				expect.objectContaining({
					path: '/fair-audience/v1/weekly-digest',
					method: 'PUT',
					data: expect.objectContaining({ enabled: true }),
				})
			)
		);

		expect(
			(await screen.findAllByText('Weekly digest settings saved.'))[0]
		).toBeInTheDocument();
	});
});

describe('WeeklyDigest — preview', () => {
	it('renders the returned subject and HTML', async () => {
		mockApiFetch();
		render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

		expect(await screen.findByText('Events this week')).toBeInTheDocument();
		expect(screen.getByText('Standup at 9am')).toBeInTheDocument();
	});
});

describe('WeeklyDigest — send test', () => {
	it('sends a test digest and shows the recipient in the notice', async () => {
		mockApiFetch();
		render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		fireEvent.click(
			screen.getByRole('button', { name: 'Send test to me' })
		);

		expect(
			(
				await screen.findAllByText(
					'Test digest sent to admin@example.test.'
				)
			)[0]
		).toBeInTheDocument();
	});
});

describe('WeeklyDigest — last run summary', () => {
	it('shows the last-sent week and status when available', async () => {
		mockApiFetch({
			lastSentWeek: '2026-W27',
			lastRunResult: { status: 'sent', timestamp: '2026-07-06 08:00:00' },
		});
		render(<WeeklyDigest />);

		expect(
			await screen.findByText('Last sent for week 2026-W27 — sent')
		).toBeInTheDocument();
	});

	it('shows the next scheduled send when the digest is enabled', async () => {
		mockApiFetch({
			config: { ...CONFIG, enabled: true },
			nextSend: '2026-07-20T08:00:00+02:00',
		});
		render(<WeeklyDigest />);

		expect(await screen.findByText(/^Next digest:/)).toBeInTheDocument();
	});

	it('hides the next-send line when the digest is disabled', async () => {
		mockApiFetch({
			config: { ...CONFIG, enabled: false },
			nextSend: '2026-07-20T08:00:00+02:00',
		});
		render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		expect(screen.queryByText(/^Next digest:/)).not.toBeInTheDocument();
	});
});

describe('WeeklyDigest — quicktags editors', () => {
	it('initializes and removes the quicktags editor for intro and outro', async () => {
		mockApiFetch();
		const { unmount } = render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		expect(window.wp.editor.initialize).toHaveBeenCalledWith(
			'fair-audience-digest-intro',
			expect.objectContaining({ quicktags: true, tinymce: false })
		);
		expect(window.wp.editor.initialize).toHaveBeenCalledWith(
			'fair-audience-digest-outro',
			expect.objectContaining({ quicktags: true, tinymce: false })
		);

		unmount();

		expect(window.wp.editor.remove).toHaveBeenCalledWith(
			'fair-audience-digest-intro'
		);
		expect(window.wp.editor.remove).toHaveBeenCalledWith(
			'fair-audience-digest-outro'
		);
	});

	it('sends the current intro/outro textarea HTML when saving', async () => {
		mockApiFetch();
		render(<WeeklyDigest />);

		await screen.findByRole('button', { name: 'Save settings' });

		fireEvent.change(
			document.getElementById('fair-audience-digest-intro'),
			{ target: { value: '<p>Hello <strong>there</strong></p>' } }
		);
		fireEvent.change(
			document.getElementById('fair-audience-digest-outro'),
			{ target: { value: '<p>Bye</p>' } }
		);

		fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

		await waitFor(() =>
			expect(apiFetch).toHaveBeenCalledWith(
				expect.objectContaining({
					path: '/fair-audience/v1/weekly-digest',
					method: 'PUT',
					data: expect.objectContaining({
						intro: '<p>Hello <strong>there</strong></p>',
						outro: '<p>Bye</p>',
					}),
				})
			)
		);
	});
});
