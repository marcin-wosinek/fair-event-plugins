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

import { Card, CardHeader, CardBody, Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { MiniCalendar, formatDateOnly } from 'fair-events-shared';

// Cycled by period index; every color pairs with white cell text. Exported
// so the Sale Periods edit table can reuse the exact same colors.
export const SALE_PERIOD_COLORS = [
	'#007cba',
	'#4ab866',
	'#9b51e0',
	'#b26200',
	'#cc1818',
];

export function salePeriodColor( index ) {
	return SALE_PERIOD_COLORS[ index % SALE_PERIOD_COLORS.length ];
}

export function salePeriodIndexForDate( periods, dateStr ) {
	return periods.findIndex(
		( period ) => period.sale_start <= dateStr && dateStr < period.sale_end
	);
}

// Deliberately distinct from MiniCalendar's built-in "today" border
// (`2px solid #1e1e1e`) so the event-day marker never blends into it when
// the event happens to be today.
const EVENT_DAY_BORDER = '3px solid #f0b849';

// Dates with no ticket on sale keep their period's colour under dark diagonal
// stripes, so the period stays recognisable and the white day number stays
// readable; the day number is also struck through, so the marking never
// depends on colour alone. The legend swatch uses the same stripes on a
// neutral grey.
const UNAVAILABLE_SWATCH_COLOR = '#949494';

function unavailableBackground( color ) {
	return `repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.55) 0 3px, transparent 3px 7px), ${ color }`;
}

// The period's name, or "Period N" when unnamed.
function periodName( period, index ) {
	return (
		period.name ||
		sprintf(
			/* translators: %d: sale period number */
			__( 'Period %d', 'fair-events' ),
			index + 1
		)
	);
}

// The legend wording for a period. A period whose outer boundary was inferred
// rather than explicitly set (`isAutomaticStart`/`isAutomaticEnd`, see
// salePeriodBoundaries.js) is marked so the legend never presents a
// lazily-resolved date as if it were stored configuration.
function periodLabel( period, index ) {
	const name = periodName( period, index );

	return period.isAutomaticStart || period.isAutomaticEnd
		? sprintf(
				/* translators: %s: sale period name */
				__( '%s (automatic)', 'fair-events' ),
				name
		  )
		: name;
}

/**
 * @param {Object}  props
 * @param {Array}   props.salePeriods Chained sale periods using canonical inclusive starts and exclusive ends (`sale_start`/`sale_end`/`name`, Y-m-d strings) — pass already-resolved effective boundaries (see salePeriodBoundaries.js) rather than raw stored values so an automatic outer boundary still renders instead of hiding the calendar. Each period may also carry `isAutomaticStart`/`isAutomaticEnd` to flag an inferred boundary in the legend.
 * @param {string}  [props.eventDay]  Event start date (Y-m-d) for the event-day marker.
 * @param {Array}   [props.unavailableDates] Date ranges with no ticket on sale, one `{ periodIndex, start, end }` per affected period with inclusive Y-m-d dates (see salePeriodAvailability.js). Each is named in a warning and hatched on the grid.
 * @param {boolean} [props.embedded]  Card-less render for placement inside an existing panel.
 */
export default function SalePeriodsCalendar( {
	salePeriods,
	eventDay,
	unavailableDates,
	embedded = false,
} ) {
	const periods = salePeriods || [];
	const gaps = ( unavailableDates || [] ).filter(
		( gap ) => periods[ gap.periodIndex ]
	);

	// N periods chain into N+1 boundaries: the first period's start, then
	// every period's end (each shared with the next period's start).
	const boundaries =
		periods.length > 0
			? [ periods[ 0 ].sale_start, ...periods.map( ( p ) => p.sale_end ) ]
			: [];

	// Hidden while any boundary is still unresolved (e.g. a freshly seeded
	// default period with a lazily-resolved sale window) — nothing sensible
	// to shade or click yet.
	if ( boundaries.length === 0 || boundaries.some( ( b ) => ! b ) ) {
		return null;
	}

	const lastBoundary = boundaries[ boundaries.length - 1 ];
	const minDate = boundaries[ 0 ];
	const maxDate =
		eventDay && eventDay > lastBoundary ? eventDay : lastBoundary;

	// sale_start is inclusive, sale_end is exclusive for every period
	// (including the last), matching how updateSalePeriod() chains one
	// period's end into the next one's start — a day never falls in two
	// periods at once.
	const dayProps = ( dateStr ) => {
		const periodIndex = salePeriodIndexForDate( periods, dateStr );
		const isEventDay = dateStr === eventDay;
		const isUnavailable = gaps.some(
			( gap ) =>
				gap.periodIndex === periodIndex &&
				gap.start <= dateStr &&
				dateStr <= gap.end
		);

		let tooltip;
		if ( isEventDay && periodIndex !== -1 ) {
			tooltip = sprintf(
				/* translators: %s: sale period name */
				__( '%s (event day)', 'fair-events' ),
				periodLabel( periods[ periodIndex ], periodIndex )
			);
		} else if ( isEventDay ) {
			tooltip = __( 'Event day', 'fair-events' );
		} else if ( periodIndex !== -1 ) {
			tooltip = periodLabel( periods[ periodIndex ], periodIndex );
		}
		if ( isUnavailable ) {
			tooltip = sprintf(
				/* translators: %s: sale period name, optionally followed by "(event day)" */
				__( '%s — no tickets on sale', 'fair-events' ),
				tooltip
			);
		}

		let background = 'transparent';
		if ( isUnavailable ) {
			background = unavailableBackground(
				salePeriodColor( periodIndex )
			);
		} else if ( periodIndex !== -1 ) {
			background = salePeriodColor( periodIndex );
		}

		return {
			background,
			color: periodIndex !== -1 ? '#fff' : '#1e1e1e',
			fontWeight: periodIndex !== -1 ? 600 : 400,
			textDecoration: isUnavailable ? 'line-through' : undefined,
			border: isEventDay ? EVENT_DAY_BORDER : undefined,
			tooltip,
		};
	};

	const calendarBody = (
		<>
			{ gaps.length > 0 && (
				<Notice status="warning" isDismissible={ false }>
					<p style={ { marginTop: 0 } }>
						{ __(
							'Some sale periods have dates with no tickets on sale.',
							'fair-events'
						) }
					</p>
					<ul style={ { margin: 0, listStyle: 'disc inside' } }>
						{ gaps.map( ( gap ) => {
							const name = periodName(
								periods[ gap.periodIndex ],
								gap.periodIndex
							);
							return (
								<li key={ gap.periodIndex }>
									{ gap.start === gap.end
										? sprintf(
												/* translators: 1: sale period name, 2: date */
												__(
													'%1$s: no tickets on sale on %2$s.',
													'fair-events'
												),
												name,
												formatDateOnly( gap.start )
										  )
										: sprintf(
												/* translators: 1: sale period name, 2: first date, 3: last date */
												__(
													'%1$s: no tickets on sale from %2$s to %3$s.',
													'fair-events'
												),
												name,
												formatDateOnly( gap.start ),
												formatDateOnly( gap.end )
										  ) }
								</li>
							);
						} ) }
					</ul>
					<p style={ { marginBottom: 0 } }>
						{ __(
							'Visitors cannot get tickets on these dates. Add a price or enable a ticket type to sell tickets then, or leave it as it is if this is intended.',
							'fair-events'
						) }
					</p>
				</Notice>
			) }
			<MiniCalendar
				minDate={ minDate }
				maxDate={ maxDate }
				dayProps={ dayProps }
			/>
			<div
				style={ {
					marginTop: '16px',
					display: 'flex',
					gap: '16px',
					flexWrap: 'wrap',
					fontSize: '12px',
					color: '#757575',
				} }
			>
				{ periods.map( ( period, index ) => (
					<span key={ period.id || `period-${ index }` }>
						<span
							style={ {
								display: 'inline-block',
								width: '12px',
								height: '12px',
								background: salePeriodColor( index ),
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							} }
						/>
						{ periodLabel( period, index ) }
					</span>
				) ) }
				{ eventDay && (
					<span>
						<span
							style={ {
								display: 'inline-block',
								width: '12px',
								height: '12px',
								border: EVENT_DAY_BORDER,
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							} }
						/>
						{ __( 'Event day', 'fair-events' ) }
					</span>
				) }
				{ gaps.length > 0 && (
					<span>
						<span
							style={ {
								display: 'inline-block',
								width: '12px',
								height: '12px',
								background: unavailableBackground(
									UNAVAILABLE_SWATCH_COLOR
								),
								borderRadius: '2px',
								verticalAlign: 'middle',
								marginRight: '4px',
							} }
						/>
						{ __( 'No tickets on sale', 'fair-events' ) }
					</span>
				) }
			</div>
		</>
	);

	if ( embedded ) {
		return calendarBody;
	}

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2 style={ { margin: 0 } }>
					{ __( 'Sale Periods Timeline', 'fair-events' ) }
				</h2>
			</CardHeader>
			<CardBody>{ calendarBody }</CardBody>
		</Card>
	);
}
