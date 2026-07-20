/**
 * @jest-environment jsdom
 *
 * Tests for the shared MiniCalendar month-grid/paging primitive (#1127).
 *
 * Covers:
 *   - Month range derived from minDate/maxDate.
 *   - computeVisibleMonths width breakpoints.
 *   - Paging (Previous/Next) within a fixed range.
 *   - allowForwardBeyondRange keeps "Next months" enabled and pages into new
 *     months past the data-derived range.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import MiniCalendar, { computeVisibleMonths } from '../MiniCalendar.js';

function setViewportWidth(width) {
	Object.defineProperty(window, 'innerWidth', {
		writable: true,
		configurable: true,
		value: width,
	});
}

// jsdom has no layout engine; @wordpress/components' HStack/Button use
// matchMedia for responsive spacing, which jsdom doesn't implement.
beforeAll(() => {
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

describe('computeVisibleMonths', () => {
	test('narrows to one month under 600px and widens with viewport', () => {
		expect(computeVisibleMonths(320)).toBe(1);
		expect(computeVisibleMonths(700)).toBe(2);
		expect(computeVisibleMonths(1000)).toBe(3);
		expect(computeVisibleMonths(1300)).toBe(4);
		expect(computeVisibleMonths(1600)).toBe(5);
	});
});

describe('MiniCalendar', () => {
	beforeEach(() => {
		setViewportWidth(1280);
	});

	test('renders nothing when there is no date range', () => {
		const { container } = render(<MiniCalendar dayProps={() => ({})} />);
		expect(container).toBeEmptyDOMElement();
	});

	test('renders a single month grid spanning the min/max range', () => {
		render(
			<MiniCalendar
				minDate="2026-07-01"
				maxDate="2026-07-20"
				dayProps={() => ({})}
			/>
		);

		expect(screen.getByText('July 2026')).toBeInTheDocument();
		expect(screen.queryByText('June 2026')).not.toBeInTheDocument();
		expect(screen.queryByText('August 2026')).not.toBeInTheDocument();
	});

	test('spans multiple months when the range crosses a month boundary', () => {
		render(
			<MiniCalendar
				minDate="2026-07-25"
				maxDate="2026-09-05"
				dayProps={() => ({})}
			/>
		);

		expect(screen.getByText('July 2026')).toBeInTheDocument();
		expect(screen.getByText('August 2026')).toBeInTheDocument();
		expect(screen.getByText('September 2026')).toBeInTheDocument();
	});

	test('pages Previous/Next through months wider than the visible count', () => {
		setViewportWidth(320); // computeVisibleMonths -> 1
		render(
			<MiniCalendar
				minDate="2026-07-25"
				maxDate="2026-09-05"
				dayProps={() => ({})}
			/>
		);

		expect(screen.getByText('July 2026')).toBeInTheDocument();
		expect(screen.getByLabelText('Previous months')).toBeDisabled();

		fireEvent.click(screen.getByLabelText('Next months'));
		expect(screen.getByText('August 2026')).toBeInTheDocument();
		expect(screen.queryByText('July 2026')).not.toBeInTheDocument();
		expect(screen.getByLabelText('Previous months')).not.toBeDisabled();

		fireEvent.click(screen.getByLabelText('Next months'));
		expect(screen.getByText('September 2026')).toBeInTheDocument();
		expect(screen.getByLabelText('Next months')).toBeDisabled();
	});

	test('allowForwardBeyondRange keeps Next enabled and pages past the data range', () => {
		setViewportWidth(320); // computeVisibleMonths -> 1
		render(
			<MiniCalendar
				minDate="2026-07-01"
				maxDate="2026-07-01"
				dayProps={() => ({})}
				allowForwardBeyondRange
			/>
		);

		expect(screen.getByText('July 2026')).toBeInTheDocument();
		const nextButton = screen.getByLabelText('Next months');
		expect(nextButton).not.toBeDisabled();

		fireEvent.click(nextButton);
		expect(screen.getByText('August 2026')).toBeInTheDocument();
		expect(screen.getByLabelText('Next months')).not.toBeDisabled();

		fireEvent.click(screen.getByLabelText('Next months'));
		expect(screen.getByText('September 2026')).toBeInTheDocument();
	});

	test('routes each day cell through dayProps as a link, button, or plain cell', () => {
		const dayProps = (dateStr) => {
			if (dateStr === '2026-07-05') {
				return { href: '#five', ariaLabel: 'Five' };
			}
			if (dateStr === '2026-07-10') {
				return {
					interactive: true,
					ariaPressed: true,
					onActivate: jest.fn(),
					ariaLabel: 'Ten',
				};
			}
			return {};
		};

		render(
			<MiniCalendar
				minDate="2026-07-01"
				maxDate="2026-07-01"
				dayProps={dayProps}
			/>
		);

		expect(screen.getByRole('link', { name: 'Five' })).toHaveAttribute(
			'href',
			'#five'
		);
		const tenButton = screen.getByRole('button', { name: 'Ten' });
		expect(tenButton).toHaveAttribute('aria-pressed', 'true');
	});

	test('an interactive day fires onActivate on click', () => {
		const onActivate = jest.fn();
		const dayProps = (dateStr) =>
			dateStr === '2026-07-10'
				? {
						interactive: true,
						ariaPressed: false,
						onActivate,
						ariaLabel: 'Ten',
				  }
				: {};

		render(
			<MiniCalendar
				minDate="2026-07-01"
				maxDate="2026-07-01"
				dayProps={dayProps}
			/>
		);

		fireEvent.click(screen.getByRole('button', { name: 'Ten' }));
		expect(onActivate).toHaveBeenCalledTimes(1);
	});

	test('a disabled interactive day cannot be activated', () => {
		const onActivate = jest.fn();
		const dayProps = (dateStr) =>
			dateStr === '2026-07-01'
				? {
						interactive: true,
						disabled: true,
						ariaPressed: true,
						onActivate,
						ariaLabel: 'Master',
				  }
				: {};

		render(
			<MiniCalendar
				minDate="2026-07-01"
				maxDate="2026-07-01"
				dayProps={dayProps}
			/>
		);

		const masterButton = screen.getByRole('button', { name: 'Master' });
		expect(masterButton).toBeDisabled();
		fireEvent.click(masterButton);
		expect(onActivate).not.toHaveBeenCalled();
	});
});
