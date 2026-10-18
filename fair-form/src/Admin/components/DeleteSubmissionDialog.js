import { __, sprintf } from '@wordpress/i18n';
import { useState, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Modal, Notice } from '@wordpress/components';
import SubmissionContext, { describeSubmission } from './SubmissionContext.js';

// Core gives the modal header a fixed height, which clips a long respondent
// name in the title. Let it grow and wrap so the submission stays
// identifiable at 375px. Both response pages use this dialog, so the rule
// travels with it.
const MODAL_CSS = `
.fair-form-delete-submission-dialog .components-modal__content { margin-top: 0; }
.fair-form-delete-submission-dialog .components-modal__header { position: sticky; height: auto; min-height: 72px; margin: -4px -24px 0; width: auto; background: #fff; }
.fair-form-delete-submission-dialog .components-modal__header-heading { line-height: 1.3; overflow-wrap: anywhere; }
`;

/**
 * Confirms and performs the deletion of one submission.
 *
 * Stays open while the request is pending and after a failure, so the error
 * appears next to the submission it concerns and the user can retry. Render
 * it with `key={ submission.id }` so each target starts with a clean state.
 *
 * @param {Object}   props            Component props.
 * @param {Object}   props.submission Submission row to delete.
 * @param {Function} props.onCancel   Called when the user dismisses the dialog.
 * @param {Function} props.onDeleted  Called with the submission ID after deletion.
 * @return {Element} Modal.
 */
export default function DeleteSubmissionDialog( {
	submission,
	onCancel,
	onDeleted,
} ) {
	const [ isDeleting, setIsDeleting ] = useState( false );
	const [ error, setError ] = useState( null );
	// Guards against a second click landing before the re-render disables the button.
	const pendingRef = useRef( false );

	const handleCancel = () => {
		if ( pendingRef.current ) {
			return;
		}
		onCancel();
	};

	const handleConfirm = () => {
		if ( pendingRef.current ) {
			return;
		}
		pendingRef.current = true;
		setIsDeleting( true );
		setError( null );

		apiFetch( {
			path: `/fair-form/v1/questionnaire-responses/${ submission.id }`,
			method: 'DELETE',
		} )
			.then( () => {
				pendingRef.current = false;
				onDeleted( submission.id );
			} )
			.catch( ( err ) => {
				pendingRef.current = false;
				setIsDeleting( false );
				setError(
					err?.message ||
						__(
							'The submission could not be deleted. Try again.',
							'fair-form'
						)
				);
			} );
	};

	const { respondent, id } = describeSubmission( submission );

	return (
		<Modal
			title={ sprintf(
				/* translators: 1: submission ID, e.g. "#12", 2: respondent name or email */
				__( 'Delete submission %1$s — %2$s', 'fair-form' ),
				id,
				respondent
			) }
			onRequestClose={ handleCancel }
			isDismissible={ ! isDeleting }
			shouldCloseOnEsc={ ! isDeleting }
			shouldCloseOnClickOutside={ ! isDeleting }
			className="fair-form-delete-submission-dialog"
			style={ { maxWidth: '480px', width: '100%' } }
		>
			<style>{ MODAL_CSS }</style>
			<SubmissionContext submission={ submission } />
			<p>
				{ __(
					'This permanently deletes this submission and its answers. The participant, other submissions, and uploaded files are kept.',
					'fair-form'
				) }
			</p>

			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			<div
				style={ {
					marginTop: '16px',
					display: 'flex',
					justifyContent: 'flex-end',
					flexWrap: 'wrap',
					gap: '8px',
				} }
			>
				<Button
					variant="tertiary"
					onClick={ handleCancel }
					disabled={ isDeleting }
				>
					{ __( 'Cancel', 'fair-form' ) }
				</Button>
				<Button
					variant="primary"
					isDestructive
					onClick={ handleConfirm }
					isBusy={ isDeleting }
					disabled={ isDeleting }
				>
					{ __( 'Delete submission', 'fair-form' ) }
				</Button>
			</div>
		</Modal>
	);
}
