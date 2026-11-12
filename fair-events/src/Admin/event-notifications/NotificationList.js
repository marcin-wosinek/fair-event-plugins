/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from '@wordpress/element';
import { Notice, SelectControl, TextControl } from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableHeaderCell,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import NotificationRow from './NotificationRow.js';
import Pagination from './Pagination.js';
import { tokenStatus } from './TelegramChannel.js';
import { linkTo } from './navigation.js';
import { TYPE_LABELS } from './shared.js';

const PER_PAGE = 20;

/**
 * Who or where a notification sends to, without loading any recipient list.
 *
 * @param {Object} configuration Configuration payload.
 * @return {string} Summary.
 */
export function audienceSummary( configuration ) {
	if ( 'telegram' === configuration.type ) {
		const chats = configuration.chat_ids || [];
		return chats.length
			? chats.join( ', ' )
			: __( 'No chat or channel yet', 'fair-events' );
	}
	if ( 'bulk_email' === configuration.type ) {
		return __(
			'Subscribers of this event feed, chosen by Fair Audience',
			'fair-events'
		);
	}
	return configuration.recipient || __( 'No address yet', 'fair-events' );
}

/**
 * What keeps a notification from sending as set up, if anything.
 *
 * @param {Object} configuration Configuration payload.
 * @return {string|null} The problem.
 */
export function integrationProblem( configuration ) {
	if ( 'active' !== configuration.state ) {
		return configuration.state_message || null;
	}
	if ( configuration.configuration_error ) {
		return configuration.configuration_error;
	}
	if (
		'telegram' === configuration.type &&
		! ( configuration.token_configured && configuration.token_valid )
	) {
		return tokenStatus( configuration ).message;
	}
	return null;
}

/**
 * Whether a notification matches a search, by its name, kind or audience.
 *
 * @param {Object} configuration Configuration payload.
 * @param {string} search        Typed search.
 * @return {boolean} Whether it matches.
 */
export function matchesSearch( configuration, search ) {
	const needle = search.trim().toLowerCase();
	if ( ! needle ) {
		return true;
	}
	return [
		configuration.name,
		TYPE_LABELS[ configuration.type ],
		audienceSummary( configuration ),
	].some( ( text ) => ( text || '' ).toLowerCase().includes( needle ) );
}

/**
 * Individual email's event selection meaning every published local event,
 * not an event feed. Mirrors IndividualEmailSettings::LOCAL_EVENTS.
 */
const LOCAL_EVENTS = '@local';

/**
 * The event feed a notification's saved settings send events from.
 *
 * @param {Object} configuration Configuration payload.
 * @return {string} Event feed slug, or '' when it names none.
 */
export function feedOf( configuration ) {
	if ( 'individual_email' === configuration.type ) {
		const selection = configuration.event_selection || '';
		return LOCAL_EVENTS === selection ? '' : selection;
	}
	return configuration.source_slug || '';
}

/**
 * Options of the event feed filter: every feed, then each enabled feed. A
 * feed in the URL that is not enabled stays selected, marked unavailable.
 *
 * @param {Array}  sources Enabled event feeds.
 * @param {string} current Feed slug in the URL.
 * @return {Array} Select options.
 */
function feedOptions( sources, current ) {
	const options = [
		{ value: '', label: __( 'All feeds', 'fair-events' ) },
		...sources.map( ( source ) => ( {
			value: source.slug,
			label: source.name || source.slug,
		} ) ),
	];
	if ( current && ! sources.some( ( source ) => source.slug === current ) ) {
		options.push( {
			value: current,
			label: sprintf(
				/* translators: %s: event feed slug */
				__( '%s (unavailable)', 'fair-events' ),
				current
			),
		} );
	}
	return options;
}

/**
 * Why the list shows no notification.
 *
 * @param {Object} props
 * @param {number} props.total    Number of notifications.
 * @param {number} props.inFeed   Number of notifications of the selected feed.
 * @param {string} props.feedName Selected feed's name, or '' for every feed.
 * @param {string} props.search   Typed search.
 * @return {string} Message.
 */
function emptyMessage( { total, inFeed, feedName, search } ) {
	if ( 0 === total ) {
		return __(
			'There is no notification yet. Add one below.',
			'fair-events'
		);
	}
	if ( feedName && 0 === inFeed ) {
		return sprintf(
			/* translators: %s: event feed name */
			__( 'No notification sends events from “%s”.', 'fair-events' ),
			feedName
		);
	}
	if ( feedName ) {
		return sprintf(
			/* translators: 1: the typed search, 2: event feed name */
			__( 'No notification of “%2$s” matches “%1$s”.', 'fair-events' ),
			search,
			feedName
		);
	}
	return sprintf(
		/* translators: %s: the typed search */
		__( 'No notification matches “%s”.', 'fair-events' ),
		search
	);
}

