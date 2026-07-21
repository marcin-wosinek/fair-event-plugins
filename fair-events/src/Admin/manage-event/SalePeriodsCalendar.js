/**
 * Sale Periods Calendar Component
 *
 * Month-grid visualization for the "Sale Periods" panel: each day is shaded
 * with the color of the sale period it falls in, the event day carries a
 * distinct marker, and clicking a day moves the nearest period boundary
 * there. Thin adapter over the shared `MiniCalendar` grid/paging primitive,
 * modeled on RecurrenceCalendar.js (shading + legend) and SeriesModal.js's
 * irregularDayProps (the interactive click pattern).
 *
 * @package FairEvents
 */

import { Card, CardHeader, CardBody } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { MiniCalendar } from 'fair-events-shared';

// Cycled by period index; every color pairs with white cell text.
const SALE_PERIOD_COLORS = [
	'#007cba',
	'#4ab866',
	'#9b51e0',
	'#b26200',
	'#cc1818',
];

// Deliberately distinct from MiniCalendar's built-in "today" border
// (`2px solid #1e1e1e`) so the event-day marker never blends into it when
// the event happens to be today.
const EVENT_DAY_BORDER = '3px solid #f0b849';

function dayDiffAbs(dateStrA, dateStrB) {
	const a = new Date(`${dateStrA}T00:00:00`);
	const b = new Date(`${dateStrB}T00:00:00`);
	return Math.abs(Math.round((a - b) / (1000 * 60 * 60 * 24)));
}

// Describes which boundary a click would move, e.g. "start of 'Regular'" or
// (unnamed) "period 2". Boundary `salePeriods.length` is the trailing edge
// of the last period ("end of ..."); every other boundary is the leading
// edge of the period at that index ("start of ...").
function boundaryDescriptor(boundaryIndex, salePeriods) {
	const isLast = boundaryIndex === salePeriods.length;
	const period = salePeriods[isLast ? salePeriods.length - 1 : boundaryIndex];
	const periodNumber = isLast ? salePeriods.length : boundaryIndex + 1;

	if (!period?.name) {
		return sprintf(
			/* translators: %d: sale period number */
			__('period %d', 'fair-events'),
			periodNumber
		);
	}

	return isLast
		? sprintf(
				/* translators: %s: sale period name */
				__("end of '%s'", 'fair-events'),
				period.name
		  )
		: sprintf(
				/* translators: %s: sale period name */
				__("start of '%s'", 'fair-events'),
				period.name
		  );
}

/**
 * @param {Object}   props
 * @param {Array}    props.salePeriods    Chained sale periods (`sale_start`/`sale_end`/`name`, Y-m-d strings); consecutive periods share a boundary.
 * @param {string}   [props.eventDay]     Event start date (Y-m-d) for the event-day marker.
 * @param {Function} props.onMoveBoundary `(boundaryIndex, dateStr) => void`, called when a day is clicked.
 * @param {boolean}  [props.embedded]     Card-less render for placement inside an existing panel.
 */
export default function SalePeriodsCalendar({
	salePeriods,
	eventDay,
	onMoveBoundary,
	embedded = false,
}) {
	const periods = salePeriods || [];

	// N periods chain into N+1 boundaries: the first period's start, then
	// every period's end (each shared with the next period's start).
	const boundaries =
		periods.length > 0
			? [periods[0].sale_start, ...periods.map((p) => p.sale_end)]
			: [];

	// Hidden while any boundary is still unresolved (e.g. a freshly seeded
	// default period with a lazily-resolved sale window) — nothing sensible
	// to shade or click yet.
	if (boundaries.length === 0 || boundaries.some((b) => !b)) {
		return null;
	}

	const lastBoundary = boundaries[boundaries.length - 1];
	const minDate = boundaries[0];
	const maxDate =
		eventDay && eventDay > lastBoundary ? eventDay : lastBoundary;

	// sale_start is inclusive, sale_end is exclusive for every period
	// (including the last), matching how updateSalePeriod() chains one
	// period's end into the next one's start — a day never falls in two
	// periods at once.
	const periodIndexForDate = (dateStr) =>
		periods.findIndex(
			(p) => p.sale_start <= dateStr && dateStr < p.sale_end
		);

	// The clicked day always sits inside (or at the edge of) some gap
	// between two boundaries, so moving the nearest one to that day can
	// never push it past its neighbor — ordering stays intact by construction.
	const nearestBoundaryIndex = (dateStr) => {
		let bestIndex = 0;
		let bestDiff = Infinity;
		boundaries.forEach((b, i) => {
			const diff = dayDiffAbs(dateStr, b);
			if (diff < bestDiff) {
				bestDiff = diff;
				bestIndex = i;
			}
		});
		return bestIndex;
	};

	const dayProps = (dateStr, date) => {
		const periodIndex = periodIndexForDate(dateStr);
		const isEventDay = dateStr === eventDay;
		const boundaryIndex = nearestBoundaryIndex(dateStr);

		const formattedDate = date.toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		});
		const message = sprintf(
			/* translators: 1: which boundary a click would move (e.g. "start of 'Regular'"), 2: target date */
			__('Move the %1$s to %2$s', 'fair-events'),
			boundaryDescriptor(boundaryIndex, periods),
			formattedDate
		);

		return {
			background:
				periodIndex !== -1
					? SALE_PERIOD_COLORS[
							periodIndex % SALE_PERIOD_COLORS.length
					  ]
					: 'transparent',
			color: periodIndex !== -1 ? '#fff' : '#1e1e1e',
			fontWeight: periodIndex !== -1 ? 600 : 400,
			border: isEventDay ? EVENT_DAY_BORDER : undefined,
			interactive: true,
			onActivate: () => onMoveBoundary(boundaryIndex, dateStr),
			ariaLabel: message,
			tooltip: message,
		};
	};

	const calendarBody = (
		<>
			<MiniCalendar
				minDate={minDate}
				maxDate={maxDate}
				dayProps={dayProps}
			/>
			<div
				style={{
					marginTop: '16px',
					display: 'flex',
					gap: '16px',
					flexWrap: 'wrap',
					fontSize: '12px',
					color: '#757575',
				}}
			>
				{periods.map((period, index) => (
					<span key={period.id || `period-${index}`}>
						<span
							style={{
								display: 'inline-block',
								width: '12px',
								height: '12px',
								background:
									SALE_PERIOD_COLORS[
										index % SALE_PERIOD_COLORS.length
									],
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							}}
						/>
						{period.name ||
							sprintf(
								/* translators: %d: sale period number */
								__('Period %d', 'fair-events'),
								index + 1
							)}
					</span>
				))}
				{eventDay && (
					<span>
						<span
							style={{
								display: 'inline-block',
								width: '12px',
								height: '12px',
								border: EVENT_DAY_BORDER,
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							}}
						/>
						{__('Event day', 'fair-events')}
					</span>
				)}
			</div>
		</>
	);

	if (embedded) {
		return calendarBody;
	}

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2 style={{ margin: 0 }}>
					{__('Sale Periods Timeline', 'fair-events')}
				</h2>
			</CardHeader>
			<CardBody>{calendarBody}</CardBody>
		</Card>
	);
}
