/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	Modal,
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Confirmation dialog for an action whose target and consequences need
 * spelling out. Unlike core's ConfirmDialog it carries a title, an
 * action-specific (optionally destructive) button, a pending state that
 * blocks a second submission and every way of dismissing it, and an inline
 * error that keeps the dialog open so the action can be retried in context.
 *
 * The caller owns the state: which target is being confirmed, whether the
 * action is running, and the error to show.
 *
 * @param {Object}      props                   Component props.
 * @param {string}      props.title             Dialog title, naming the action.
 * @param {JSX.Element} props.children          Target and consequences.
 * @param {string}      props.confirmLabel      Label of the confirming button.
 * @param {string}      [props.busyLabel]       Label of the confirming button while pending.
 * @param {boolean}     [props.isDestructive]   Style the confirming button as destructive.
 * @param {boolean}     [props.isBusy]          Whether the action is running.
 * @param {boolean}     [props.confirmDisabled] Withhold the confirming button, e.g. while
 *                                              the outcome of a failed attempt is unknown.
 * @param {string|null} [props.error]           Error from the last attempt.
 * @param {Function}    props.onConfirm         Called once per confirmation.
 * @param {Function}    props.onCancel          Called when the dialog is dismissed.
 * @return {JSX.Element} The dialog.
 */
export default function ConfirmActionModal( {
	title,
	children,
	confirmLabel,
	busyLabel,
	isDestructive = false,
	isBusy = false,
	confirmDisabled = false,
	error = null,
	onConfirm,
	onCancel,
} ) {
	const handleCancel = () => {
		if ( ! isBusy ) {
			onCancel();
		}
	};

	const handleConfirm = () => {
		if ( ! isBusy && ! confirmDisabled ) {
			onConfirm();
		}
	};

	return (
		<Modal
			title={ title }
			onRequestClose={ handleCancel }
			isDismissible={ ! isBusy }
			shouldCloseOnEsc={ ! isBusy }
			shouldCloseOnClickOutside={ ! isBusy }
			size="medium"
			className="fair-events-confirm-action-modal"
		>
			<VStack spacing={ 3 }>
				{ children }
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				<HStack justify="flex-end" spacing={ 3 } wrap>
					<Button
						variant="tertiary"
						onClick={ handleCancel }
						disabled={ isBusy }
					>
						{ __( 'Cancel', 'fair-events' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive={ isDestructive }
						onClick={ handleConfirm }
						isBusy={ isBusy }
						disabled={ isBusy || confirmDisabled }
					>
						{ isBusy && busyLabel ? busyLabel : confirmLabel }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
