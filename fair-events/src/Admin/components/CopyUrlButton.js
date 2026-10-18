/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Shared dependencies
 */
import SharedCopyUrlButton from 'fair-events-shared/src/CopyUrlButton.js';

/**
 * Copy URL button with this plugin's translated default text.
 *
 * @param {Object} props             Props forwarded to the shared CopyUrlButton
 * @param {string} props.label       Button label text
 * @param {string} props.tooltip     Tooltip text
 * @param {string} props.copiedLabel Label shown after a successful copy
 * @return {JSX.Element} The copy URL button
 */
export default function CopyUrlButton( {
	label = __( 'Copy URL', 'fair-events' ),
	tooltip = __( 'Copy URL to clipboard', 'fair-events' ),
	copiedLabel = __( 'Copied!', 'fair-events' ),
	...props
} ) {
	return (
		<SharedCopyUrlButton
			{ ...props }
			label={ label }
			tooltip={ tooltip }
			copiedLabel={ copiedLabel }
		/>
	);
}
