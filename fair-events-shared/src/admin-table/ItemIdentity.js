/**
 * Strong, linked item identity with muted supporting text.
 *
 * @package FairEventsShared
 */

/**
 * @param {Object}      props
 * @param {string}      props.title    Item name; may be empty.
 * @param {string}      props.fallback Shown when `title` is empty, e.g. "(untitled feed)".
 * @param {string}      props.href     Link to the item; plain text without it.
 * @param {JSX.Element} props.meta     Supporting text below the name.
 * @param {JSX.Element} props.children Extra content (warnings, badges) below the meta.
 * @return {JSX.Element} The identity.
 */
export default function ItemIdentity( {
	title,
	fallback,
	href,
	meta,
	children,
} ) {
	const name = title || fallback;
	return (
		<div className="fair-admin-table__identity">
			<strong className="fair-admin-table__identity-name">
				{ href ? <a href={ href }>{ name }</a> : name }
			</strong>
			{ meta && (
				<span className="fair-admin-table__identity-meta">
					{ meta }
				</span>
			) }
			{ children }
		</div>
	);
}
