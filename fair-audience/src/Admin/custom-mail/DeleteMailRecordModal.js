/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Modal,
	Notice,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { formatSentAt, subjectOf } from './MailHistory.js';

// A long subject wraps inside the popup instead of widening it.
const MODAL_STYLE = {
	maxWidth: '560px',
	width: '100%',
	overflowWrap: 'anywhere',
};

/**
 * Confirms deleting one Mail History record. The page owns the state: while
 * the request runs every way of dismissing the popup is blocked, and a
 * failure is shown here so the deletion can be retried or cancelled.
 *
 * @param {Object}      props            Component props.
 * @param {Object}      props.mail       History record to delete.
 * @param {boolean}     props.isDeleting Whether the deletion runs.
 * @param {string|null} props.error      Why the last attempt failed.
 * @param {Function}    props.onConfirm  Delete the record.
 * @param {Function}    props.onCancel   Close without deleting.
 * @return {JSX.Element} The popup.
 */
export default function DeleteMailRecordModal( {
	mail,
	isDeleting,
	error,
	onConfirm,
	onCancel,
} ) {
	const close = () => {
		if ( ! isDeleting ) {
			onCancel();
		}
	};

	return (
		<Modal
			title={ sprintf(
				/* translators: 1: email subject, 2: date and time the email was sent */
				__( 'Delete record — “%1$s”, %2$s', 'fair-audience' ),
				subjectOf( mail ),
				formatSentAt( mail.created_at )
			) }
			onRequestClose={ close }
			isDismissible={ ! isDeleting }
			shouldCloseOnEsc={ ! isDeleting }
			shouldCloseOnClickOutside={ ! isDeleting }
			className="fair-audience-delete-mail-record"
			style={ MODAL_STYLE }
		>
			<VStack spacing={ 3 }>
				<p style={ { margin: 0 } }>
					{ sprintf(
						/* translators: %s: email subject */
						__(
							'Delete the record of “%s” from Mail History? Emails that were already sent are not affected. This cannot be undone.',
							'fair-audience'
						),
						subjectOf( mail )
					) }
				</p>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				<HStack justify="flex-end" spacing={ 3 } wrap>
					<Button
						variant="tertiary"
						onClick={ close }
						disabled={ isDeleting }
						__next40pxDefaultSize
					>
						{ __( 'Cancel', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive
						onClick={ onConfirm }
						isBusy={ isDeleting }
						disabled={ isDeleting }
						__next40pxDefaultSize
					>
						{ isDeleting
							? __( 'Deleting record…', 'fair-audience' )
							: __( 'Delete record', 'fair-audience' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
