/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { ExternalLink, Notice, Spinner } from '@wordpress/components';

/**
 * Internal dependencies
 */
import BulkEmailChannel from './BulkEmailChannel.js';
import IndividualEmailChannel from './IndividualEmailChannel.js';
import TelegramChannel from './TelegramChannel.js';
import { PATH, errorMessage } from './shared.js';

/**
 * The notification channels, in display order. A new channel adds its
 * section here and its payload under the same key in the REST response.
 */
const CHANNELS = [
	{ key: 'telegram', Component: TelegramChannel },
	{ key: 'bulk_email', Component: BulkEmailChannel },
	{ key: 'individual_email', Component: IndividualEmailChannel },
];

/**
 * Apply a read of the page payload, keeping each channel saved after the
 * read was issued: the read may not include that save.
 *
 * @param {Object|null} current   Shown payload.
 * @param {Object}      next      Payload read from the server.
 * @param {number}      requested Number the read was issued with.
 * @param {Object}      saved     Number of each channel's last save.
 * @return {Object} Payload to show.
 */
export function mergeRead( current, next, requested, saved ) {
	if ( ! current ) {
		return next;
	}
	const channels = { ...next.channels };
	Object.keys( saved ).forEach( ( key ) => {
		if ( saved[ key ] > requested && current.channels[ key ] ) {
			channels[ key ] = current.channels[ key ];
		}
	} );
	return { ...next, channels };
}

/**
 * Event notifications admin page: one section per channel, each with its own
 * settings, save button, preview, test and delivery status.
 *
 * @param {Object}      props
 * @param {string|null} props.sourcesUrl Event Sources admin page, when it exists.
 * @return {JSX.Element} The page.
 */
export default function EventNotifications( { sourcesUrl } ) {
	const [ data, setData ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );

	// Orders reads against saves. `issued` numbers every read and save as it
	// happens, `applied` is the newest read shown, and `saved` the number of
	// each channel's last save: a read issued before that save may predate it.
	const requests = useRef( { issued: 0, applied: 0, saved: {} } );

	const load = useCallback( () => {
		const requested = ++requests.current.issued;
		return apiFetch( { path: PATH } ).then( ( next ) => {
			if ( requested < requests.current.applied ) {
				return;
			}
			requests.current.applied = requested;
			const { saved } = requests.current;
			setLoadError( null );
			setData( ( current ) =>
				mergeRead( current, next, requested, saved )
			);
		} );
	}, [] );

	useEffect( () => {
		load().catch( ( error ) =>
			setLoadError(
				errorMessage(
					error,
					__( 'Failed to load event notifications.', 'fair-events' )
				)
			)
		);
	}, [ load ] );

	// Credentials and plugins are changed on other screens, usually in
	// another tab. Coming back re-reads availability and status; each
	// section keeps its own unsaved edits.
	const refresh = useCallback( () => {
		if ( 'hidden' === document.visibilityState ) {
			return;
		}
		load().catch( () => {} );
	}, [ load ] );

	useEffect( () => {
		window.addEventListener( 'focus', refresh );
		document.addEventListener( 'visibilitychange', refresh );
		return () => {
			window.removeEventListener( 'focus', refresh );
			document.removeEventListener( 'visibilitychange', refresh );
		};
	}, [ refresh ] );

	// A save answers with the whole page, but only the saved channel is
	// taken from it: the others may have changed since, on this page too.
	const onSaved = useCallback( ( key, channel ) => {
		requests.current.saved[ key ] = ++requests.current.issued;
		setData( ( current ) => ( {
			...current,
			channels: { ...current.channels, [ key ]: channel },
		} ) );
	}, [] );

	return (
		<div className="wrap fair-events-notifications">
			<h1>{ __( 'Event notifications', 'fair-events' ) }</h1>
			<p>
				{ __(
					'Send the week’s events automatically. Each channel has its own schedule and its own choice of events, and is saved on its own.',
					'fair-events'
				) }
			</p>

			{ loadError && (
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
			) }
			{ ! data && ! loadError && <Spinner /> }

			{ data && 0 === data.sources.length && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'There is no event feed yet. Telegram and bulk email list the events of an event feed, so they can only be turned on once one exists. Individual email can send all published local events without one.',
						'fair-events'
					) }{ ' ' }
					{ sourcesUrl ? (
						<a href={ sourcesUrl }>
							{ __( 'Create an event feed', 'fair-events' ) }
						</a>
					) : (
						__(
							'Event feeds are created with the Fair Events Experimental plugin.',
							'fair-events'
						)
					) }
				</Notice>
			) }

			{ data &&
				CHANNELS.map( ( { key, Component } ) => (
					<Component
						key={ key }
						channel={ data.channels[ key ] }
						sources={ data.sources }
						pages={ data.pages }
						onSaved={ onSaved }
					/>
				) ) }

			{ data && (
				<p className="description">
					{ __(
						'Sends run in the site’s timezone and can be a few minutes late on low-traffic sites.',
						'fair-events'
					) }{ ' ' }
					<ExternalLink href="https://developer.wordpress.org/plugins/cron/">
						{ __( 'How WordPress schedules tasks', 'fair-events' ) }
					</ExternalLink>
				</p>
			) }
		</div>
	);
}
