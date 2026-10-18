/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { Button, Tooltip } from '@wordpress/components';
import { copy, check } from '@wordpress/icons';

const COPIED_RESET_MS = 2000;

/**
 * CopyUrlButton Component
 *
 * Copies a URL to the clipboard and briefly confirms success. Text is passed
 * in by each plugin's adapter so strings stay in that plugin's text domain.
 *
 * @param {Object}   props
 * @param {string}   props.url          - The URL to copy
 * @param {string}   props.label        - Button label text
 * @param {string}   props.tooltip      - Tooltip text
 * @param {string}   props.copiedLabel  - Label shown after a successful copy
 * @param {string}   props.variant      - Button variant (default: 'secondary')
 * @param {string}   props.size         - Button size (default: 'small')
 * @param {Function} props.onSuccess    - Callback on successful copy (optional)
 * @param {Function} props.onError      - Callback on failed copy (optional)
 * @return {JSX.Element} The copy URL button
 */
export default function CopyUrlButton( {
	url,
	label,
	tooltip,
	copiedLabel,
	variant = 'secondary',
	size = 'small',
	onSuccess,
	onError,
} ) {
	const [ copied, setCopied ] = useState( false );
	const timerRef = useRef( null );

	const clearTimer = () => {
		if ( timerRef.current ) {
			clearTimeout( timerRef.current );
			timerRef.current = null;
		}
	};

	useEffect( () => clearTimer, [] );

	const handleCopy = async () => {
		try {
			if ( ! navigator.clipboard?.writeText ) {
				throw new Error( 'Clipboard API unavailable' );
			}
			await navigator.clipboard.writeText( url );
		} catch ( err ) {
			clearTimer();
			setCopied( false );
			if ( onError ) {
				onError( err );
			}
			return;
		}

		clearTimer();
		setCopied( true );
		timerRef.current = setTimeout( () => {
			timerRef.current = null;
			setCopied( false );
		}, COPIED_RESET_MS );
		if ( onSuccess ) {
			onSuccess();
		}
	};

	return (
		<Tooltip text={ tooltip }>
			<Button
				variant={ variant }
				size={ size }
				icon={ copied ? check : copy }
				onClick={ handleCopy }
			>
				{ copied ? copiedLabel : label }
			</Button>
		</Tooltip>
	);
}
