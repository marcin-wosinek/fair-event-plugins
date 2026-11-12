/**
 * Page header, toolbar, applied-criteria summary, selection summary and
 * pagination around a shared admin table. See README.md § Toolbar and
 * pagination for the contract.
 *
 * Presentation only: the page owns every request, filter value, page number,
 * selection and operation, and passes every string already translated.
 *
 * @package FairEventsShared
 */

import { Button } from '@wordpress/components';
import { forwardRef } from '@wordpress/element';

function classNames( ...names ) {
	return names.filter( Boolean ).join( ' ' );
}

/**
 * Page title with the page's existing creation or import actions beside it.
 * The heading takes `tabIndex={ -1 }` so a page can move focus to it when the
 * control that had focus is gone (e.g. after a deletion).
 *
 * @param {Object}      props
 * @param {string}      props.title   Page title.
 * @param {JSX.Element} props.actions Buttons beside the title.
 * @param {Object}      ref           Ref to the heading.
 * @return {JSX.Element} The header.
 */
export const ListHeader = forwardRef( function ListHeaderWithRef(
	{ title, actions },
	ref
) {
	// `wp-header-end` tells WordPress to place admin notices after the
	// header rather than inside it, next to the title.
	return (
		<>
			<div className="fair-admin-list-header">
				<h1
					ref={ ref }
					tabIndex={ -1 }
					className="fair-admin-list-header__title"
				>
					{ title }
				</h1>
				{ actions && (
					<div className="fair-admin-list-header__actions">
						{ actions }
					</div>
				) }
			</div>
			<hr className="wp-header-end" />
		</>
	);
} );

/**
 * One toolbar row above the table, in a fixed order: the selection summary
 * (only while items are selected), search and frequent filters, then the
 * toolbar actions (More filters, Clear filters, Apply…), then the result
 * count at the end. `panel` (the More filters fields) renders under the row.
 *
 * @param {Object}      props
 * @param {JSX.Element} props.selection Selection summary, when items are selected.
 * @param {JSX.Element} props.children  Search and frequent filters, each in a ListToolbarField.
 * @param {JSX.Element} props.actions   Toolbar buttons.
 * @param {JSX.Element} props.count     Result count.
 * @param {JSX.Element} props.panel     More filters panel.
 * @return {JSX.Element} The toolbar.
 */
export function ListToolbar( { selection, children, actions, count, panel } ) {
	return (
		<div className="fair-admin-list-toolbar">
			<div className="fair-admin-list-toolbar__row">
				{ selection }
				{ children }
				{ actions && (
					<div className="fair-admin-list-toolbar__actions">
						{ actions }
					</div>
				) }
				{ count }
			</div>
			{ panel }
		</div>
	);
}

/**
 * Wrapper of one labeled toolbar control. `wide` is for search.
 *
 * @param {Object}      props
 * @param {boolean}     props.wide     Whether the field takes more room.
 * @param {JSX.Element} props.children The control.
 * @return {JSX.Element} The field.
 */
export function ListToolbarField( { wide = false, children } ) {
	return (
		<div
			className={ classNames(
				'fair-admin-list-toolbar__field',
				wide && 'fair-admin-list-toolbar__field--wide'
			) }
		>
			{ children }
		</div>
	);
}

/**
 * The button that shows and hides the less-used filters. The page keeps the
 * open state, so the panel's fields stay mounted and keep their values.
 *
 * @param {Object}   props
 * @param {string}   props.panelId  ID of the MoreFiltersPanel.
 * @param {boolean}  props.isOpen   Whether the panel is shown.
 * @param {Function} props.onToggle Called on click.
 * @param {string}   props.label    Button text, e.g. "More filters (2 active)".
 * @return {JSX.Element} The button.
 */
export function MoreFiltersToggle( { panelId, isOpen, onToggle, label } ) {
	return (
		<Button
			variant="tertiary"
			className="fair-admin-list-toolbar__more"
			aria-expanded={ isOpen }
			aria-controls={ panelId }
			icon={ isOpen ? 'arrow-up-alt2' : 'arrow-down-alt2' }
			iconPosition="right"
			onClick={ onToggle }
		>
			{ label }
		</Button>
	);
}

/**
 * The less-used filters. Hidden, not unmounted, while closed.
 *
 * @param {Object}      props
 * @param {string}      props.id       Element ID, matching the toggle's `panelId`.
 * @param {boolean}     props.isOpen   Whether it is shown.
 * @param {string}      props.label    Accessible name of the group.
 * @param {JSX.Element} props.children Filter fields.
 * @return {JSX.Element} The panel.
 */
