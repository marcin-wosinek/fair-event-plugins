import { __ } from '@wordpress/i18n';
import { Card, CardBody, CardHeader, Notice } from '@wordpress/components';

/**
 * Where the weekly notification settings went: they are managed in Fair
 * Events, on its Event notifications page.
 *
 * @param {Object}      props
 * @param {string|null} props.url Event notifications page, or null while the
 *                                active Fair Events is too old to have it.
 * @return {JSX.Element} The card.
 */
export default function WeeklyNotificationsMoved( { url } ) {
	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>
					{ __( 'Weekly notifications', 'fair-events-experimental' ) }
				</h2>
			</CardHeader>
			<CardBody>
				{ url ? (
					<>
						<p>
							{ __(
								'Weekly Telegram notifications are now managed in Fair Events, together with the other notification channels. Your settings, bot token and delivery history moved with them.',
								'fair-events-experimental'
							) }
						</p>
						<p>
							<a href={ url }>
								{ __(
									'Open Event notifications',
									'fair-events-experimental'
								) }
							</a>
						</p>
					</>
				) : (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Weekly Telegram notifications are now managed and sent by Fair Events. Update Fair Events to manage them; until then no weekly notification is sent.',
							'fair-events-experimental'
						) }
					</Notice>
				) }
			</CardBody>
		</Card>
	);
}
