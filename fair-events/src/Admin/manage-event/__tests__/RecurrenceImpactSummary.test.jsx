/**
 * @jest-environment jsdom
 *
 * Tests for RecurrenceImpactSummary (#947 PR 3).
 *
 * Covers:
 *   - null impact returns nothing
 *   - blocked=true (HTTP 409) shows the problematic removed occurrences
 *   - blocked=false (HTTP 200 with impact) shows an applied-changes summary
 *   - onDismiss wires up to the Notice dismissal
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import RecurrenceImpactSummary from '../RecurrenceImpactSummary.js';

const baseImpact = {
	unchanged: [],
	shifted: [],
	added: [],
	removed: [],
};

it('renders nothing when impact is null', () => {
	const { container } = render(
		<RecurrenceImpactSummary impact={null} blocked={false} />
	);
	expect(container).toBeEmptyDOMElement();
});

it('renders nothing when blocked and no problematic removals', () => {
	const impact = {
		...baseImpact,
		removed: [
			{
				id: 1,
				start_datetime: '2030-01-01 18:00:00',
				is_past: false,
				dependents: 0,
			},
		],
	};
	const { container } = render(
		<RecurrenceImpactSummary impact={impact} blocked={true} />
	);
	expect(container).toBeEmptyDOMElement();
});

it('blocked=true: shows occurrences with dependents', () => {
	const impact = {
		...baseImpact,
		removed: [
			{
				id: 5,
				start_datetime: '2026-08-15 18:00:00',
				is_past: false,
				dependents: 3,
			},
		],
	};
	render(<RecurrenceImpactSummary impact={impact} blocked={true} />);

	expect(
		screen.getByText(/This change cannot be applied/i, { selector: 'p' })
	).toBeInTheDocument();
	expect(
		screen.getByText(/3 dependent\(s\)/i, { selector: 'li' })
	).toBeInTheDocument();
});

it('blocked=true: shows past occurrences', () => {
	const impact = {
		...baseImpact,
		removed: [
			{
				id: 6,
				start_datetime: '2025-03-10 10:00:00',
				is_past: true,
				dependents: 0,
			},
		],
	};
	render(<RecurrenceImpactSummary impact={impact} blocked={true} />);

	expect(
		screen.getByText(/This change cannot be applied/i, { selector: 'p' })
	).toBeInTheDocument();
	expect(
		screen.getByText(/in the past/i, { selector: 'li' })
	).toBeInTheDocument();
});

it('blocked=false with no changes renders nothing', () => {
	const { container } = render(
		<RecurrenceImpactSummary impact={baseImpact} blocked={false} />
	);
	expect(container).toBeEmptyDOMElement();
});

it('blocked=false: shows shifted/added/removed counts', () => {
	const impact = {
		unchanged: [{ id: 1, start_datetime: '2026-07-01 18:00:00' }],
		shifted: [
			{
				id: 2,
				start_datetime: '2026-07-08 18:00:00',
				new_start_datetime: '2026-07-08 19:00:00',
				is_past: false,
				dependents: 1,
			},
		],
		added: [{ start_datetime: '2026-09-01 18:00:00' }],
		removed: [],
	};
	const { container } = render(
		<RecurrenceImpactSummary impact={impact} blocked={false} />
	);

	// Scope to the notice content div to avoid the a11y-speak region duplicate.
	const content = container.querySelector('.components-notice__content');
	expect(content).not.toBeNull();
	expect(content.textContent).toMatch(/Recurrence updated/i);
	expect(content.textContent).toMatch(/1 shifted/i);
	expect(content.textContent).toMatch(/1 added/i);
});

it('calls onDismiss when the notice is dismissed', () => {
	const onDismiss = jest.fn();
	const impact = {
		...baseImpact,
		removed: [
			{
				id: 7,
				start_datetime: '2026-08-01 18:00:00',
				is_past: false,
				dependents: 2,
			},
		],
	};
	render(
		<RecurrenceImpactSummary
			impact={impact}
			blocked={true}
			onDismiss={onDismiss}
		/>
	);

	// WP Notice dismiss button has aria-label="Close".
	const dismissButton = screen.getByRole('button', { name: /close/i });
	fireEvent.click(dismissButton);
	expect(onDismiss).toHaveBeenCalledTimes(1);
});
