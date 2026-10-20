/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { TextControl } from '@wordpress/components';

/**
 * Internal dependencies
 */
import Pagination from './Pagination.js';
import { tokenStatus } from './TelegramChannel.js';
import {
	ORIGIN_LABELS,
	OUTCOME_STATES,
	formatTime,
	outcomeLabel,
} from './historyFormat.js';
import { linkTo } from './navigation.js';
import { StatusText, TYPE_LABELS } from './shared.js';

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
			'Subscribers who agreed to marketing emails, chosen by Fair Audience',
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
 * Every notification in a searchable list of pages. Each row links to its
 * editor and its own history, and shows whether it is on, where it sends,
 * its next send and its latest send or test. On narrow screens each row
 * stacks into labeled lines.
 *
 * @param {Object}   props
 * @param {Array}    props.configurations Configuration payloads.
 * @param {Array}    props.dirty          IDs of notifications with unsaved changes.
 * @param {Object}   props.location       View state.
 * @param {Function} props.navigate       Changes the view.
 * @return {JSX.Element} The list.
 */
export default function NotificationList( {
	configurations,
	dirty,
	location,
	navigate,
} ) {
	const matching = configurations.filter( ( configuration ) =>
		matchesSearch( configuration, location.search )
	);
	const totalPages = Math.max( 1, Math.ceil( matching.length / PER_PAGE ) );
	const page = Math.min( location.listPage, totalPages );
	const shown = matching.slice( ( page - 1 ) * PER_PAGE, page * PER_PAGE );
	const open = ( configuration, tab, extra = {} ) =>
		linkTo( navigate, {
			view: 'configuration',
			configuration: configuration.id,
			tab,
			filters: {},
			...extra,
		} );

	return (
		<div className="fair-events-notifications__list">
			<TextControl
				className="fair-events-notifications__search"
				label={ __( 'Search notifications', 'fair-events' ) }
				help={ __( 'By name, kind, address or chat.', 'fair-events' ) }
				value={ location.search }
				onChange={ ( search ) =>
					navigate(
						{ ...location, search, listPage: 1 },
						{ replace: true }
					)
				}
			/>

			{ 0 === matching.length ? (
				<p>
					{ location.search
						? sprintf(
								/* translators: %s: the typed search */
								__(
									'No notification matches “%s”.',
									'fair-events'
								),
								location.search
							)
						: __(
								'There is no notification yet. Add one below.',
								'fair-events'
							) }
				</p>
			) : (
				<table className="widefat striped fair-events-notifications__table">
					<thead>
						<tr>
							<th scope="col">
								{ __( 'Notification', 'fair-events' ) }
							</th>
							<th scope="col">
								{ __( 'Sends to', 'fair-events' ) }
							</th>
							<th scope="col">
								{ __( 'Status', 'fair-events' ) }
							</th>
							<th scope="col">
								{ __( 'Next send', 'fair-events' ) }
							</th>
							<th scope="col">
								{ __( 'Latest send or test', 'fair-events' ) }
							</th>
						</tr>
					</thead>
					<tbody>
						{ shown.map( ( configuration ) => {
							const problem = integrationProblem( configuration );
							const latest = configuration.latest_execution;
							return (
								<tr key={ configuration.id }>
									<td
										data-label={ __(
											'Notification',
											'fair-events'
										) }
										className="fair-events-notifications__primary"
									>
										<strong>
											<a
												{ ...open(
													configuration,
													'editor'
												) }
											>
												{ configuration.name ||
													TYPE_LABELS[
														configuration.type
													] }
											</a>
										</strong>{ ' ' }
										{ configuration.name && (
											<span className="fair-events-notifications__kind">
												{
													TYPE_LABELS[
														configuration.type
													]
												}
											</span>
										) }
										{ dirty.includes(
											configuration.id
										) && (
											<span className="fair-events-notifications__unsaved">
												{ __(
													'Unsaved changes',
													'fair-events'
												) }
											</span>
										) }
										<span className="fair-events-notifications__row-actions">
											<a
												{ ...open(
													configuration,
													'editor'
												) }
											>
												{ __( 'Edit', 'fair-events' ) }
											</a>
											<a
												{ ...open(
													configuration,
													'history'
												) }
											>
												{ __(
													'History',
													'fair-events'
												) }
											</a>
										</span>
									</td>
									<td
										data-label={ __(
											'Sends to',
											'fair-events'
										) }
									>
										{ audienceSummary( configuration ) }
									</td>
									<td
										data-label={ __(
											'Status',
											'fair-events'
										) }
									>
										{ configuration.enabled ? (
											<StatusText
												state="sent"
												label={ __(
													'On',
													'fair-events'
												) }
											/>
										) : (
											<StatusText
												label={ __(
													'Paused',
													'fair-events'
												) }
											/>
										) }
										{ problem && (
											<span className="fair-events-notifications__problem">
												{ problem }
											</span>
										) }
									</td>
									<td
										data-label={ __(
											'Next send',
											'fair-events'
										) }
									>
										{ configuration.next_run
											? configuration.next_run.time_local
											: __(
													'Not scheduled',
													'fair-events'
												) }
									</td>
									<td
										data-label={ __(
											'Latest send or test',
											'fair-events'
										) }
									>
										{ latest ? (
											<a
												{ ...open(
													configuration,
													'history',
													{
														execution: latest.id,
													}
												) }
											>
												{ sprintf(
													/* translators: 1: "Scheduled" or "Test", 2: date and time it started */
													__(
														'%1$s, %2$s',
														'fair-events'
													),
													ORIGIN_LABELS[
														latest.origin
													] || latest.origin,
													formatTime(
														latest.started_at
													)
												) }
											</a>
										) : (
											__(
												'Nothing sent yet',
												'fair-events'
											)
										) }
										{ latest && (
											<span className="fair-events-notifications__reason">
												<StatusText
													state={
														OUTCOME_STATES[
															latest.outcome
														]
													}
													label={ outcomeLabel(
														latest
													) }
												/>
											</span>
										) }
									</td>
								</tr>
							);
						} ) }
					</tbody>
				</table>
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
