/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import FeaturesTab from './FeaturesTab.js';

/**
 * Settings App Component for Fair Events Experimental.
 *
 * Renders just the features tab — there are no general settings for this plugin.
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	const [notice, setNotice] = useState(null);

	return (
		<div className="wrap fair-events-experimental-settings">
			<h1>
				{__(
					'Fair Events Experimental Settings',
					'fair-events-experimental'
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

			<FeaturesTab onNotice={setNotice} />
		</div>
	);
}
