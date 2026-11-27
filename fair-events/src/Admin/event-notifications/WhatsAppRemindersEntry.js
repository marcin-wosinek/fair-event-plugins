/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Card, CardBody, CardHeader } from '@wordpress/components';

/**
 * Entry to the WhatsApp sharing reminders, which Fair Events Experimental
 * manages on its own page. Shown only while that page exists: the
 * Experimental plugin is active and its WhatsApp feature is on.
 *
 * @param {Object} props
 * @param {string} props.url The reminders page.
 * @return {JSX.Element} The section.
 */
export default function WhatsAppRemindersEntry( { url } ) {
	return (
		<Card className="fair-events-notifications__channel fair-events-notifications__whatsapp-reminders">
			<CardHeader>
				<h2>{ __( 'WhatsApp sharing reminders', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Remind one collaborator per event feed on WhatsApp each week. The message links to the feed’s weekly summary, which they copy and share with their community themselves. Each feed has its own collaborator, schedule and history.',
						'fair-events'
					) }
				</p>
				<a href={ url }>
					{ __( 'Manage WhatsApp sharing reminders', 'fair-events' ) }
				</a>
			</CardBody>
		</Card>
	);
}
