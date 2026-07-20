/**
 * @jest-environment jsdom
 *
 * Tests for SeriesModal's "Regular schedule" and "Irregular series" tabs
 * (#979, #1127).
 *
 * Covers:
 *   - Regular tab: a display-only calendar highlights every rule-generated
 *     date and a compact "N dates, until <date>" summary line replaces the
 *     old text list.
 *   - Irregular tab: seeding the selection from existing generated
 *     occurrences, the master's own date is fixed (disabled button, can't be
 *     toggled), clicking an unselected day adds it and clicking a selected
 *     day removes it, and confirm still sends
 *     { recurrence_mode: 'manual', manual_dates }.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SeriesModal from '../SeriesModal.js';

jest.mock('@wordpress/api-fetch');

// Matches the full-date aria-label MiniCalendar builds by default.
function fullDateLabel(dateStr) {
	return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
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

it('Regular tab shows a display-only calendar and a compact dates summary', async () => {
	await renderModal({
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	});

	// Default recurrence is weekly, 10 occurrences (DEFAULT_RECURRENCE).
	expect(screen.getByText('July 2026')).toBeInTheDocument();
	expect(screen.getByText(/10 dates, until/)).toBeInTheDocument();

	// Display-only: no toggle buttons in the calendar (aria-pressed is only
	// used by the Irregular tab's picker).
	expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
	expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0);

	// RecurrenceControl's SelectControl/NumberControl emit an unrelated
	// @wordpress/components 36px-default-size deprecation notice on mount.
	expect(console).toHaveWarned();
});

it('seeds the calendar selection from existing generated occurrences when editing a manual series', async () => {
	await renderModal({
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: 'manual',
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [
			{ id: 2, start_datetime: '2026-07-08 18:00:00' },
			{ id: 3, start_datetime: '2026-07-20 18:00:00' },
		],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
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

	expect(screen.getByText('3 dates selected')).toBeInTheDocument();
});

it('clicking an unselected day adds it and clicking it again removes it, keeping the master date fixed', async () => {
	await renderModal({
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	});

	openIrregularTab();

	const masterButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-01'),
	});
	expect(masterButton).toBeDisabled();
	expect(screen.getByText('1 dates selected')).toBeInTheDocument();

	fireEvent.click(masterButton);
	expect(screen.getByText('1 dates selected')).toBeInTheDocument();

	const dayButton = screen.getByRole('button', {
		name: fullDateLabel('2026-07-05'),
	});
	expect(dayButton).toHaveAttribute('aria-pressed', 'false');

	fireEvent.click(dayButton);
	expect(dayButton).toHaveAttribute('aria-pressed', 'true');
	expect(screen.getByText('2 dates selected')).toBeInTheDocument();

	fireEvent.click(dayButton);
	expect(dayButton).toHaveAttribute('aria-pressed', 'false');
	expect(screen.getByText('1 dates selected')).toBeInTheDocument();
});

it('sends recurrence_mode + manual_dates on confirm from the Irregular tab', async () => {
	apiFetch.mockResolvedValue({
		recurrence_mode: 'manual',
		generated_occurrences: [],
	});

	const onSaved = jest.fn();

	await renderModal({
		eventDateId: 7,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved,
		onImpact: () => {},
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
				manual_dates: ['2026-07-01', '2026-07-15'],
			},
		})
	);
});
