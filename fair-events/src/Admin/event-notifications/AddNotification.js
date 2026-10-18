/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	SelectControl,
	TextControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { PATH, TYPE_LABELS, errorMessage } from './shared.js';

/**
 * Add a notification of any kind. It starts paused with the kind's defaults
 * and appears above this section, where it is set up and turned on.
 *
 * A kind this plugin cannot manage right now (an older plugin still sends
 * it, or the plugin that sends it is inactive) cannot be added; the reason
 * is shown under the selection.
 *
 * @param {Object}   props
 * @param {Object}   props.types   Availability per kind: `state` and `state_message`.
 * @param {Function} props.onAdded Receives the new configuration payload.
 * @return {JSX.Element} The section.
 */
export default function AddNotification( { types, onAdded } ) {
	const kinds = Object.keys( TYPE_LABELS );
	const [ type, setType ] = useState(
		() =>
			kinds.find( ( kind ) => 'active' === types[ kind ]?.state ) ||
			kinds[ 0 ]
	);
	const [ name, setName ] = useState( '' );
	const [ pending, setPending ] = useState( false );
	const [ notice, setNotice ] = useState( null );
	// Guards against a double click firing before the re-render.
	const busy = useRef( false );

	const available = 'active' === types[ type ]?.state;
	const unavailableMessage = available
		? null
		: types[ type ]?.state_message ||
			__(
				'This kind of notification cannot be added now.',
				'fair-events'
			);

	const add = async () => {
		if ( busy.current || ! available ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setNotice( null );
		try {
			const configuration = await apiFetch( {
				path: `${ PATH }/configurations`,
				method: 'POST',
				data: { type, name: name.trim() },
			} );
			onAdded( configuration );
			setName( '' );
			setNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: name of the added notification */
					__(
						'“%s” was added above. It is paused: set it up, turn it on and save it when it is ready.',
						'fair-events'
					),
					configuration.name || TYPE_LABELS[ configuration.type ]
				),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__( 'Failed to add the notification.', 'fair-events' )
				),
			} );
		}
		busy.current = false;
		setPending( false );
	};

	return (
		<Card className="fair-events-notifications__channel fair-events-notifications__add">
			<CardHeader>
				<h2>{ __( 'Add a notification', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Add another notification of any kind, for example a second Telegram summary of a different event feed, or a weekly email to another address. Each notification has its own schedule, events and history.',
						'fair-events'
					) }
				</p>

				{ notice && (
					<Notice
						status={ notice.status }
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }

				<div className="fair-events-notifications__fields">
					<SelectControl
						label={ __( 'Kind', 'fair-events' ) }
						value={ type }
						options={ kinds.map( ( kind ) => ( {
							value: kind,
							label: TYPE_LABELS[ kind ],
						} ) ) }
						onChange={ setType }
					/>
					<TextControl
						label={ __( 'Name', 'fair-events' ) }
						help={ __(
							'Optional. Shown only on this page.',
							'fair-events'
						) }
						value={ name }
						onChange={ setName }
						maxLength={ 100 }
					/>
				</div>

				<div className="fair-events-notifications__actions">
					<Button
						variant="secondary"
						onClick={ add }
						isBusy={ pending }
						disabled={ pending || ! available }
					>
						{ __( 'Add notification', 'fair-events' ) }
					</Button>
				</div>
				{ unavailableMessage && (
					<p className="description">{ unavailableMessage }</p>
				) }
			</CardBody>
		</Card>
	);
}
