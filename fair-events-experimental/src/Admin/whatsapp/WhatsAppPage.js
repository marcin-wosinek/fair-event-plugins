/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import WhatsAppConnection from './WhatsAppConnection.js';

/**
 * Fair Events → WhatsApp: the sender's IDs, connection validation and a
 * manual test template send, with page-level notices above them.
 *
 * @return {JSX.Element} The WhatsApp page.
 */
export default function WhatsAppPage() {
	const [ notice, setNotice ] = useState( null );

	return (
		<div className="wrap fair-events-whatsapp">
			<h1>{ __( 'WhatsApp', 'fair-events-experimental' ) }</h1>
			<p>
				{ __(
					'Connect a WhatsApp Business sender and send a test template. Scheduled WhatsApp notifications are not available yet, so nothing is sent automatically.',
					'fair-events-experimental'
				) }
			</p>

			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<WhatsAppConnection onNotice={ setNotice } />
		</div>
	);
}
