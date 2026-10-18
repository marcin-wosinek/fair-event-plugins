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
import AddNotification from './AddNotification.js';
import BulkEmailChannel from './BulkEmailChannel.js';
import IndividualEmailChannel from './IndividualEmailChannel.js';
import TelegramChannel from './TelegramChannel.js';
import { PATH, errorMessage } from './shared.js';

/**
 * The section of each notification kind. A new kind adds its section here
 * and its configurations' `type` in the REST response.
 */
const SECTIONS = {
	telegram: TelegramChannel,
	bulk_email: BulkEmailChannel,
	individual_email: IndividualEmailChannel,
};

/**
 * Apply a read of the page payload, keeping each configuration saved or
 * added after the read was issued: the read may not include that change.
 *
 * @param {Object|null} current   Shown payload.
 * @param {Object}      next      Payload read from the server.
 * @param {number}      requested Number the read was issued with.
 * @param {Object}      saved     Number of each configuration's last save, by ID.
 * @return {Object} Payload to show.
 */
export function mergeRead( current, next, requested, saved ) {
	if ( ! current ) {
		return next;
	}
	const newer = ( id ) => saved[ id ] > requested;
	const shown = Object.fromEntries(
		current.configurations.map( ( configuration ) => [
			configuration.id,
			configuration,
		] )
	);
	const configurations = next.configurations.map( ( configuration ) =>
		newer( configuration.id ) && shown[ configuration.id ]
			? shown[ configuration.id ]
			: configuration
	);
	current.configurations.forEach( ( configuration ) => {
		if (
			newer( configuration.id ) &&
			! next.configurations.some( ( { id } ) => id === configuration.id )
		) {
			configurations.push( configuration );
		}
	} );
	return { ...next, configurations };
}

/**
 * Event notifications admin page: one section per notification, each with
 * its own name, settings, save button, preview, test and delivery status,
 * and a section to add another one.
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
	// each configuration's last save or addition, by ID: a read issued
	// before it may predate it.
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

	// A save answers with the saved configuration only; an added one goes
	// last, in creation order.
	const onSaved = useCallback( ( id, configuration ) => {
		requests.current.saved[ id ] = ++requests.current.issued;
		setData( ( current ) => ( {
			...current,
			configurations: current.configurations.some(
				( shown ) => shown.id === id
			)
				? current.configurations.map( ( shown ) =>
						shown.id === id ? configuration : shown
					)
				: [ ...current.configurations, configuration ],
		} ) );
	}, [] );
	const onAdded = useCallback(
		( configuration ) => onSaved( configuration.id, configuration ),
		[ onSaved ]
	);

	return (
		<div className="wrap fair-events-notifications">
			<h1>{ __( 'Event notifications', 'fair-events' ) }</h1>
			<p>
				{ __(
					'Send the week’s events automatically. Each notification has its own schedule, its own choice of events and its own history, and is saved on its own. You can have more than one of each kind.',
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
				data.configurations.map( ( configuration ) => {
					const Section = SECTIONS[ configuration.type ];
					return Section ? (
						<Section
							key={ configuration.id }
							channel={ configuration }
							sources={ data.sources }
							pages={ data.pages }
							onSaved={ onSaved }
						/>
					) : null;
				} ) }

			{ data && (
				<AddNotification types={ data.types } onAdded={ onAdded } />
			) }

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
