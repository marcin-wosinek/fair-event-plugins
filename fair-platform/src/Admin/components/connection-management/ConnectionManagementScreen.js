/**
 * Shared connection-log screen: statistics, filters, cleanup and history
 * table. Provider pages supply their operations, wording, statuses,
 * statistics and provider-specific columns.
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	Card,
	CardBody,
	CardHeader,
	Button,
	SelectControl,
	TextControl,
	Spinner,
	Notice,
	FlexBlock,
	FlexItem,
	Flex,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConfirmActionModal from '../ConfirmActionModal.js';
import useConnectionManagement, {
	DEFAULT_CLEANUP_DAYS,
} from './useConnectionManagement.js';

const CELL_STYLE = { padding: '12px' };
const MESSAGE_STYLE = { padding: '40px', textAlign: 'center' };
const MUTED_COLOR = '#646970';

const formatDate = ( dateString ) => {
	if ( ! dateString ) return '-';
	return new Date( dateString ).toLocaleString();
};

function StatusBadge( { status, statuses } ) {
	const known = statuses.find( ( item ) => item.value === status );
	const badge = known
		? { color: known.color, text: known.label }
		: { color: MUTED_COLOR, text: status || '-' };

	return (
		<span
			style={ {
				display: 'inline-block',
				padding: '4px 8px',
				borderRadius: '3px',
				fontSize: '12px',
				fontWeight: 'bold',
				color: '#fff',
				backgroundColor: badge.color,
			} }
		>
			{ badge.text }
		</span>
	);
}

function StatisticsCards( { statistics, definitions } ) {
	return (
		<Flex gap={ 4 } wrap>
			{ definitions.map( ( { key, label, color } ) => (
				<FlexBlock key={ key }>
					<Card>
						<CardBody>
							<div
								style={ {
									fontSize: '24px',
									fontWeight: 'bold',
									...( color ? { color } : {} ),
								} }
							>
								{ statistics[ key ] }
							</div>
							<div style={ { color: MUTED_COLOR } }>
								{ label }
							</div>
						</CardBody>
					</Card>
				</FlexBlock>
			) ) }
		</Flex>
	);
}

function SiteCell( { connection } ) {
	return (
		<>
			<div>
				<strong>{ connection.site_name || '-' }</strong>
			</div>
			{ connection.site_url && (
				<div style={ { fontSize: '12px', color: MUTED_COLOR } }>
					<a
						href={ connection.site_url }
						target="_blank"
						rel="noopener noreferrer"
					>
						{ connection.site_url }
					</a>
				</div>
			) }
			{ connection.site_id && (
				<div
					style={ {
						fontSize: '11px',
						color: '#999',
						fontFamily: 'monospace',
					} }
				>
					{ connection.site_id }
				</div>
			) }
		</>
	);
}

/**
 * @param {Object}   props                       Component props.
 * @param {Object}   props.api                   Provider operations (`list`, `stats`, `cleanup`).
 * @param {Object}   props.labels                Provider wording.
 * @param {string}   props.labels.title          Page heading.
 * @param {string}   props.labels.description    Page description.
 * @param {string}   props.labels.listError      Fallback list error.
 * @param {string}   props.labels.empty          Empty-list message.
 * @param {string}   props.labels.history        Table card heading.
 * @param {string}   props.labels.cleanupTitle   Cleanup dialog title.
 * @param {Function} props.labels.cleanupMessage Cleanup consequence for a number of days.
 * @param {Array}    props.statuses              `{ value, label, color }` in filter order.
 * @param {Array}    props.statistics            `{ key, label, color? }` statistic cards.
 * @param {Array}    props.columns               `{ id, label, render }` provider columns.
 * @param {Function} [props.renderStatusDetails] Extra content below a row's status.
 * @return {JSX.Element} The screen.
 */
