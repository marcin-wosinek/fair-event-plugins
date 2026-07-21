/**
 * Sale Periods Calendar Component
 *
 * Month-grid visualization for the "Sale Periods" panel: each day is shaded
 * with the color of the sale period it falls in, and the event day carries a
 * distinct marker. Display-only — thin adapter over the shared `MiniCalendar`
 * grid/paging primitive, modeled on RecurrenceCalendar.js (shading + legend).
 *
 * @package FairEvents
 */

import { Card, CardHeader, CardBody } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { MiniCalendar } from 'fair-events-shared';

// Cycled by period index; every color pairs with white cell text. Exported
// so the Sale Periods edit table can reuse the exact same colors.
export const SALE_PERIOD_COLORS = [
	'#007cba',
	'#4ab866',
	'#9b51e0',
	'#b26200',
	'#cc1818',
];

export function salePeriodColor(index) {
	return SALE_PERIOD_COLORS[index % SALE_PERIOD_COLORS.length];
}

// Deliberately distinct from MiniCalendar's built-in "today" border
// (`2px solid #1e1e1e`) so the event-day marker never blends into it when
// the event happens to be today.
const EVENT_DAY_BORDER = '3px solid #f0b849';

// The period's name, or "Period N" when unnamed — matches the legend wording.
function periodLabel(period, index) {
	return (
		period.name ||
		sprintf(
			/* translators: %d: sale period number */
			__('Period %d', 'fair-events'),
			index + 1
		)
	);
}

/**
 * @param {Object}  props
 * @param {Array}   props.salePeriods Chained sale periods (`sale_start`/`sale_end`/`name`, Y-m-d strings); consecutive periods share a boundary.
 * @param {string}  [props.eventDay]  Event start date (Y-m-d) for the event-day marker.
 * @param {boolean} [props.embedded]  Card-less render for placement inside an existing panel.
 */
export default function SalePeriodsCalendar({
	salePeriods,
	eventDay,
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

	const dayProps = (dateStr) => {
		const periodIndex = periodIndexForDate(dateStr);
		const isEventDay = dateStr === eventDay;

		let tooltip;
		if (isEventDay && periodIndex !== -1) {
			tooltip = sprintf(
				/* translators: %s: sale period name */
				__('%s (event day)', 'fair-events'),
				periodLabel(periods[periodIndex], periodIndex)
			);
		} else if (isEventDay) {
			tooltip = __('Event day', 'fair-events');
		} else if (periodIndex !== -1) {
			tooltip = periodLabel(periods[periodIndex], periodIndex);
		}

		return {
			background:
				periodIndex !== -1
					? salePeriodColor(periodIndex)
					: 'transparent',
			color: periodIndex !== -1 ? '#fff' : '#1e1e1e',
			fontWeight: periodIndex !== -1 ? 600 : 400,
			border: isEventDay ? EVENT_DAY_BORDER : undefined,
			tooltip,
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
								background: salePeriodColor(index),
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							}}
						/>
						{periodLabel(period, index)}
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
