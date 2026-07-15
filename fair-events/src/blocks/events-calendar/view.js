/**
 * Events Calendar View - Interactivity API store
 *
 * Handles the "Copy link" button click for the subscribe fallback URL.
 */

import { store, getContext } from '@wordpress/interactivity';

/**
 * Copy text to the clipboard via the throwaway-textarea + execCommand
 * trick, for browsers/contexts (plain HTTP, non-localhost) where the
 * modern Clipboard API isn't available.
 *
 * @param {string} text Text to copy.
 * @return {boolean} Whether the copy succeeded.
 */
function fallbackCopy(text) {
	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.appendChild(textarea);
	textarea.focus();
	textarea.select();

	let success = false;
	try {
		success = document.execCommand('copy');
	} finally {
		document.body.removeChild(textarea);
	}

	return success;
}

store('fair-events/calendar-subscribe', {
	state: {
		get label() {
			const context = getContext();
			return context.copied ? context.copiedLabel : context.copyLabel;
		},
	},
	actions: {
		*copy() {
			const context = getContext();
			const feedUrl = context.feedUrl;

			if (!feedUrl) {
				return;
			}

			let success = false;

			if (navigator.clipboard) {
				try {
					yield navigator.clipboard.writeText(feedUrl);
					success = true;
				} catch (e) {
					success = fallbackCopy(feedUrl);
				}
			} else {
				success = fallbackCopy(feedUrl);
			}

			if (!success) {
				return;
			}

			context.copied = true;
			setTimeout(() => {
				context.copied = false;
			}, 2000);
		},
	},
});