/**
 * Every notification in a searchable list of pages, which can be narrowed
 * to one event feed. Each row (see NotificationRow) links to its editor and
 * shows whether it is on, where it sends, its next send and its latest send
 * or test, with Edit and a menu of History, Duplicate and Delete. Once one
 * is deleted, focus moves to the search, the list's first control, and the
 * result is reported above the list. On narrow screens each row stacks into
 * labeled lines.
 *
 * Membership follows saved settings: a draft that changes a notification's
 * feed moves it only once it is saved.
 *
 * @param {Object}   props
 * @param {Array}    props.configurations     Configuration payloads.
 * @param {Array}    props.sources            Enabled event feeds.
 * @param {Array}    props.dirty              IDs of notifications with unsaved changes.
 * @param {Object}   props.location           View state.
 * @param {Function} props.navigate           Changes the view.
 * @param {Function} props.onDuplicated       Receives the payload of a duplicated notification's copy.
 * @param {Function} props.onDeleted          Receives the payload of a deleted notification.
 * @param {Object}   [props.deleted]          The last deletion's report, `{ message }`, or null.
 * @param {Function} [props.onDismissDeleted] Hides the deletion report.
 * @return {JSX.Element} The list.
 */
export default function NotificationList( {
	configurations,
	sources = [],
	dirty,
	location,
	navigate,
	onDuplicated,
	onDeleted,
	deleted = null,
	onDismissDeleted,
} ) {
	const searchField = useRef();
	// The deleted row and its dialog are gone; keep focus in the list.
	useEffect( () => {
		if ( deleted ) {
			searchField.current?.focus();
		}
	}, [ deleted ] );

	const { feed } = location;
	const selectedFeed = feed
		? sources.find( ( source ) => source.slug === feed )
		: null;
	const unavailable = !! feed && ! selectedFeed;
	const inFeed = unavailable
		? []
		: configurations.filter(
				( configuration ) => ! feed || feedOf( configuration ) === feed
			);
	const matching = inFeed.filter( ( configuration ) =>
		matchesSearch( configuration, location.search )
	);
	const selectFeed = ( slug ) =>
		navigate( { ...location, feed: slug, listPage: 1 } );
	const totalPages = Math.max( 1, Math.ceil( matching.length / PER_PAGE ) );
	const page = Math.min( location.listPage, totalPages );
	const shown = matching.slice( ( page - 1 ) * PER_PAGE, page * PER_PAGE );
	return (
		<div className="fair-events-notifications__list">
			{ deleted && (
				<Notice
					status="success"
					className="fair-events-notifications__deleted"
					onRemove={ onDismissDeleted }
				>
					{ deleted.message }
				</Notice>
			) }
			<div className="fair-events-notifications__list-controls">
				<TextControl
					ref={ searchField }
					className="fair-events-notifications__search"
					label={ __( 'Search notifications', 'fair-events' ) }
					help={ __(
						'By name, kind, address or chat.',
						'fair-events'
					) }
					value={ location.search }
					onChange={ ( search ) =>
						navigate(
							{ ...location, search, listPage: 1 },
							{ replace: true }
						)
					}
				/>
				<SelectControl
					className="fair-events-notifications__feed"
					label={ __( 'Event feed', 'fair-events' ) }
					help={ __(
						'Shows the notifications that send events from this feed.',
						'fair-events'
					) }
					value={ feed }
					options={ feedOptions( sources, feed ) }
					onChange={ selectFeed }
				/>
			</div>

			{ unavailable && (
				<Notice
					status="warning"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Show all feeds', 'fair-events' ),
							onClick: () => selectFeed( '' ),
							variant: 'secondary',
						},
					] }
				>
					{ sprintf(
						/* translators: %s: event feed slug */
						__(
							'The event feed “%s” is not available: it does not exist, was deleted or is turned off. No notification is listed for it.',
							'fair-events'
						),
						feed
					) }
				</Notice>
			) }

			{ ! unavailable && 0 === matching.length && (
				<TableMessage
					status={
						0 === configurations.length ? 'empty' : 'no-results'
					}
					onClear={
						location.search
							? () =>
									navigate( {
										...location,
										search: '',
										listPage: 1,
									} )
							: undefined
					}
					clearLabel={ __( 'Clear search', 'fair-events' ) }
				>
					{ emptyMessage( {
						total: configurations.length,
						inFeed: inFeed.length,
						feedName: selectedFeed
							? selectedFeed.name || selectedFeed.slug
							: '',
						search: location.search,
					} ) }
				</TableMessage>
			) }

			{ 0 < matching.length && (
				<AdminTable
					caption={ __( 'Notifications', 'fair-events' ) }
					className="fair-events-notifications__list-table"
				>
					<thead>
						<tr>
							<AdminTableHeaderCell variant="identity">
								{ __( 'Notification', 'fair-events' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell>
								{ __( 'Sends to', 'fair-events' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell variant="status">
								{ __( 'Status', 'fair-events' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell>
								{ __( 'Next send', 'fair-events' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell>
								{ __( 'Latest send or test', 'fair-events' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell variant="actions">
								{ __( 'Actions', 'fair-events' ) }
							</AdminTableHeaderCell>
						</tr>
					</thead>
					<tbody>
						{ shown.map( ( configuration ) => (
							<NotificationRow
								key={ configuration.id }
								configuration={ configuration }
								audience={ audienceSummary( configuration ) }
								problem={ integrationProblem( configuration ) }
								isDirty={ dirty.includes( configuration.id ) }
								navigate={ navigate }
								onDuplicated={ onDuplicated }
								onDeleted={ onDeleted }
							/>
						) ) }
					</tbody>
				</AdminTable>
			) }

			<Pagination
				page={ page }
				totalPages={ totalPages }
				label={ __( 'Notification pages', 'fair-events' ) }
				link={ ( number ) =>
					linkTo( navigate, { ...location, listPage: number } )
				}
			/>
		</div>
	);
}
