/**
 * The people a confirmation or a result is about, as a list that scrolls
 * once it grows past a few names.
 *
 * @package FairAudience
 */

/**
 * @param {Object} props
 * @param {string} props.label  What the list holds, for assistive technology.
 * @param {Array}  props.people Entries with id, label, an optional detail telling same-named people apart, and an optional note (why they are listed).
 * @return {Element} List.
 */
export default function SelectedParticipantsList( { label, people } ) {
	return (
		<ul
			className="fair-audience-selected-participants"
			aria-label={ label }
			// Focusable, so a keyboard can scroll a long selection.
			// eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
			tabIndex={ 0 }
			style={ {
				margin: 0,
				padding: '8px 12px 8px 28px',
				maxHeight: '180px',
				overflowY: 'auto',
				listStyle: 'disc',
				border: '1px solid #ddd',
				borderRadius: '4px',
				background: '#fff',
				overflowWrap: 'anywhere',
			} }
		>
			{ people.map( ( person ) => (
				<li key={ person.id } style={ { marginBottom: '4px' } }>
					<strong>{ person.label }</strong>
					{ person.detail && (
						<span style={ { color: '#646970' } }>
							{ ' ' }
							({ person.detail })
						</span>
					) }
					{ person.note && (
						<div style={ { color: '#50575e' } }>
							{ person.note }
						</div>
					) }
				</li>
			) ) }
		</ul>
	);
}
