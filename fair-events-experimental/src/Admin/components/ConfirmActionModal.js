/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Shared dependencies
 */
import SharedConfirmActionModal from 'fair-events-shared/src/ConfirmActionModal.js';

export { useConfirmAction } from 'fair-events-shared/src/ConfirmActionModal.js';

/**
 * Confirmation dialog with this plugin's translated Cancel label and class.
 * Behaviour and props are the shared ConfirmActionModal's.
 *
 * @param {Object} props Props forwarded to the shared ConfirmActionModal.
 * @return {JSX.Element} The dialog.
 */
export default function ConfirmActionModal( props ) {
	return (
		<SharedConfirmActionModal
			{ ...props }
			cancelLabel={ __( 'Cancel', 'fair-events-experimental' ) }
			className="fair-events-experimental-confirm-action-modal"
		/>
	);
}
