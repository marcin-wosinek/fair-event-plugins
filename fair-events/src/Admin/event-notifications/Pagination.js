/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

/**
 * Previous and next page links with the position, when there is more than
 * one page.
 *
 * @param {Object}   props
 * @param {number}   props.page       Current page.
 * @param {number}   props.totalPages Number of pages.
 * @param {Function} props.link       Link props of a page number.
 * @param {string}   props.label      Accessible name of the navigation.
 * @return {JSX.Element|null} The links.
 */
export default function Pagination( { page, totalPages, link, label } ) {
	if ( totalPages <= 1 ) {
		return null;
	}
	return (
		<nav
			className="fair-events-notifications__pagination"
			aria-label={ label }
		>
			<Button
				variant="secondary"
				disabled={ page <= 1 }
				{ ...( page > 1 ? link( page - 1 ) : {} ) }
			>
				{ __( 'Previous page', 'fair-events' ) }
			</Button>
			<span>
				{ sprintf(
					/* translators: 1: current page number, 2: number of pages */
					__( 'Page %1$d of %2$d', 'fair-events' ),
					page,
					totalPages
				) }
			</span>
			<Button
				variant="secondary"
				disabled={ page >= totalPages }
				{ ...( page < totalPages ? link( page + 1 ) : {} ) }
			>
				{ __( 'Next page', 'fair-events' ) }
			</Button>
		</nav>
	);
}
