/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Settings App Component
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	return (
		<div className="wrap">
			<h1>{__('Fair Events Settings', 'fair-events')}</h1>
		</div>
	);
}
