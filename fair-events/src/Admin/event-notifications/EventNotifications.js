/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { ExternalLink, Notice, Spinner } from '@wordpress/components';

/**
 * Internal dependencies
 */
import AddNotification from './AddNotification.js';
import ConfigurationView from './ConfigurationView.js';
import HistoryView from './HistoryView.js';
import NotificationList from './NotificationList.js';
import { DraftsContext, useDraftStore } from './drafts.js';
import { linkTo, useLocationState } from './navigation.js';
import {
	PATH,
	TYPE_LABELS,
	errorMessage,
	useUnsavedWarning,
} from './shared.js';

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
 * Event notifications admin page: the list of notifications, each one's
 * editor and history, and the history of all of them. The view is kept in
 * the URL.
 *
 * Each notification keeps its unsaved draft while other views are open, by
 * its ID, until the page is left; leaving it with unsaved drafts is warned
 * about.
 *
 * @param {Object}      props
 * @param {string|null} props.sourcesUrl Event Sources admin page, when it exists.
 * @return {JSX.Element} The page.
 */
export default function EventNotifications( { sourcesUrl } ) {
	const [ data, setData ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ location, navigate ] = useLocationState();
	// A message about how the view was reached, with the view it belongs
	// to: it is shown there only, so it is gone as soon as the view changes.
	const [ flash, setFlash ] = useState( null );
	const { store, dirty } = useDraftStore();
	useUnsavedWarning( dirty.length > 0 );

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

	const initialLoad = useCallback( () => {
		setLoadError( null );
		load().catch( ( error ) =>
			setLoadError(
				errorMessage(
					error,
					__( 'Failed to load event notifications.', 'fair-events' )
				)
			)
		);
	}, [ load ] );

	useEffect( () => {
		initialLoad();
	}, [ initialLoad ] );

	// The list shows each notification's latest send, which a test sent
	// from its editor may have changed.
	const { view } = location;
	const previousView = useRef( view );
	useEffect( () => {
		if ( 'list' === view && 'list' !== previousView.current ) {
			load().catch( () => {} );
		}
		previousView.current = view;
	}, [ view, load ] );

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
		( configuration ) => {
			onSaved( configuration.id, configuration );
			const reached = navigate( {
				view: 'configuration',
				configuration: configuration.id,
				tab: 'editor',
			} );
			setFlash( {
				location: reached,
				message: sprintf(
					/* translators: %s: name of the added notification */
					__(
						'“%s” was added. It is paused: set it up, turn it on and save it when it is ready.',
						'fair-events'
					),
					configuration.name || TYPE_LABELS[ configuration.type ]
				),
			} );
		},
		[ onSaved, navigate ]
	);

	const noFeed = data && 0 === data.sources.length && (
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
	);

	let content = null;
	if ( data && 'configuration' === view ) {
		content = (
			<>
				{ noFeed }
				<ConfigurationView
					data={ data }
					dirty={ dirty }
					location={ location }
					navigate={ navigate }
					onSaved={ onSaved }
					flash={
						flash?.location === location ? flash.message : null
					}
				/>
			</>
		);
	} else if ( data && 'history' === view ) {
		content = (
			<>
				<p className="fair-events-notifications__breadcrumbs">
					<a { ...linkTo( navigate, { view: 'list' } ) }>
						{ __( '← All notifications', 'fair-events' ) }
					</a>
				</p>
				<h2>{ __( 'All notification history', 'fair-events' ) }</h2>
				<p>
					{ __(
						'Every scheduled send and test of every notification, newest first. Open an entry to see each recipient or chat.',
						'fair-events'
					) }
				</p>
				<HistoryView
					configurations={ data.configurations }
					location={ location }
					navigate={ navigate }
				/>
			</>
		);
	} else if ( data ) {
		content = (
			<>
				<p>
					{ __(
						'Send the week’s events automatically. Each notification has its own schedule, its own choice of events and its own history, and is saved on its own. You can have more than one of each kind.',
						'fair-events'
					) }
				</p>
				{ noFeed }
				<p className="fair-events-notifications__breadcrumbs">
					<a
						{ ...linkTo( navigate, {
							view: 'history',
							filters: {},
						} ) }
					>
						{ __( 'All notification history', 'fair-events' ) }
					</a>
				</p>
				<NotificationList
					configurations={ data.configurations }
					dirty={ dirty }
					location={ location }
					navigate={ navigate }
				/>
				<AddNotification types={ data.types } onAdded={ onAdded } />
				<p className="description">
					{ __(
						'Sends run in the site’s timezone and can be a few minutes late on low-traffic sites.',
						'fair-events'
					) }{ ' ' }
					<ExternalLink href="https://developer.wordpress.org/plugins/cron/">
						{ __( 'How WordPress schedules tasks', 'fair-events' ) }
					</ExternalLink>
				</p>
			</>
		);
	}

	return (
		<DraftsContext.Provider value={ store }>
			<div className="wrap fair-events-notifications">
				<h1>{ __( 'Event notifications', 'fair-events' ) }</h1>

				{ loadError && (
					<Notice
						status="error"
						isDismissible={ false }
						actions={
							data
								? []
								: [
										{
											label: __(
												'Try again',
												'fair-events'
											),
											onClick: initialLoad,
										},
									]
						}
					>
						{ loadError }
					</Notice>
				) }
				{ ! data && ! loadError && <Spinner /> }

				{ content }
			</div>
		</DraftsContext.Provider>
	);
}
