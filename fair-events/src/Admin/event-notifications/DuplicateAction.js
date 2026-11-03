/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import { Button, Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { PATH, errorMessage } from './shared.js';

/**
 * A list row's Duplicate action: asks the server for a paused copy of the
 * notification's saved settings, then hands the copy to `onDuplicated`.
 *
 * Unsaved drafts are not copied. A kind this plugin cannot manage right now
 * cannot be duplicated; the reason is the row's status problem, which the
 * disabled button points to.
 *
 * @param {Object}   props
 * @param {Object}   props.configuration Configuration payload of the row.
 * @param {string}   props.reasonId      ID of the element explaining why the kind is unavailable.
 * @param {Function} props.onDuplicated  Receives the copy's configuration payload.
 * @return {JSX.Element} The action.
 */
export default function DuplicateAction( {
	configuration,
	reasonId,
	onDuplicated,
} ) {
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState( null );
	// Guards against a double click firing before the re-render.
	const busy = useRef( false );

	const available = 'active' === configuration.state;

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
				errorMessage(
					failure,
					__(
						'Failed to duplicate the notification. Please try again.',
						'fair-events'
					)
				)
			);
		}
		busy.current = false;
		setPending( false );
	};

	return (
		<>
			<Button
				variant="link"
				onClick={ duplicate }
				isBusy={ pending }
				disabled={ pending || ! available }
				accessibleWhenDisabled
				aria-describedby={
					! available && reasonId ? reasonId : undefined
				}
			>
				{ pending
					? __( 'Duplicating…', 'fair-events' )
					: __( 'Duplicate', 'fair-events' ) }
			</Button>
			{ ! available && (
				<span className="fair-events-notifications__duplicate-note">
					{ __(
						'Cannot be duplicated now, see its status.',
						'fair-events'
					) }
				</span>
			) }
			{ error && (
				<Notice
					status="error"
					className="fair-events-notifications__duplicate-error"
					onRemove={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }
		</>
	);
}
