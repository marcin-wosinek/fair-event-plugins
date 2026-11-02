/**
 * Disclosure - a button that shows or hides the content below it.
 *
 * @package
 */

import { useId } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { chevronDown, chevronRight } from '@wordpress/icons';

/**
 * Keyboard-accessible disclosure. The parent owns the open state, so it can
 * expand the content itself (for example when copying fails).
 *
 * @param {Object}   props
 * @param {string}   props.label     Toggle button text
 * @param {boolean}  props.isOpen    Whether the content is shown
 * @param {Function} props.onToggle  Called with the next open state
 * @param {string}   props.className Extra class for the wrapper
 * @param {Object}   props.children  Disclosed content
 * @return {JSX.Element} The disclosure
 */
export default function Disclosure( {
	label,
	isOpen,
	onToggle,
	className = '',
	children,
} ) {
	const contentId = `fair-events-disclosure-${ useId() }`;

	return (
		<div className={ `fair-events-disclosure ${ className }`.trim() }>
			<Button
				variant="tertiary"
				className="fair-events-disclosure__toggle"
				icon={ isOpen ? chevronDown : chevronRight }
				aria-expanded={ isOpen }
				aria-controls={ contentId }
				onClick={ () => onToggle( ! isOpen ) }
			>
				{ label }
			</Button>
			<div
				id={ contentId }
				className="fair-events-disclosure__content"
				hidden={ ! isOpen }
			>
				{ isOpen && children }
			</div>
		</div>
	);
}
