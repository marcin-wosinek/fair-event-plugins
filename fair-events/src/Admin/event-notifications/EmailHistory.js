/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { RUN_STATUS_LABELS, Row, StatusText } from './shared.js';

/**
 * Delivery status of an email channel: the next send and the past weeks.
 *
 * @param {Object}  props
 * @param {Object}  props.channel         Email channel payload.
 * @param {Object}  props.statusLabels    Labels of the run statuses.
 * @param {boolean} props.showDestination Whether each run names its address.
 * @return {JSX.Element} The delivery status.
 */
export default function EmailHistory( {
	channel,
	statusLabels = RUN_STATUS_LABELS,
	showDestination = false,
} ) {
	return (
		<>
			<h3>{ __( 'Delivery status', 'fair-events' ) }</h3>
			<p>
				{ channel.next_run
					? sprintf(
							/* translators: %s: date and time of the next send */
							__( 'Next send: %s.', 'fair-events' ),
							channel.next_run.time_local
						)
					: __(
							'Nothing is scheduled. Turn on the weekly email and save to schedule sends.',
							'fair-events'
						) }
			</p>
			{ 0 === channel.runs.length ? (
				<p>
					{ __(
						'No weekly email has been sent yet.',
						'fair-events'
					) }
				</p>
			) : (
				channel.runs.map( ( run ) => (
					<Row
						key={ run.send_week || run.time }
						detail={ run.message }
					>
						<strong>{ run.week_title || run.send_week }</strong>
						<StatusText
							state={ run.status }
							label={ statusLabels[ run.status ] || run.status }
						/>
						{ showDestination && run.destination && (
							<span>{ run.destination }</span>
						) }
						<span>{ run.time_local }</span>
					</Row>
				) )
			) }
		</>
	);
}
