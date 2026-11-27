/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Button, Card, CardBody, CardHeader } from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	StatusLabel,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import { outcomeText } from '../whatsapp/DeliveryHistory.js';
import { runTone } from './model.js';

/**
 * The status label of a run: the WhatsApp delivery outcome when it sent
 * something, otherwise what the run did.
 *
 * @param {Object} run Run from the API.
 * @return {{label: string, detail: string}} Status text.
 */
export function runStatus( run ) {
	if ( run.delivery ) {
		const { title, message } = outcomeText( run.delivery );
		return { label: title, detail: message || run.message };
	}
	switch ( run.state ) {
		case 'skipped':
			return {
				label: __( 'Skipped', 'fair-events-experimental' ),
				detail: run.message,
			};
		case 'failed':
			return {
				label: __( 'Failed', 'fair-events-experimental' ),
				detail: run.message,
			};
		default:
			return {
				label: __( 'Outcome unknown', 'fair-events-experimental' ),
				detail: run.message,
			};
	}
}

/**
 * Recent scheduled reminder runs, newest first.
 *
 * @param {Object}   props
 * @param {Object[]} props.runs          Runs from the API.
 * @param {number}   props.retentionDays Days a run is kept.
 * @param {Function} props.onRefresh     Reloads the page data.
 * @param {boolean}  props.refreshing    Whether a reload runs.
 * @return {JSX.Element} The history.
 */
export default function RunHistory( {
	runs,
	retentionDays,
	onRefresh,
	refreshing,
} ) {
	return (
		<Card className="fair-whatsapp-reminders__history">
			<CardHeader>
				<h2>
					{ __( 'Reminder history', 'fair-events-experimental' ) }
				</h2>
				<Button
					variant="secondary"
					onClick={ onRefresh }
					isBusy={ refreshing }
					disabled={ refreshing }
				>
					{ __( 'Refresh statuses', 'fair-events-experimental' ) }
				</Button>
			</CardHeader>
			<CardBody>
				<p className="description">
					{ sprintf(
						/* translators: %d: number of days */
						_n(
							'Each scheduled run is listed once, whether it sent, skipped or failed. A week is never sent twice. Runs are kept for %d day.',
							'Each scheduled run is listed once, whether it sent, skipped or failed. A week is never sent twice. Runs are kept for %d days.',
							retentionDays,
							'fair-events-experimental'
						),
						retentionDays
					) }
				</p>
				{ 0 === runs.length ? (
					<TableMessage status="empty">
						{ __(
							'No reminder has run yet.',
							'fair-events-experimental'
						) }
					</TableMessage>
				) : (
					<AdminTable
						caption={ __(
							'Reminder history',
							'fair-events-experimental'
						) }
					>
						<thead>
							<tr>
								<AdminTableHeaderCell variant="identity">
									{ __(
										'Event feed',
										'fair-events-experimental'
									) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell>
									{ __( 'Week', 'fair-events-experimental' ) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell>
									{ __(
										'Sent to',
										'fair-events-experimental'
									) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell variant="status">
									{ __(
										'Outcome',
										'fair-events-experimental'
									) }
								</AdminTableHeaderCell>
							</tr>
						</thead>
						<tbody>
							{ runs.map( ( run ) => {
								const status = runStatus( run );
								return (
									<tr key={ run.id }>
										<AdminTableCell
											variant="identity"
											label={ __(
												'Event feed',
												'fair-events-experimental'
											) }
										>
											<strong>
												{ run.feed_name ||
													__(
														'(deleted feed)',
														'fair-events-experimental'
													) }
											</strong>
											<br />
											<span className="description">
												{ run.created_at_local }
											</span>
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Week',
												'fair-events-experimental'
											) }
										>
											{ run.send_week }
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Sent to',
												'fair-events-experimental'
											) }
										>
											{ run.recipient || '—' }
										</AdminTableCell>
										<AdminTableCell
											variant="status"
											label={ __(
												'Outcome',
												'fair-events-experimental'
											) }
										>
											<StatusLabel
												tone={ runTone( run ) }
											>
												{ status.label }
											</StatusLabel>
											{ status.detail && (
												<p className="description">
													{ status.detail }
												</p>
											) }
										</AdminTableCell>
									</tr>
								);
							} ) }
						</tbody>
					</AdminTable>
				) }
			</CardBody>
		</Card>
	);
}