export function MoreFiltersPanel( { id, isOpen, label, children } ) {
	return (
		<div
			id={ id }
			role="group"
			aria-label={ label }
			className="fair-admin-list-toolbar__panel"
			hidden={ ! isOpen }
		>
			{ children }
		</div>
	);
}

/**
 * Number of results, announced politely when it changes.
 *
 * @param {Object}      props
 * @param {JSX.Element} props.children Count text, e.g. "1–50 of 236 transactions".
 * @return {JSX.Element} The count.
 */
export function ResultCount( { children } ) {
	return (
		<p className="fair-admin-list-toolbar__count" role="status">
			{ children }
		</p>
	);
}

/**
 * Summary of the criteria that produced the shown rows. Renders nothing
 * without items.
 *
 * @param {Object}   props
 * @param {string}   props.label Lead-in text, e.g. "Applied filters:".
 * @param {string[]} props.items One label per applied criterion.
 * @return {JSX.Element|null} The summary.
 */
export function AppliedFilters( { label, items } ) {
	if ( ! items || 0 === items.length ) {
		return null;
	}
	return (
		<div className="fair-admin-list-applied">
			<span className="fair-admin-list-applied__label">{ label }</span>
			<ul className="fair-admin-list-applied__items">
				{ items.map( ( item ) => (
					<li key={ item } className="fair-admin-list-applied__item">
						{ item }
					</li>
				) ) }
			</ul>
		</div>
	);
}

/**
 * Selected count and the actions that apply to the selection. The page
 * renders it only while items are selected, on pages with bulk actions.
 *
 * @param {Object}      props
 * @param {string}      props.label    Count text, e.g. "2 transactions selected".
 * @param {JSX.Element} props.children Actions.
 * @return {JSX.Element} The summary.
 */
export function SelectionSummary( { label, children } ) {
	return (
		<div
			className="fair-admin-list-toolbar__selection"
			role="group"
			aria-label={ label }
		>
			<strong className="fair-admin-list-toolbar__selection-count">
				{ label }
			</strong>
			{ children }
		</div>
	);
}

/**
 * First and last position shown on a page of results.
 *
 * @param {number} page    Current page, from 1.
 * @param {number} perPage Results per page.
 * @param {number} total   Number of results.
 * @return {{first: number, last: number}} Positions; both 0 without results.
 */
export function pageRange( page, perPage, total ) {
	if ( total <= 0 ) {
		return { first: 0, last: 0 };
	}
	const first = Math.min( ( page - 1 ) * perPage + 1, total );
	return { first, last: Math.min( page * perPage, total ) };
}

/**
 * Previous page, the position and next page below the table, aligned right.
 * Hidden for a single page. The boundary buttons stay focusable while
 * unavailable, so focus is kept when the last page is reached.
 *
 * Give `pageProps` for link navigation (it returns props such as `href` and
 * `onClick` of a page number), or `onChange` for in-place page changes.
 *
 * @param {Object}   props
 * @param {number}   props.page          Current page, from 1.
 * @param {number}   props.totalPages    Number of pages.
 * @param {string}   props.label         Accessible name of the navigation.
 * @param {string}   props.positionLabel Position text, e.g. "Page 2 of 5".
 * @param {string}   props.previousLabel Previous button text.
 * @param {string}   props.nextLabel     Next button text.
 * @param {Function} props.onChange      Receives the requested page number.
 * @param {Function} props.pageProps     Props of the button to a page number.
 * @return {JSX.Element|null} The navigation.
 */
export function ListPagination( {
	page,
	totalPages,
	label,
	positionLabel,
	previousLabel,
	nextLabel,
	onChange,
	pageProps,
} ) {
	if ( totalPages <= 1 ) {
		return null;
	}
	const target = ( number, available ) => {
		if ( ! available ) {
			return {};
		}
		return pageProps
			? pageProps( number )
			: { onClick: () => onChange( number ) };
	};
	const hasPrevious = page > 1;
	const hasNext = page < totalPages;
	return (
		<nav className="fair-admin-list-pagination" aria-label={ label }>
			<Button
				variant="secondary"
				disabled={ ! hasPrevious }
				accessibleWhenDisabled
				{ ...target( page - 1, hasPrevious ) }
			>
				{ previousLabel }
			</Button>
			<span className="fair-admin-list-pagination__position">
				{ positionLabel }
			</span>
			<Button
				variant="secondary"
				disabled={ ! hasNext }
				accessibleWhenDisabled
				{ ...target( page + 1, hasNext ) }
			>
				{ nextLabel }
			</Button>
		</nav>
	);
}
