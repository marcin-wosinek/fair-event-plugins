/**
 * Calendar view state <-> admin URL.
 *
 * The displayed month and the category filter live together in one view
 * object so navigation, the filter, and browser history always move them in
 * step (#1850).
 *
 * @package FairEvents
 */

import {
	startOfMonth,
	formatMonthParam,
	parseMonthParam,
} from 'fair-events-shared/src/calendar/month.js';

export { startOfMonth, formatMonthParam };

/**
 * Parse a `category` URL value into a term ID. Anything other than a positive
 * integer is malformed and yields null ("All categories").
 *
 * @param {string|null} value Raw URL value.
 * @return {number|null} Term ID or null.
 */
export function parseCategoryParam( value ) {
	if ( ! value || ! /^[1-9]\d*$/.test( value ) ) {
		return null;
	}
	return Number( value );
}

/**
 * Read the calendar view from a query string.
 *
 * @param {string} search `window.location.search`.
 * @param {Date}   today  Fallback month when `month` is missing or malformed.
 * @return {{month: Date, categoryId: number|null}} View.
 */
export function parseView( search, today = new Date() ) {
	const params = new URLSearchParams( search );
	return {
		month:
			parseMonthParam( params.get( 'month' ) ) || startOfMonth( today ),
		categoryId: parseCategoryParam( params.get( 'category' ) ),
	};
}

/**
 * Build the admin URL for a view, preserving unrelated query parameters.
 *
 * @param {string}                                  pathname `window.location.pathname`.
 * @param {string}                                  search   Current `window.location.search`.
 * @param {{month: Date, categoryId: number|null}} view     View to encode.
 * @return {string} Relative URL.
 */
export function buildViewUrl( pathname, search, view ) {
	const params = new URLSearchParams( search );
	params.set( 'month', formatMonthParam( view.month ) );
	if ( view.categoryId ) {
		params.set( 'category', String( view.categoryId ) );
	} else {
		params.delete( 'category' );
	}
	return `${ pathname }?${ params.toString() }`;
}

/**
 * Whether two views display the same month and category.
 *
 * @param {{month: Date, categoryId: number|null}} a View.
 * @param {{month: Date, categoryId: number|null}} b View.
 * @return {boolean} True when equal.
 */
export function isSameView( a, b ) {
	return (
		formatMonthParam( a.month ) === formatMonthParam( b.month ) &&
		( a.categoryId || null ) === ( b.categoryId || null )
	);
}
