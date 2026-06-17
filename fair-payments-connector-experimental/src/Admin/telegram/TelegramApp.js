/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import TelegramTab from './TelegramTab.js';

/**
 * Telegram settings page root component.
 *
 * @return {JSX.Element} The Telegram settings page
 */
export default function TelegramApp() {
	const [notice, setNotice] = useState(null);

	return (
		<div className="wrap">
			<h1>
				{__(
					'Telegram Notifications',
					'fair-payments-connector-experimental'
				)}
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

			<TelegramTab onNotice={setNotice} />
		</div>
	);
}
