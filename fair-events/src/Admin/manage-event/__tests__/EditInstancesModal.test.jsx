/**
 * @jest-environment jsdom
 *
 * Tests for EditInstancesModal (#981 Part 3).
 *
 * Covers:
 *   - Opens and lists occurrences with their cancel/restore action.
 *   - Cancel/Restore calls onToggleExdate with the occurrence's date.
 *   - Close calls onClose.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import EditInstancesModal from '../EditInstancesModal.js';

const generatedOccurrences = [
	{ id: 2, start_datetime: '2026-07-08 18:00:00', status: 'active' },
	{ id: 3, start_datetime: '2026-07-15 18:00:00', status: 'cancelled' },
];

// Matches the date formatting in EditInstancesModal.
function instanceDateLabel(dateStr) {
	return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

it('lists occurrences with Cancel / Restore actions', () => {
	render(
		<EditInstancesModal
			generatedOccurrences={generatedOccurrences}
			togglingExdate={null}
			onToggleExdate={() => {}}
			onClose={() => {}}
		/>
	);

	expect(
		screen.getByText(instanceDateLabel('2026-07-08'), { exact: false })
	).toBeInTheDocument();
	expect(
		screen.getByText(instanceDateLabel('2026-07-15'), { exact: false })
	).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
});

it('calls onToggleExdate with the date when Cancel is clicked', () => {
	const onToggleExdate = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={generatedOccurrences}
			togglingExdate={null}
			onToggleExdate={onToggleExdate}
			onClose={() => {}}
		/>
	);

	fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
	expect(onToggleExdate).toHaveBeenCalledWith('2026-07-08');
});

it('calls onToggleExdate with the date when Restore is clicked', () => {
	const onToggleExdate = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={generatedOccurrences}
			togglingExdate={null}
			onToggleExdate={onToggleExdate}
			onClose={() => {}}
		/>
	);

	fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
	expect(onToggleExdate).toHaveBeenCalledWith('2026-07-15');
});

it('calls onClose when Close is clicked', () => {
	const onClose = jest.fn();
	render(
		<EditInstancesModal
			generatedOccurrences={generatedOccurrences}
			togglingExdate={null}
			onToggleExdate={() => {}}
			onClose={onClose}
		/>
	);

	// The WP Modal chrome also renders its own "Close" dismiss button, so
	// disambiguate by taking the last one (our footer button).
	const closeButtons = screen.getAllByRole('button', { name: 'Close' });
	fireEvent.click(closeButtons[closeButtons.length - 1]);
	expect(onClose).toHaveBeenCalled();
});
