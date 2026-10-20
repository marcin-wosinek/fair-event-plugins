/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { getSettings } from '@wordpress/date';
import {
	Button,
	Notice,
	SelectControl,
	Spinner,
	TextControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import ExecutionDetails from './ExecutionDetails.js';
import Pagination from './Pagination.js';
import {
	ORIGIN_LABELS,
	OUTCOME_LABELS,
	OUTCOME_STATES,
	countsText,
	dayStartUtc,
	executionName,
	formatTime,
	outcomeLabel,
	reasonLabel,
	totalText,
} from './historyFormat.js';
import { linkTo } from './navigation.js';
import { NameWithKind, PATH, StatusText, TYPE_LABELS } from './shared.js';
import useHistoryRequest from './useHistoryRequest.js';

const PER_PAGE = 20;

/**
 * The history's filters. Each change shows the first page again and
 * replaces the current browser history entry.
 *
 * @param {Object}   props
 * @param {Object}   props.filters        Current filters.
 * @param {boolean}  props.scoped         Whether the history is one notification's.
 * @param {Array}    props.configurations Configurations shown on the page.
 * @param {Function} props.onChange       Receives the new filters.
 * @return {JSX.Element} The filters.
 */
function HistoryFilters( { filters, scoped, configurations, onChange } ) {
	const set = ( name ) => ( value ) => {
		const next = { ...filters, [ name ]: value };
		if ( ! value ) {
			delete next[ name ];
		}
		onChange( next );
	};
	const all = ( label ) => [ { value: '', label } ];

	const configurationOptions = [
		...all( __( 'All notifications', 'fair-events' ) ),
		...configurations.map( ( configuration ) => ( {
			value: configuration.id,
			label: configuration.name
				? sprintf(
						/* translators: 1: notification name, 2: its kind, e.g. "Telegram" */
						__( '%1$s (%2$s)', 'fair-events' ),
						configuration.name,
						TYPE_LABELS[ configuration.type ]
					)
				: TYPE_LABELS[ configuration.type ],
		} ) ),
	];
	if (
		filters.configuration &&
		! configurations.some( ( { id } ) => id === filters.configuration )
	) {
		configurationOptions.push( {
			value: filters.configuration,
			label: __( 'A notification that no longer exists', 'fair-events' ),
		} );
	}

	return (
		<div className="fair-events-notifications__filters">
			{ ! scoped && (
				<SelectControl
					label={ __( 'Notification', 'fair-events' ) }
					value={ filters.configuration || '' }
					options={ configurationOptions }
					onChange={ set( 'configuration' ) }
				/>
			) }
			{ ! scoped && (
				<SelectControl
					label={ __( 'Kind', 'fair-events' ) }
					value={ filters.channel || '' }
					options={ [
						...all( __( 'All kinds', 'fair-events' ) ),
						...Object.entries( TYPE_LABELS ).map(
							( [ value, label ] ) => ( { value, label } )
						),
					] }
					onChange={ set( 'channel' ) }
				/>
			) }
			<SelectControl
				label={ __( 'Outcome', 'fair-events' ) }
				value={ filters.outcome || '' }
				options={ [
					...all( __( 'All outcomes', 'fair-events' ) ),
					...Object.entries( OUTCOME_LABELS ).map(
						( [ value, label ] ) => ( {
							value,
							label,
						} )
					),
				] }
				onChange={ set( 'outcome' ) }
			/>
			<SelectControl
				label={ __( 'Scheduled or test', 'fair-events' ) }
				value={ filters.origin || '' }
				options={ [
					...all( __( 'Scheduled sends and tests', 'fair-events' ) ),
					{
						value: 'scheduled',
						label: __( 'Scheduled sends only', 'fair-events' ),
					},
					{ value: 'test', label: __( 'Tests only', 'fair-events' ) },
				] }
				onChange={ set( 'origin' ) }
			/>
			<TextControl
				type="date"
				label={ __( 'Started on or after', 'fair-events' ) }
				value={ filters.from || '' }
				onChange={ set( 'from' ) }
			/>
			<TextControl
				type="date"
				label={ __( 'Started on or before', 'fair-events' ) }
				value={ filters.to || '' }
				onChange={ set( 'to' ) }
			/>
		</div>
	);
}

/**
 * Query arguments of a history page.
 *
 * Date filters are days in the site's timezone, sent as the UTC instants
 * they start and end at.
 *
 * @param {Object}  location View state.
 * @param {boolean} scoped   Whether the history is one notification's.
 * @return {Object} Query arguments.
 */
export function historyQuery( location, scoped ) {
	const { filters } = location;
	const { timezone } = getSettings();
	return {
		page: location.historyPage,
		per_page: PER_PAGE,
		configuration: scoped ? '' : filters.configuration,
		channel: scoped ? '' : filters.channel,
		origin: filters.origin,
		outcome: filters.outcome,
		after: dayStartUtc( filters.from, timezone ),
		before: dayStartUtc( filters.to, timezone, 1 ),
	};
}

/**
 * The executions of every notification, or of one, newest first, with
 * filters, pages and the details of each.
 *
 * A notification's own history is scoped by its ID in the route, so it
 * offers no notification filter and its details are read within it.
 *
 * @param {Object}      props
 * @param {string|null} props.scope          Configuration ID, or null for every notification.
 * @param {Array}       props.configurations Configurations shown on the page.
 * @param {Object}      props.location       View state.
 * @param {Function}    props.navigate       Changes the view.
 * @return {JSX.Element} The history.
 */
export default function HistoryView( {
	scope = null,
	configurations,
	location,
	navigate,
} ) {
	const scoped = null !== scope;
	const base = scoped
		? `${ PATH }/configurations/${ scope }/executions`
		: `${ PATH }/executions`;
	const { filters } = location;
	const invertedDates =
		filters.from && filters.to && filters.from > filters.to;
	const { result, error, loading, retry } = useHistoryRequest(
		location.execution || invertedDates ? null : base,
		historyQuery( location, scoped ),
		__( 'Failed to load the notification history.', 'fair-events' )
	);

	if ( location.execution ) {
		return (
			<ExecutionDetails
				base={ base }
				configurations={ configurations }
				location={ location }
				navigate={ navigate }
			/>
		);
	}

	const filtered = Object.keys( filters ).some(
		( name ) =>
			! scoped || ! [ 'configuration', 'channel' ].includes( name )
	);
	const items = result?.items || [];

	return (
		<div className="fair-events-notifications__history">
			<HistoryFilters
				filters={ filters }
				scoped={ scoped }
				configurations={ configurations }
				onChange={ ( next ) =>
					navigate(
						{ ...location, filters: next, historyPage: 1 },
						{ replace: true }
					)
				}
			/>
			{ filtered && (
				<Button
					variant="link"
					onClick={ () =>
						navigate(
							{ ...location, filters: {}, historyPage: 1 },
							{ replace: true }
						)
					}
				>
					{ __( 'Clear filters', 'fair-events' ) }
				</Button>
			) }

			{ invertedDates && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'The first day is after the last day. Change one of them to see the history.',
						'fair-events'
					) }
				</Notice>
			) }
			{ error && (
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Try again', 'fair-events' ),
							onClick: retry,
						},
					] }
				>
					{ error }
				</Notice>
			) }
			{ loading && <Spinner /> }

			{ result && ! loading && 0 === items.length && (
				<p>
					{ filtered
						? __(
								'Nothing in the history matches these filters.',
								'fair-events'
							)
						: __(
								'Nothing has been sent or tested yet.',
								'fair-events'
							) }
				</p>
			) }

			{ result && items.length > 0 && (
				<>
					<p className="description">
						{ totalText( result.total ) }{ ' ' }
						{ __(
							'“Accepted” means the mail system or Telegram took the message over. It does not confirm that anyone received it.',
							'fair-events'
						) }
					</p>
					<table className="widefat striped fair-events-notifications__table">
						<thead>
							<tr>
								<th scope="col">
									{ __( 'Started', 'fair-events' ) }
								</th>
								{ ! scoped && (
									<th scope="col">
										{ __( 'Notification', 'fair-events' ) }
									</th>
								) }
								<th scope="col">
									{ __( 'Scheduled or test', 'fair-events' ) }
								</th>
								<th scope="col">
									{ __( 'Outcome', 'fair-events' ) }
								</th>
								<th scope="col">
									{ __( 'Messages', 'fair-events' ) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ items.map( ( execution ) => (
								<tr key={ execution.id }>
									<td
										data-label={ __(
											'Started',
											'fair-events'
										) }
									>
										<a
											{ ...linkTo( navigate, {
												...location,
												execution: execution.id,
												deliveriesPage: 1,
											} ) }
										>
											{ formatTime(
												execution.started_at
											) }
										</a>
									</td>
									{ ! scoped && (
										<td
											data-label={ __(
												'Notification',
												'fair-events'
											) }
										>
											<NameWithKind
												name={ executionName(
													execution,
													configurations
												) }
												type={ execution.channel }
											/>
										</td>
									) }
									<td
										data-label={ __(
											'Scheduled or test',
											'fair-events'
										) }
									>
										{ ORIGIN_LABELS[ execution.origin ] ||
											execution.origin }
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
													execution.outcome
												]
											}
											label={ outcomeLabel( execution ) }
										/>
										{ execution.reason_code && (
											<span className="fair-events-notifications__reason">
												{ reasonLabel(
													execution.reason_code
												) }
											</span>
										) }
									</td>
									<td
										data-label={ __(
											'Messages',
											'fair-events'
										) }
									>
										{ countsText( execution.counts ) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
					<Pagination
						page={ location.historyPage }
						totalPages={ result.totalPages }
						label={ __( 'History pages', 'fair-events' ) }
						link={ ( page ) =>
							linkTo( navigate, {
								...location,
								historyPage: page,
							} )
						}
					/>
				</>
			) }
		</div>
	);
}
