/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { PATH, TYPE_LABELS, errorMessage } from './shared.js';

/**
 * A list row's Duplicate action: asks the server for a paused copy of the
 * notification's saved settings, then hands the copy to `onDuplicated`.
 *
 * Unsaved drafts are not copied. A kind this plugin cannot manage right now
 * cannot be duplicated; the menu item says so, and the row's warning says
 * why. The request runs once, however often it is chosen. Its pending
 * state and any failure are shown in the row, outside the menu, which
 * closes once the action is chosen.
 *
 * @param {Object}   props
 * @param {Object}   props.configuration Configuration payload of the row.
 * @param {Function} props.onDuplicated  Receives the copy's configuration payload.
 * @return {Object} `action`, the row menu item, and `feedback`, the row's
 *                  pending and error messages.
 */
export default function useDuplicateAction( { configuration, onDuplicated } ) {
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState( null );
	// Guards against a double click firing before the re-render.
	const busy = useRef( false );

	const available = 'active' === configuration.state;
	const name = configuration.name || TYPE_LABELS[ configuration.type ];

	const duplicate = async () => {
		if ( busy.current || ! available ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setError( null );
		try {
			const copy = await apiFetch( {
				path: `${ PATH }/configurations/${ configuration.id }/duplicate`,
				method: 'POST',
			} );
			busy.current = false;
			onDuplicated( copy );
			return;
		} catch ( failure ) {
			setError(
				sprintf(
					/* translators: 1: notification name, 2: error message */
					__( '“%1$s” was not duplicated: %2$s', 'fair-events' ),
					name,
					errorMessage(
						failure,
						__(
							'Failed to duplicate the notification. Please try again.',
							'fair-events'
						)
					)
				)
			);
		}
		busy.current = false;
		setPending( false );
	};

	let disabledReason;
	if ( pending ) {
		disabledReason = __( 'A copy is being made.', 'fair-events' );
	} else if ( ! available ) {
		disabledReason = __(
			'Cannot be duplicated now, see the warning next to its name.',
			'fair-events'
		);
	}

	const action = {
		label: pending
			? __( 'Duplicating…', 'fair-events' )
			: __( 'Duplicate', 'fair-events' ),
		disabled: pending || ! available,
		disabledReason,
		onClick: duplicate,
	};

	const feedback = (
		<>
			{ pending && (
				<span
					className="fair-events-notifications__row-pending"
					role="status"
				>
					{ sprintf(
						/* translators: %s: notification name */
						__( 'Duplicating “%s”…', 'fair-events' ),
						name
					) }
				</span>
			) }
			{ error && (
				<Notice
					status="error"
					className="fair-events-notifications__row-error"
					onRemove={ () => setError( null ) }
					actions={ [
						{
							label: __( 'Try again', 'fair-events' ),
							onClick: duplicate,
							variant: 'secondary',
						},
					] }
				>
					{ error }
				</Notice>
			) }
		</>
	);

	return { action, feedback };
}
