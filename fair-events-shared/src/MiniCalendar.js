/**
 * MiniCalendar — shared month-grid primitive.
 *
 * Renders a paged set of month grids between `minDate` and `maxDate`
 * (inclusive, Y-m-d strings) and delegates every day cell to a caller-supplied
 * `dayProps(dateStr, date)` descriptor, so callers can render read-only
 * highlighted calendars (fair-events' RecurrenceCalendar) and click-to-toggle
 * pickers (fair-events' SeriesModal) through the identical grid/paging code.
 *
 * `dayProps` may return:
 *   - `href`                render the cell as a link (navigation)
 *   - `interactive`         render the cell as a button (`onActivate`, `ariaPressed`)
 *   - `background`/`color`/`opacity`/`border`/`fontWeight`/`textDecoration`
 *   - `ariaLabel`           overrides the default full-date label
 *   - `tooltip`             wraps the cell in a Tooltip
 *
 * A day with none of `href`/`interactive` renders as a plain, non-operable
 * cell.
 *
 * @package FairEventsShared
 */

import { useState, useMemo, useEffect } from '@wordpress/element';
import {
	Button,
	Tooltip,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	formatLocalDate,
	getWeekdayLabels,
	calculateLeadingDays,
} from './calendarUtils.js';

function computeMonthRange(minDate, maxDate) {
	if (!minDate) return [];
	const first = new Date(`${minDate}T00:00:00`);
	const last = new Date(`${maxDate || minDate}T00:00:00`);
	const result = [];
	const current = new Date(first.getFullYear(), first.getMonth(), 1);
	const end = new Date(last.getFullYear(), last.getMonth(), 1);
	while (current <= end) {
		result.push(new Date(current));
		current.setMonth(current.getMonth() + 1);
	}
	return result;
}

export function computeVisibleMonths(width) {
	if (width < 600) return 1;
	if (width < 900) return 2;
	if (width < 1200) return 3;
	if (width < 1500) return 4;
	return 5;
}

/**
 * @param {Object}   props
 * @param {string}   [props.minDate]                First date (Y-m-d) the calendar must cover.
 * @param {string}   [props.maxDate]                 Last date (Y-m-d) the calendar must cover.
 * @param {Function} props.dayProps                  `(dateStr, date) => descriptor` for each day cell.
 * @param {boolean}  [props.allowForwardBeyondRange] Keep "next months" enabled past `maxDate` (for pickers).
 */
