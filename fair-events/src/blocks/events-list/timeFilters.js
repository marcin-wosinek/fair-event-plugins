/**
 * Time periods of the Events List block.
 *
 * Mirrors FairEvents\Helpers\EventsListTimeFilters::normalize(): the
 * `timeFilters` array wins whenever it is present, even empty; otherwise the
 * legacy single `timeFilter` decides, defaulting to Future.
 */

export const PERIOD_PAST = 'past';
export const PERIOD_CURRENT = 'current';
export const PERIOD_FUTURE = 'future';

export const ALL_PERIODS = [ PERIOD_PAST, PERIOD_CURRENT, PERIOD_FUTURE ];

const LEGACY_PERIODS = {
	all: ALL_PERIODS,
	past: [ PERIOD_PAST ],
	ongoing: [ PERIOD_CURRENT ],
	upcoming: [ PERIOD_FUTURE ],
};

/**
 * Selected periods of a block, in display order.
 *
 * @param {Object}   attributes             Block attributes.
 * @param {string}   attributes.timeFilter  Legacy single filter.
 * @param {string[]} attributes.timeFilters Selected periods, when saved.
 * @return {string[]} Selected periods.
 */
export function normalizeTimeFilters( { timeFilter, timeFilters } ) {
	if ( Array.isArray( timeFilters ) ) {
		return ALL_PERIODS.filter( ( period ) =>
			timeFilters.includes( period )
		);
	}

	return LEGACY_PERIODS[ timeFilter ] || LEGACY_PERIODS.upcoming;
}

/**
 * Selection after checking or unchecking one period.
 *
 * @param {string[]} periods Current selection.
 * @param {string}   period  Toggled period.
 * @param {boolean}  checked Whether it is now checked.
 * @return {string[]} New selection, in display order.
 */
export function togglePeriod( periods, period, checked ) {
	return ALL_PERIODS.filter( ( candidate ) =>
		candidate === period ? checked : periods.includes( candidate )
	);
}
