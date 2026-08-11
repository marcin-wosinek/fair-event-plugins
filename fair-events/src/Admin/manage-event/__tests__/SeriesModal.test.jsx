/**
 * @jest-environment jsdom
 *
 * Tests for SeriesModal's "Regular schedule" and "Irregular series" tabs
 * (#979, #1127, #1414).
 *
 * Covers:
 *   - Regular tab: a display-only calendar highlights every rule-generated
 *     date and a compact "N dates, until <date>" summary line replaces the
 *     old text list.
 *   - Irregular tab: seeding the session list from existing generated
 *     occurrences, the master's own date is fixed (disabled button, can't be
 *     toggled), clicking an unselected day adds a session and clicking a
 *     selected day removes every session on it, adding a second session to
 *     an already-selected date via "+ Add session" instead of being
 *     rejected as a duplicate, editing a session's own time, removing one
 *     session while its same-day sibling survives, and confirm sends
 *     { recurrence_mode: 'manual', manual_sessions }.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { formatDateOnly } from 'fair-events-shared';
import SeriesModal from '../SeriesModal.js';

jest.mock('@wordpress/api-fetch');

// Matches the full-date aria-label MiniCalendar builds by default.
function fullDateLabel(dateStr) {
	return formatDateOnly(dateStr, 'long');
}

beforeEach(() => {
	// The Regular schedule tab renders RecurrenceControl, which uses
	// @wordpress/components' deprecated 36px default SelectControl/
	// NumberControl size, and TabPanel (ariakit) commits its tab ids in a
	// post-mount effect — both emit console noise unrelated to what these
	// tests exercise. Matches the suppression convention in
	// ManageEventApp.test.jsx.
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});

	// jsdom has no layout engine; @wordpress/components' HStack/Button use
	// matchMedia for responsive spacing, which jsdom doesn't implement.
	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
});

afterEach(() => {
	jest.restoreAllMocks();
});

// TabPanel (ariakit) sets up its tab ids in an effect after mount; flushing a
// tick via waitFor keeps that update wrapped in act() before we interact.
async function renderModal(props) {
	const utils = render(<SeriesModal {...props} />);
	await waitFor(() =>
		expect(
			screen.getByRole('tab', { name: 'Regular schedule' })
		).toBeInTheDocument()
	);
	return utils;
}

function openIrregularTab() {
	fireEvent.click(screen.getByRole('tab', { name: 'Irregular series' }));
}

const baseProps = {
	eventDateId: 1,
	initialRrule: null,
	initialRecurrenceMode: null,
	startDatetime: '2026-07-01 18:00:00',
	endDatetime: '2026-07-01 20:00:00',
	generatedOccurrences: [],
	onClose: () => {},
	onSaved: () => {},
	onImpact: () => {},
};

it('Regular tab shows a display-only calendar and a compact dates summary', async () => {
	await renderModal(baseProps);

	// Default recurrence is weekly, 10 occurrences (DEFAULT_RECURRENCE).
	expect(screen.getByText('July 2026')).toBeInTheDocument();
	expect(screen.getByText(/10 dates, until/)).toBeInTheDocument();

	// Display-only: no toggle buttons in the calendar (aria-pressed is only
	// used by the Irregular tab's picker).
	expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
	expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0);
});

it('seeds the session list from existing generated occurrences when editing a manual series', async () => {
	await renderModal({
		...baseProps,
		initialRecurrenceMode: 'manual',
		generatedOccurrences: [
			{
				id: 2,
				start_datetime: '2026-07-08 09:00:00',
				end_datetime: '2026-07-08 11:00:00',
			},
			{
				id: 3,
				start_datetime: '2026-07-20 09:00:00',
				end_datetime: '2026-07-20 11:00:00',
			},
		],
	});

	openIrregularTab();

	const masterButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-01'),
	});
	expect(masterButton).toBeDisabled();
	expect(masterButton).toHaveAttribute('aria-pressed', 'true');

	expect(
		screen.getByRole('button', { name: fullDateLabel('2026-07-08') })
	).toHaveAttribute('aria-pressed', 'true');
	expect(
		screen.getByRole('button', { name: fullDateLabel('2026-07-20') })
	).toHaveAttribute('aria-pressed', 'true');
	expect(
		screen.getByRole('button', { name: fullDateLabel('2026-07-15') })
	).toHaveAttribute('aria-pressed', 'false');

	// One row per session in the list, with its own editable start/end time.
	expect(screen.getAllByDisplayValue('09:00')).toHaveLength(2);
	expect(screen.getAllByDisplayValue('11:00')).toHaveLength(2);
});

it('clicking an unselected day adds a session and clicking it again removes it, keeping the master date fixed', async () => {
	await renderModal(baseProps);

	openIrregularTab();

	const masterButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-01'),
	});
	expect(masterButton).toBeDisabled();

	fireEvent.click(masterButton);
	expect(masterButton).toBeDisabled();

	const dayButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-05'),
	});
	expect(dayButton).toHaveAttribute('aria-pressed', 'false');

	fireEvent.click(dayButton);
	expect(dayButton).toHaveAttribute('aria-pressed', 'true');
	// A seeded session takes the master's own time/duration.
	expect(screen.getByDisplayValue('18:00')).toBeInTheDocument();
	expect(screen.getByDisplayValue('20:00')).toBeInTheDocument();

	fireEvent.click(dayButton);
	expect(dayButton).toHaveAttribute('aria-pressed', 'false');
	expect(screen.queryByDisplayValue('18:00')).not.toBeInTheDocument();
});

it('adding a second session to an already-selected date is not rejected as a duplicate, and shows a badge', async () => {
	await renderModal({
		...baseProps,
		generatedOccurrences: [
			{
				id: 5,
				start_datetime: '2026-07-05 09:00:00',
				end_datetime: '2026-07-05 11:00:00',
			},
		],
	});

	openIrregularTab();

	// "+ Add session" appears once per selected date group — the master's
	// own date and 2026-07-05 (seeded above) both have one.
	const addButtons = screen.getAllByRole('button', {
		name: '+ Add session',
	});
	expect(addButtons).toHaveLength(2);

	// Add a second session on 2026-07-05, which already has one.
	fireEvent.click(addButtons[1]);

	// Two independent start-time fields now exist for that date's sessions.
	expect(screen.getAllByLabelText('Session start time')).toHaveLength(2);

	// The calendar badge reflects the day now holding 2 sessions.
	const dayButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-05'),
	});
	expect(dayButton.parentElement.querySelector('span')).toHaveTextContent(
		'2'
	);
});

it('removing one session on a shared day leaves its sibling intact', async () => {
	await renderModal({
		...baseProps,
		generatedOccurrences: [
			{
				id: 5,
				start_datetime: '2026-07-05 09:00:00',
				end_datetime: '2026-07-05 11:00:00',
			},
			{
				id: 6,
				start_datetime: '2026-07-05 14:00:00',
				end_datetime: '2026-07-05 16:00:00',
			},
		],
	});

	openIrregularTab();

	expect(screen.getByDisplayValue('09:00')).toBeInTheDocument();
	expect(screen.getByDisplayValue('14:00')).toBeInTheDocument();

	const removeButtons = screen.getAllByRole('button', {
		name: 'Remove session',
	});
	// Remove the first (09:00) session.
	fireEvent.click(removeButtons[0]);

	expect(screen.queryByDisplayValue('09:00')).not.toBeInTheDocument();
	expect(screen.getByDisplayValue('14:00')).toBeInTheDocument();
	// The date itself is still selected — one session remains.
	expect(
		screen.getByRole('button', { name: fullDateLabel('2026-07-05') })
	).toHaveAttribute('aria-pressed', 'true');
});

it('editing a session start/end time updates that session only', async () => {
	await renderModal({
		...baseProps,
		generatedOccurrences: [
			{
				id: 5,
				start_datetime: '2026-07-05 09:00:00',
				end_datetime: '2026-07-05 11:00:00',
			},
		],
	});

	openIrregularTab();

	fireEvent.change(screen.getByDisplayValue('09:00'), {
		target: { value: '13:30' },
	});

	expect(screen.getByDisplayValue('13:30')).toBeInTheDocument();
	expect(screen.getByDisplayValue('11:00')).toBeInTheDocument();
});

it('sends recurrence_mode + manual_sessions on confirm from the Irregular tab', async () => {
	apiFetch.mockResolvedValue({
		recurrence_mode: 'manual',
		generated_occurrences: [],
	});

	const onSaved = jest.fn();

	await renderModal({
		...baseProps,
		eventDateId: 7,
		onSaved,
	});

	openIrregularTab();
	fireEvent.click(
		screen.getByRole('button', { name: fullDateLabel('2026-07-15') })
	);

	fireEvent.click(screen.getByRole('button', { name: /Create series/ }));

	await waitFor(() => expect(onSaved).toHaveBeenCalled());

	expect(apiFetch).toHaveBeenCalledWith(
		expect.objectContaining({
			path: '/fair-events/v1/event-dates/7',
			method: 'PUT',
			data: {
				recurrence_mode: 'manual',
				manual_sessions: [
					{
						id: 7,
						start_datetime: '2026-07-01 18:00:00',
						end_datetime: '2026-07-01 20:00:00',
					},
					{
						id: null,
						start_datetime: '2026-07-15 18:00:00',
						end_datetime: '2026-07-15 20:00:00',
					},
				],
			},
		})
	);
});
