/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

/**
 * Internal dependencies
 */
import { DELIVERY_STATE_LABELS } from './TelegramPreview.js';
import { RUN_STATUS_LABELS, Row, StatusText } from './shared.js';

/**
 * Delivery status of the Telegram channel: the next send, the past weeks
 * and each message by chat.
 *
 * @param {Object} props
 * @param {Object} props.channel Telegram channel payload.
 * @return {JSX.Element} The delivery status.
 */
export default function TelegramHistory( { channel } ) {
	return (
		<>
			<h3>{ __( 'Delivery status', 'fair-events' ) }</h3>
			<p>
				{ channel.next_run
					? sprintf(
							/* translators: 1: date and time of the next send, 2: date range of the week it covers */
							__(
								'Next send: %1$s, with events for %2$s.',
								'fair-events'
							),
							channel.next_run.time_local,
							channel.next_run.week_title
						)
					: __(
							'Nothing is scheduled. Turn on posting and save to schedule sends.',
							'fair-events'
						) }
			</p>
			{ 0 === channel.runs.length ? (
				<p>
					{ __(
						'No Telegram summary has been sent yet.',
						'fair-events'
					) }
				</p>
			) : (
				channel.runs.map( ( run ) => (
					<Row key={ run.week_start } detail={ run.message }>
						<strong>{ run.week_title }</strong>
						<StatusText
							state={ run.status }
							label={
								RUN_STATUS_LABELS[ run.status ] || run.status
							}
						/>
						<span>{ run.time_local }</span>
					</Row>
				) )
			) }

			{ channel.deliveries.length > 0 && (
				<>
					<h3>{ __( 'Messages by chat', 'fair-events' ) }</h3>
					{ channel.deliveries.map( ( delivery ) => (
						<Row
							key={ `${ delivery.week_start }-${ delivery.destination }-${ delivery.part }` }
							detail={
								delivery.error_message || delivery.error_code
							}
						>
							<strong>{ delivery.destination }</strong>
							{ delivery.part_count > 1 && (
								<span>
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
							<StatusText
								state={ delivery.state }
								label={
									DELIVERY_STATE_LABELS[ delivery.state ] ||
									delivery.state
								}
							/>
							<span>{ delivery.updated_at_local }</span>
						</Row>
					) ) }
				</>
			) }
		</>
	);
}
