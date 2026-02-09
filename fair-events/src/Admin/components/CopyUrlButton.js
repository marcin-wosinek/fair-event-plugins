/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Button, Tooltip } from '@wordpress/components';
import { copy, check } from '@wordpress/icons';

/**
 * A reusable button that copies a URL to the clipboard.
 *
 * @param {Object}   props           Props
 * @param {string}   props.url       The URL to copy
 * @param {string}   props.label     Button label text
 * @param {string}   props.tooltip   Tooltip text
 * @param {string}   props.variant   Button variant (default: 'secondary')
 * @param {string}   props.size      Button size (default: 'small')
 * @param {Function} props.onSuccess Callback on successful copy
 * @param {Function} props.onError   Callback on failed copy
 * @return {JSX.Element} The copy URL button
 */
export default function CopyUrlButton({
	url,
	label = __('Copy URL', 'fair-events'),
	tooltip = __('Copy URL to clipboard', 'fair-events'),
	variant = 'secondary',
	size = 'small',
	onSuccess,
	onError,
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
			if (onSuccess) {
				onSuccess();
			}
		} catch (err) {
			if (onError) {
				onError();
			}
		}
	};

	return (
		<Tooltip text={tooltip}>
			<Button
				variant={variant}
				size={size}
				icon={copied ? check : copy}
				onClick={handleCopy}
			>
				{copied ? __('Copied!', 'fair-events') : label}
			</Button>
		</Tooltip>
	);
}