export default function ConnectionManagementScreen( {
	api,
	labels,
	statuses,
	statistics: statisticDefinitions,
	columns,
	renderStatusDetails,
} ) {
	const {
		connections,
		statistics,
		loading,
		error,
		page,
		setPage,
		totalPages,
		statusFilter,
		setStatusFilter,
		orderBy,
		setOrderBy,
		order,
		setOrder,
		cleanupDays,
		setCleanupDays,
		cleanupResult,
		setCleanupResult,
		cleanup,
		openCleanup,
		confirmCleanup,
	} = useConnectionManagement( { api, listErrorText: labels.listError } );

	const headers = [
		__( 'ID', 'fair-platform' ),
		__( 'Site', 'fair-platform' ),
		__( 'Status', 'fair-platform' ),
		...columns.map( ( column ) => column.label ),
		__( 'Connected At', 'fair-platform' ),
		__( 'Last Refresh', 'fair-platform' ),
	];

	return (
		<VStack spacing={ 4 }>
			<div>
				<h1>{ labels.title }</h1>
				<p>{ labels.description }</p>
			</div>

			{ statistics && (
				<StatisticsCards
					statistics={ statistics }
					definitions={ statisticDefinitions }
				/>
			) }

			<Card>
				<CardBody>
					<HStack spacing={ 3 } alignment="bottom">
						<SelectControl
							label={ __( 'Status Filter', 'fair-platform' ) }
							value={ statusFilter }
							options={ [
								{
									label: __(
										'All Statuses',
										'fair-platform'
									),
									value: '',
								},
								...statuses.map( ( { value, label } ) => ( {
									label,
									value,
								} ) ),
							] }
							onChange={ setStatusFilter }
						/>
						<SelectControl
							label={ __( 'Sort By', 'fair-platform' ) }
							value={ orderBy }
							options={ [
								{
									label: __(
										'Connection Date',
										'fair-platform'
									),
									value: 'connected_at',
								},
								{
									label: __( 'Site Name', 'fair-platform' ),
									value: 'site_name',
								},
								{
									label: __( 'Status', 'fair-platform' ),
									value: 'status',
								},
								{
									label: __( 'ID', 'fair-platform' ),
									value: 'id',
								},
							] }
							onChange={ setOrderBy }
						/>
						<SelectControl
							label={ __( 'Order', 'fair-platform' ) }
							value={ order }
							options={ [
								{
									label: __( 'Descending', 'fair-platform' ),
									value: 'DESC',
								},
								{
									label: __( 'Ascending', 'fair-platform' ),
									value: 'ASC',
								},
							] }
							onChange={ setOrder }
						/>
						<FlexItem style={ { marginLeft: 'auto' } }>
							<TextControl
								label={ __( 'Cleanup Days', 'fair-platform' ) }
								type="number"
								value={ cleanupDays }
								onChange={ ( value ) =>
									setCleanupDays(
										parseInt( value ) ||
											DEFAULT_CLEANUP_DAYS
									)
								}
								style={ { width: '100px' } }
							/>
						</FlexItem>
						<FlexItem>
							<Button
								variant="secondary"
								onClick={ openCleanup }
								style={ { marginTop: '22px' } }
							>
								{ __( 'Cleanup Old Logs', 'fair-platform' ) }
							</Button>
						</FlexItem>
					</HStack>
				</CardBody>
			</Card>

			{ cleanupResult && (
				<Notice
					status="success"
					onRemove={ () => setCleanupResult( null ) }
				>
					{ cleanupResult }
				</Notice>
			) }

			{ cleanup.target && (
				<ConfirmActionModal
					title={ labels.cleanupTitle }
					confirmLabel={ __( 'Delete old logs', 'fair-platform' ) }
					busyLabel={ __( 'Deleting…', 'fair-platform' ) }
					isDestructive
					isBusy={ cleanup.isBusy }
					error={ cleanup.error }
					onConfirm={ confirmCleanup }
					onCancel={ cleanup.close }
				>
					<p>{ labels.cleanupMessage( cleanup.target.days ) }</p>
					<p>
						{ __(
							'Only the log history is deleted; existing connections keep working. This cannot be undone.',
							'fair-platform'
						) }
					</p>
				</ConfirmActionModal>
			) }

			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			<Card>
				<CardHeader>
					<h2>{ labels.history }</h2>
				</CardHeader>
				<CardBody style={ { padding: 0 } }>
					{ loading ? (
						<div style={ MESSAGE_STYLE }>
							<Spinner />
						</div>
					) : connections.length === 0 ? (
						<div style={ MESSAGE_STYLE }>
							<p style={ { color: MUTED_COLOR } }>
								{ labels.empty }
							</p>
						</div>
					) : (
						<div style={ { overflowX: 'auto' } }>
							<table
								className="wp-list-table widefat fixed striped"
								style={ { borderSpacing: 0 } }
							>
								<thead>
									<tr>
										{ headers.map( ( header, index ) => (
											<th
												key={ index }
												style={ CELL_STYLE }
											>
												{ header }
											</th>
										) ) }
									</tr>
								</thead>
								<tbody>
									{ connections.map( ( connection ) => (
										<tr key={ connection.id }>
											<td style={ CELL_STYLE }>
												{ connection.id }
											</td>
											<td style={ CELL_STYLE }>
												<SiteCell
													connection={ connection }
												/>
											</td>
											<td style={ CELL_STYLE }>
												<StatusBadge
													status={ connection.status }
													statuses={ statuses }
												/>
												{ connection.error_message && (
													<div
														style={ {
															marginTop: '8px',
															fontSize: '12px',
															color: '#d63638',
														} }
													>
														{
															connection.error_message
														}
													</div>
												) }
												{ renderStatusDetails?.(
													connection
												) }
											</td>
											{ columns.map( ( column ) => (
												<td
													key={ column.id }
													style={ CELL_STYLE }
												>
													{ column.render(
														connection
													) }
												</td>
											) ) }
											<td style={ CELL_STYLE }>
												{ formatDate(
													connection.connected_at
												) }
											</td>
											<td style={ CELL_STYLE }>
												{ formatDate(
													connection.last_token_refresh
												) }
											</td>
										</tr>
									) ) }
								</tbody>
							</table>
						</div>
					) }

					{ totalPages > 1 && (
						<div
							style={ {
								padding: '12px',
								borderTop: '1px solid #dcdcde',
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
							} }
						>
							<div>
								{ sprintf(
									/* translators: 1: current page number, 2: total number of pages */
									__( 'Page %1$d of %2$d', 'fair-platform' ),
									page,
									totalPages
								) }
							</div>
							<HStack spacing={ 2 }>
								<Button
									variant="secondary"
									disabled={ page === 1 }
									onClick={ () => setPage( page - 1 ) }
								>
									{ __( 'Previous', 'fair-platform' ) }
								</Button>
								<Button
									variant="secondary"
									disabled={ page === totalPages }
									onClick={ () => setPage( page + 1 ) }
								>
									{ __( 'Next', 'fair-platform' ) }
								</Button>
							</HStack>
						</div>
					) }
				</CardBody>
			</Card>
		</VStack>
	);
}
