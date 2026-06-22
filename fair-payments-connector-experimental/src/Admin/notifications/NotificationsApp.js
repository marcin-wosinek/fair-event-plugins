/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import NotificationsTab from './NotificationsTab.js';

/**
 * Notifications settings page root component.
 *
 * @return {JSX.Element} The Notifications settings page
 */
export default function NotificationsApp() {
	const [notice, setNotice] = useState(null);

	return (
		<div className="wrap">
			<h1>
				{__('Notifications', 'fair-payments-connector-experimental')}
			</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<NotificationsTab onNotice={setNotice} />
		</div>
	);
}
