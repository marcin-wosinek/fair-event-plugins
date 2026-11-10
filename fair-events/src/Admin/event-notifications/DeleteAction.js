/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import { Button } from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import { PATH, TYPE_LABELS, errorMessage } from './shared.js';

/**
 * A list row's Delete action: asks for confirmation naming the notification
 * and what deleting it does, then deletes it and hands it to `onDeleted`.
 *
 * The dialog stays open while the request runs and after a failure, so the
 * deletion can be retried there; the row stays until the server confirms.
 * A notification the server no longer has counts as deleted. Available for
 * every notification, also one whose kind cannot be delivered right now.
 *
 * @param {Object}   props
 * @param {Object}   props.configuration Configuration payload of the row.
 * @param {string}   props.audience      Who or where it sends to.
 * @param {boolean}  props.isDirty       Whether it has unsaved changes.
 * @param {Function} props.onDeleted     Receives the deleted configuration payload.
 * @return {JSX.Element} The action.
 */
export default function DeleteAction( {
	configuration,
	audience,
	isDirty,
	onDeleted,
} ) {
	const [ confirming, setConfirming ] = useState( false );
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState( null );
	// Guards against a double click firing before the re-render.
	const busy = useRef( false );

	const kind = TYPE_LABELS[ configuration.type ];
	const name = configuration.name || kind;

	const open = () => {
		setError( null );
		setConfirming( true );
	};
	const close = () => {
		if ( busy.current ) {
			return;
		}
		setError( null );
		setConfirming( false );
	};

	const confirm = async () => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setError( null );
		try {
			await apiFetch( {
				path: `${ PATH }/configurations/${ configuration.id }`,
				method: 'DELETE',
			} );
		} catch ( failure ) {
			// Deleted already, e.g. by an earlier attempt whose answer was lost.
			if ( 'unknown_configuration' !== failure?.code ) {
				busy.current = false;
				setPending( false );
				setError(
					sprintf(
						/* translators: 1: notification name, 2: error message */
						__( '“%1$s” was not deleted: %2$s', 'fair-events' ),
						name,
						errorMessage(
							failure,
							__(
								'Failed to delete the notification. Please try again.',
								'fair-events'
							)
						)
					)
				);
				return;
			}
		}
		busy.current = false;
		// The row and this dialog go with the notification.
		onDeleted( configuration );
	};

	return (
		<>
			<Button
				variant="link"
				isDestructive
				onClick={ open }
				aria-haspopup="dialog"
			>
				{ __( 'Delete', 'fair-events' ) }
			</Button>
			{ confirming && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: notification name */
						__( 'Delete notification — %s', 'fair-events' ),
						name
					) }
					confirmLabel={ __( 'Delete notification', 'fair-events' ) }
					busyLabel={ __( 'Deleting…', 'fair-events' ) }
					isDestructive
					isBusy={ pending }
					error={ error }
					onConfirm={ confirm }
					onCancel={ close }
				>
					<p>
						{ configuration.name
							? sprintf(
									/* translators: 1: notification name, 2: its kind, e.g. "Telegram", 3: who or where it sends to */
									__(
										'Delete the notification “%1$s” (%2$s), which sends to: %3$s?',
										'fair-events'
									),
									name,
									kind,
									audience
								)
							: sprintf(
									/* translators: 1: notification kind, e.g. "Telegram", 2: who or where it sends to */
									__(
										'Delete the unnamed %1$s notification, which sends to: %2$s?',
										'fair-events'
									),
									kind,
									audience
								) }
					</p>
					<ul className="fair-events-notifications__delete-consequences">
						<li>
							{ configuration.next_run
								? sprintf(
										/* translators: %s: date and time of the next scheduled send */
										__(
											'Its next send, planned for %s, and every later one are cancelled.',
											'fair-events'
										),
										configuration.next_run.time_local
									)
								: __(
										'It will never be scheduled again.',
										'fair-events'
									) }
						</li>
						<li>
							{ __(
								'A send that has already started finishes and is recorded. Messages already delivered cannot be recalled.',
								'fair-events'
							) }
						</li>
						<li>
							{ __(
								'Its past sends and tests stay in All notification history.',
								'fair-events'
							) }
						</li>
						<li>
							{ __(
								'Other notifications, event feeds, subscribers and connector settings do not change.',
								'fair-events'
							) }
						</li>
						{ isDirty && (
							<li>
								{ __(
									'Its unsaved changes are discarded.',
									'fair-events'
								) }
							</li>
						) }
					</ul>
					<p>
						<strong>
							{ __( 'This cannot be undone.', 'fair-events' ) }
						</strong>
					</p>
				</ConfirmActionModal>
			) }
		</>
	);
}
