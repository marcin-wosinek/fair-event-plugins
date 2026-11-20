import { __ } from '@wordpress/i18n';
import {
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
} from '@wordpress/components';

/** Direct Cloud API setup for an administrator's own business. */
export default function SetupGuide() {
	return (
		<Card style={ { marginBottom: '16px', overflowWrap: 'anywhere' } }>
			<CardHeader>
				<h2>
					{ __(
						'Set up direct Cloud API access',
						'fair-events-experimental'
					) }
				</h2>
			</CardHeader>
			<CardBody>
				<ol>
					<li>
						{ __(
							'Open your existing Meta app: Use cases → Connect on WhatsApp → Customize → Quickstart or API Setup. Older apps use WhatsApp → API Setup. Keep the app’s Instagram configuration unchanged.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'Start with Meta’s test sender and temporary access token. Add and verify the permitted test recipients in API Setup; test senders can message only those recipients. Save the access token in Settings → Connectors → WhatsApp.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'Copy the WhatsApp Business Account ID (WABA ID) and Phone Number ID from API Setup into the connection form below. These identify the account and API sender; the Phone Number ID is not the telephone number. Save, then validate the connection.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'Configure Delivery updates below: save the App Secret and your chosen verify token, verify the HTTPS callback, and complete the messages-field subscription, WABA subscription, and publication checks in Meta.',
							'fair-events-experimental'
						) }
					</li>
					<li>
						{ __(
							'For production, add a dedicated number, verify ownership by SMS or voice, and complete Meta’s registration and two-step verification. Configure billing. In Business Settings, assign the app and WhatsApp account to a system user and generate an access token with the required permissions. Replace the temporary token in Connectors, save the production IDs, and validate again. Prepare approved templates without parameters for this plugin’s test sender.',
							'fair-events-experimental'
						) }
					</li>
				</ol>
				<p>
					{ __(
						'The access token authorizes Graph API requests. The App Secret comes from App settings → Basic and authenticates webhook signatures. The verify token is a separate value you choose and enter both here and in Meta’s callback configuration; it is neither the access token nor the App Secret.',
						'fair-events-experimental'
					) }
				</p>
				<p>
					{ __(
						'Saving stores settings locally. Validation only checks account access and number ownership; it does not establish publication, billing, registration, subscriptions, or delivery readiness. Saving and validation do not send messages or change your Meta setup. Send a test only after the recipient agrees, then check Recent messages for the corresponding delivered or read update.',
						'fair-events-experimental'
					) }
				</p>
				<p>
					{ __(
						'Replies to the dedicated API number do not appear in the WhatsApp Business app on your original number. This plugin has no conversation inbox or reply interface.',
						'fair-events-experimental'
					) }
				</p>
				<p>
					<ExternalLink href="https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started">
						{ __(
							'Meta Cloud API setup and system-user permissions',
							'fair-events-experimental'
						) }
					</ExternalLink>
				</p>
				<p>
					<ExternalLink href="https://github.com/marcin-wosinek/fair-event-plugins/blob/main/docs/whatsapp-cloud-api-setup.md">
						{ __(
							'Setup, credential rotation, and missing-update troubleshooting',
							'fair-events-experimental'
						) }
					</ExternalLink>
				</p>
			</CardBody>
		</Card>
	);
}
