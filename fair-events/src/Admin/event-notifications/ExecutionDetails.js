/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';
import { Notice, Spinner } from '@wordpress/components';

/**
 * Internal dependencies
 */
import Pagination from './Pagination.js';
import {
	DELIVERY_OUTCOME_LABELS,
	LIFECYCLE_LABELS,
	ORIGIN_LABELS,
	OUTCOME_STATES,
	countsText,
	executionName,
	formatTime,
	outcomeLabel,
	reasonLabel,
} from './historyFormat.js';
import { linkTo } from './navigation.js';
import { NameWithKind, RUN_STATUS_LABELS, StatusText } from './shared.js';
import useHistoryRequest from './useHistoryRequest.js';

const DELIVERIES_PER_PAGE = 50;

/**
 * A calendar day of the history, as the site writes dates. It is a plain
 * date, so it is shown as it is, in no timezone.
 *
 * @param {string} day 'YYYY-MM-DD'.
 * @return {string} Formatted date.
 */
function formatDay( day ) {
	return dateI18n( getSettings().formats.date, `${ day }T00:00:00Z`, 'UTC' );
}

function Field( { label, children } ) {
	return (
		<>
			<dt>{ label }</dt>
			<dd>{ children }</dd>
		</>
	);
}

/**
 * Everything recorded about one execution and its deliveries.
 *
 * It is read under the history's route, so a notification's own history
 * finds only its own executions.
 *
 * @param {Object}   props
 * @param {string}   props.base           Executions route of the history it was opened from.
 * @param {Array}    props.configurations Configurations shown on the page.
 * @param {Object}   props.location       View state, with the `execution` ID.
 * @param {Function} props.navigate       Changes the view.
 * @return {JSX.Element} The details.
 */
