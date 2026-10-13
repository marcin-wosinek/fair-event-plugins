/**
 * Brief, non-blocking confirmation that an action went through.
 *
 * @package FairAudience
 */

import { Snackbar } from '@wordpress/components';

/**
 * @param {Object}      props
 * @param {string|null} props.message  What happened; nothing is shown when empty.
 * @param {Function}    props.onRemove Called once the message is dismissed or times out.
 * @return {Element|null} Snackbar pinned to the corner of the screen.
 */
export default function FeedbackSnackbar( { message, onRemove } ) {
	if ( ! message ) {
		return null;
	}

	return (
		<div
			className="fair-audience-feedback-snackbar"
			style={ {
				position: 'fixed',
				bottom: '16px',
				left: '16px',
				zIndex: 100000,
			} }
		>
			<Snackbar onRemove={ onRemove }>{ message }</Snackbar>
		</div>
	);
}