export default function MiniCalendar({
	minDate,
	maxDate,
	dayProps,
	allowForwardBeyondRange = false,
}) {
	const dataMonths = useMemo(
		() => computeMonthRange(minDate, maxDate),
		[minDate, maxDate]
	);

	// Lets a picker page forward past the data-derived range; reset whenever
	// the underlying range changes so a newly-picked date that already
	// extends the range isn't double-counted.
	const [extraMonths, setExtraMonths] = useState(0);
	useEffect(() => {
		setExtraMonths(0);
	}, [minDate, maxDate]);

	const months = useMemo(() => {
		const result = [...dataMonths];
		let last = result.length
			? result[result.length - 1]
			: new Date(new Date().getFullYear(), new Date().getMonth(), 1);
		for (let i = 0; i < extraMonths; i++) {
			last = new Date(last.getFullYear(), last.getMonth() + 1, 1);
			result.push(last);
		}
		return result;
	}, [dataMonths, extraMonths]);

	const [startIndex, setStartIndex] = useState(0);
	const [visibleCount, setVisibleCount] = useState(() =>
		computeVisibleMonths(
			typeof window !== 'undefined' ? window.innerWidth : 1280
		)
	);
	useEffect(() => {
		const onResize = () =>
			setVisibleCount(computeVisibleMonths(window.innerWidth));
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// Keep the current page in range when the months list shrinks (e.g. a
	// paged-forward extension collapses back into the data-derived range).
	useEffect(() => {
		setStartIndex((current) =>
			Math.min(current, Math.max(0, months.length - visibleCount))
		);
	}, [months.length, visibleCount]);

	if (months.length === 0) return null;

	const visibleMonths = months.slice(startIndex, startIndex + visibleCount);
	const canGoBack = startIndex > 0;
	const canGoForward =
		allowForwardBeyondRange || startIndex + visibleCount < months.length;

	const handleForward = () => {
		if (startIndex + visibleCount < months.length) {
			setStartIndex(
				Math.min(months.length - 1, startIndex + visibleCount)
			);
		} else if (allowForwardBeyondRange) {
			setExtraMonths((n) => n + visibleCount);
			setStartIndex(startIndex + visibleCount);
		}
	};

	const weekdayLabels = getWeekdayLabels(1, { weekday: 'narrow' });
	const todayStr = formatLocalDate(new Date());

	const showNav = months.length > visibleCount || allowForwardBeyondRange;

	return (
		<div>
			{showNav && (
				<HStack
					alignment="center"
					style={{ marginBottom: '12px', justifyContent: 'flex-end' }}
				>
					<HStack spacing={1} style={{ width: 'auto' }}>
						<Button
							icon="arrow-left-alt2"
							size="small"
							disabled={!canGoBack}
							label={__('Previous months', 'fair-events')}
							onClick={() =>
								setStartIndex(
									Math.max(0, startIndex - visibleCount)
								)
							}
						/>
						<Button
							icon="arrow-right-alt2"
							size="small"
							disabled={!canGoForward}
							label={__('Next months', 'fair-events')}
							onClick={handleForward}
						/>
					</HStack>
				</HStack>
			)}
			<div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
				{visibleMonths.map((monthDate) => (
					<MiniMonth
						key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}
						monthDate={monthDate}
						weekdayLabels={weekdayLabels}
						todayStr={todayStr}
						dayProps={dayProps}
					/>
				))}
			</div>
		</div>
	);
}

function MiniMonth({ monthDate, weekdayLabels, todayStr, dayProps }) {
	const year = monthDate.getFullYear();
	const month = monthDate.getMonth();
	const firstDay = new Date(year, month, 1);
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const leadingDays = calculateLeadingDays(firstDay, 1);

	const monthLabel = firstDay.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
	});

	const cells = [];

	for (let i = 0; i < leadingDays; i++) {
		cells.push(<div key={`lead-${i}`} />);
	}

	for (let day = 1; day <= daysInMonth; day++) {
		const date = new Date(year, month, day);
		const dateStr = formatLocalDate(date);
		cells.push(
			<DayCell
				key={dateStr}
				date={date}
				dateStr={dateStr}
				day={day}
				todayStr={todayStr}
				dayProps={dayProps}
			/>
		);
	}

	return (
		<div style={{ minWidth: '220px' }}>
			<div
				style={{
					fontWeight: 600,
					marginBottom: '8px',
					fontSize: '13px',
					textAlign: 'center',
				}}
			>
				{monthLabel}
			</div>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(7, 28px)',
					gap: '2px',
					justifyContent: 'center',
				}}
			>
				{weekdayLabels.map((label, i) => (
					<div
						key={i}
						style={{
							textAlign: 'center',
							fontSize: '11px',
							color: '#757575',
							fontWeight: 600,
							height: '20px',
							lineHeight: '20px',
						}}
					>
						{label}
					</div>
				))}
				{cells}
			</div>
		</div>
	);
}

function DayCell({ date, dateStr, day, todayStr, dayProps }) {
	const props = dayProps(dateStr, date) || {};
	const isToday = dateStr === todayStr;
	const fullDateLabel = date.toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
	const ariaLabel = props.ariaLabel || fullDateLabel;

	const cellStyle = {
		width: '28px',
		height: '28px',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: '4px',
		fontSize: '12px',
		fontWeight: props.fontWeight ?? 400,
		background: props.background || 'transparent',
		color: props.color || '#1e1e1e',
		opacity: props.opacity ?? 1,
		border: props.border || (isToday ? '2px solid #1e1e1e' : 'none'),
		textDecoration: props.textDecoration || 'none',
		position: 'relative',
	};

	let cell;

	if (props.href) {
		cell = (
			<a
				href={props.href}
				aria-label={ariaLabel}
				style={{ textDecoration: 'none', cursor: 'pointer' }}
			>
				<div style={cellStyle}>{day}</div>
			</a>
		);
	} else if (props.interactive) {
		cell = (
			<button
				type="button"
				onClick={props.onActivate}
				disabled={!!props.disabled}
				aria-label={ariaLabel}
				aria-pressed={!!props.ariaPressed}
				style={{
					...cellStyle,
					cursor: props.disabled ? 'default' : 'pointer',
					padding: 0,
					font: 'inherit',
				}}
			>
				{day}
			</button>
		);
	} else {
		cell = <div style={cellStyle}>{day}</div>;
	}

	if (props.tooltip) {
		return <Tooltip text={props.tooltip}>{cell}</Tooltip>;
	}

	return cell;
}