export default function ExecutionDetails( {
	base,
	configurations,
	location,
	navigate,
} ) {
	const route = `${ base }/${ location.execution }`;
	const execution = useHistoryRequest(
		route,
		{},
		__( 'Failed to load this history entry.', 'fair-events' )
	);
	const deliveries = useHistoryRequest(
		`${ route }/deliveries`,
		{ page: location.deliveriesPage, per_page: DELIVERIES_PER_PAGE },
		__(
			'Failed to load the messages of this history entry.',
			'fair-events'
		)
	);
	const back = (
		<p>
			<a
				{ ...linkTo( navigate, {
					...location,
					execution: 0,
					deliveriesPage: 1,
				} ) }
			>
				{ __( '← Back to the history', 'fair-events' ) }
			</a>
		</p>
	);

	if ( execution.loading && ! execution.result ) {
		return (
			<>
				{ back }
				<Spinner />
			</>
		);
	}
	// Also an execution of another notification, opened in this one's history.
	if ( 'unknown_execution' === execution.errorCode ) {
		return (
			<>
				{ back }
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'This history entry does not exist here. It may belong to another notification, or it was removed after a year.',
						'fair-events'
					) }
				</Notice>
			</>
		);
	}
	if ( execution.error ) {
		return (
			<>
				{ back }
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Try again', 'fair-events' ),
							onClick: execution.retry,
						},
					] }
				>
					{ execution.error }
				</Notice>
			</>
		);
	}

	const entry = execution.result.items;
	const { configuration } = entry;
	const rows = deliveries.result?.items || [];

	return (
		<div className="fair-events-notifications__details">
			{ back }
			<h2>
				{ sprintf(
					/* translators: 1: notification name, 2: date and time the send or test started */
					__( '%1$s, %2$s', 'fair-events' ),
					executionName( entry, configurations ),
					formatTime( entry.started_at )
				) }
			</h2>

			<dl className="fair-events-notifications__fields-list">
				<Field label={ __( 'Notification', 'fair-events' ) }>
					<NameWithKind
						name={ executionName( entry, configurations ) }
						type={ entry.channel }
					/>
					{ ! configuration.exists && (
						<span className="fair-events-notifications__reason">
							{ __(
								'This notification no longer exists.',
								'fair-events'
							) }
						</span>
					) }
					{ 'migration_fallback' === configuration.name_source && (
						<span className="fair-events-notifications__reason">
							{ __(
								'The name was taken from the notification when older history was imported; it may not be the name it had then.',
								'fair-events'
							) }
						</span>
					) }
				</Field>
				<Field label={ __( 'Scheduled or test', 'fair-events' ) }>
					{ ORIGIN_LABELS[ entry.origin ] || entry.origin }
				</Field>
				<Field label={ __( 'Week of events', 'fair-events' ) }>
					{ entry.week_start && entry.week_end
						? sprintf(
								/* translators: 1: first day of the week, 2: last day of the week */
								__( '%1$s to %2$s', 'fair-events' ),
								formatDay( entry.week_start ),
								formatDay( entry.week_end )
							)
						: __( 'Not recorded', 'fair-events' ) }
				</Field>
				<Field label={ __( 'Started', 'fair-events' ) }>
					{ formatTime( entry.started_at ) }
				</Field>
				<Field label={ __( 'Finished', 'fair-events' ) }>
					{ entry.finished_at
						? formatTime( entry.finished_at )
						: LIFECYCLE_LABELS[ entry.lifecycle ] ||
							entry.lifecycle }
				</Field>
				{ 'abandoned' === entry.lifecycle && (
					<Field label={ __( 'Progress', 'fair-events' ) }>
						{ LIFECYCLE_LABELS.abandoned }
					</Field>
				) }
				<Field label={ __( 'Outcome', 'fair-events' ) }>
					<StatusText
						state={ OUTCOME_STATES[ entry.outcome ] }
						label={ outcomeLabel( entry ) }
					/>
					{ entry.reason_code && (
						<span className="fair-events-notifications__reason">
							{ reasonLabel( entry.reason_code ) }
						</span>
					) }
				</Field>
				<Field label={ __( 'Messages', 'fair-events' ) }>
					{ countsText( entry.counts ) }
				</Field>
			</dl>

			<p className="description">
				{ __(
					'“Accepted” means the mail system or Telegram took the message over. It does not confirm that anyone received it.',
					'fair-events'
				) }
			</p>

			{ entry.legacy && (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'Recorded before this history existed. Only what was kept then is shown, so some details are missing.',
						'fair-events'
					) }
					{ entry.legacy.status && (
						<>
							{ ' ' }
							{ sprintf(
								/* translators: %s: status the older history recorded, e.g. "Sent" */
								__( 'Recorded status: %s.', 'fair-events' ),
								RUN_STATUS_LABELS[ entry.legacy.status ] ||
									entry.legacy.status
							) }
						</>
					) }
					{ entry.legacy.message && <> { entry.legacy.message }</> }
				</Notice>
			) }

			<h3>{ __( 'Recipients and chats', 'fair-events' ) }</h3>
			{ deliveries.error && (
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Try again', 'fair-events' ),
							onClick: deliveries.retry,
						},
					] }
				>
					{ deliveries.error }
				</Notice>
			) }
			{ deliveries.loading && <Spinner /> }
			{ deliveries.result &&
				! deliveries.loading &&
				0 === rows.length && (
					<p>
						{ __(
							'No recipient or chat was recorded for this entry.',
							'fair-events'
						) }
					</p>
				) }
			{ rows.length > 0 && (
				<>
					<table className="widefat striped fair-events-notifications__table">
						<thead>
							<tr>
								<th scope="col">
									{ __( 'Sent to', 'fair-events' ) }
								</th>
								<th scope="col">
									{ __( 'Outcome', 'fair-events' ) }
								</th>
								<th scope="col">
									{ __( 'Attempted', 'fair-events' ) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ rows.map( ( delivery ) => (
								<tr key={ delivery.id }>
									<td
										data-label={ __(
											'Sent to',
											'fair-events'
										) }
									>
										{ delivery.recipient ||
											__(
												'Not recorded',
												'fair-events'
											) }
										{ delivery.recipient_name && (
											<span className="fair-events-notifications__reason">
												{ delivery.recipient_name }
											</span>
										) }
										{ delivery.part_count > 1 && (
											<span className="fair-events-notifications__reason">
												{ sprintf(
													/* translators: 1: message part number, 2: number of parts */
													__(
														'Part %1$d of %2$d',
														'fair-events'
													),
													delivery.part,
													delivery.part_count
												) }
											</span>
										) }
									</td>
									<td
										data-label={ __(
											'Outcome',
											'fair-events'
										) }
									>
										<StatusText
											state={
												OUTCOME_STATES[
													delivery.outcome
												]
											}
											label={
												DELIVERY_OUTCOME_LABELS[
													delivery.outcome
												] || delivery.outcome
											}
										/>
										{ delivery.reason_code && (
											<span className="fair-events-notifications__reason">
												{ reasonLabel(
													delivery.reason_code
												) }
											</span>
										) }
										{ delivery.legacy && (
											<span className="fair-events-notifications__reason">
												{ __(
													'Imported from the older history.',
													'fair-events'
												) }
											</span>
										) }
									</td>
									<td
										data-label={ __(
											'Attempted',
											'fair-events'
										) }
									>
										{ delivery.attempted_at
											? formatTime(
													delivery.attempted_at
												)
											: __(
													'Not attempted',
													'fair-events'
												) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
					<Pagination
						page={ location.deliveriesPage }
						totalPages={ deliveries.result.totalPages }
						label={ __( 'Recipient pages', 'fair-events' ) }
						link={ ( page ) =>
							linkTo( navigate, {
								...location,
								deliveriesPage: page,
							} )
						}
					/>
				</>
			) }
		</div>
	);
}
