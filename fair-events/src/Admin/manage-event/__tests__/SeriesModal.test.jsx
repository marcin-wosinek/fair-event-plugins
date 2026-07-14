/**
 * @jest-environment jsdom
 *
 * Tests for the "Irregular series" hand-picked-dates editor in SeriesModal
 * (#979).
 *
 * Covers:
 *   - Seeding the date list from existing generated occurrences.
 *   - Add / remove date rows.
 *   - Duplicate-day rejection (visible Notice, confirm disabled).
 *   - Confirm sends { recurrence_mode: 'manual', manual_dates } on the
 *     Irregular tab instead of { rrule }.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import SeriesModal from '../SeriesModal.js';

jest.mock('@wordpress/api-fetch');

beforeEach(() => {
	// The Regular schedule tab renders RecurrenceControl, which uses
	// @wordpress/components' deprecated 36px default SelectControl/
	// NumberControl size, and TabPanel (ariakit) commits its tab ids in a
	// post-mount effect — both emit console noise unrelated to what these
	// tests exercise. Matches the suppression convention in
	// ManageEventApp.test.jsx.
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	jest.spyOn(console, 'error').mockImplementation(() => {});
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

it('seeds the date list from existing generated occurrences when editing a manual series', async () => {
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

	const dateInputs = screen.getAllByDisplayValue(/2026-07-/);
	expect(dateInputs.map((el) => el.value)).toEqual([
		'2026-07-01',
		'2026-07-08',
		'2026-07-20',
	]);
});

it('adds and removes date rows', async () => {
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

	expect(screen.getAllByDisplayValue('2026-07-01')).toHaveLength(1);

	fireEvent.click(screen.getByRole('button', { name: 'Add date' }));
	expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);

	fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1]);
	expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
});

it('shows a Notice and disables confirm when two rows share the same date', async () => {
	await renderModal({
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: 'manual',
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [
			{ id: 2, start_datetime: '2026-07-08 18:00:00' },
		],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	});

	const [firstDate, secondDate] = screen.getAllByDisplayValue(/2026-07-/);
	fireEvent.change(secondDate, { target: { value: firstDate.value } });

	// The WP a11y-speak live region duplicates Notice text for screen readers,
	// so there are two matches — assert at least one is present.
	expect(
		screen.getAllByText(/Each date can only be used once/).length
	).toBeGreaterThan(0);

	const confirmButton = screen.getByRole('button', {
		name: /Update series/,
	});
	expect(confirmButton).toBeDisabled();
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
	fireEvent.click(screen.getByRole('button', { name: 'Add date' }));
	const [, secondDate] = screen.getAllByDisplayValue(/2026-07-01|^$/);
	fireEvent.change(secondDate, { target: { value: '2026-07-15' } });

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
