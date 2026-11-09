/**
 * Shared admin table shell and cells. See README.md for the contract.
 *
 * @package FairEventsShared
 */

const CELL_VARIANTS = [ 'identity', 'amount', 'status', 'actions' ];

function variantClass( base, variant ) {
	return CELL_VARIANTS.includes( variant ) ? `${ base }--${ variant }` : '';
}

function classNames( ...names ) {
	return names.filter( Boolean ).join( ' ' );
}

/**
 * White table surface with a visually hidden caption.
 *
 * @param {Object}      props
 * @param {string}      props.caption   Accessible name of the table.
 * @param {string}      props.className Extra class on the wrapper.
 * @param {JSX.Element} props.children  `thead` and `tbody`.
 * @return {JSX.Element} The table.
 */
export default function AdminTable( { caption, className, children } ) {
	return (
		<div className={ classNames( 'fair-admin-table', className ) }>
			<table className="fair-admin-table__table">
				{ caption && (
					<caption className="fair-admin-table__caption">
						{ caption }
					</caption>
				) }
				{ children }
			</table>
		</div>
	);
}

/**
 * Column header.
 *
 * @param {Object}      props
 * @param {string}      props.variant  identity, amount, status or actions.
 * @param {JSX.Element} props.children Header text.
 * @return {JSX.Element} The header cell.
 */
export function AdminTableHeaderCell( { variant, children } ) {
	return (
		<th
			scope="col"
			className={ classNames(
				'fair-admin-table__header',
				variantClass( 'fair-admin-table__header', variant )
			) }
		>
			{ children }
		</th>
	);
}

/**
 * Body cell. `label` repeats the column header so stacked mobile rows stay
 * labeled; the identity and actions cells hide it.
 *
 * @param {Object}      props
 * @param {string}      props.label    Column header text.
 * @param {string}      props.variant  identity, amount, status or actions.
 * @param {JSX.Element} props.children Cell content.
 * @return {JSX.Element} The cell.
 */
export function AdminTableCell( { label, variant, children } ) {
	return (
		<td
			data-label={ label }
			className={ classNames(
				'fair-admin-table__cell',
				variantClass( 'fair-admin-table__cell', variant )
			) }
		>
			{ children }
		</td>
	);
}
