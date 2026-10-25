/**
 * Copy button of the operator weekly-summary page.
 *
 * The summary text is server-rendered into a read-only textarea, which stays
 * selectable for copying by hand. One model per copy section holds the copy
 * phase; the button, status message and selection render from it. When the
 * clipboard can't be written, the text is selected instead so the operator
 * can copy it with the device's own command.
 */

import './weekly-summary.css';

export const ROOT_SELECTOR = '.fair-weekly-summary__copy';

/**
 * Write text to the clipboard.
 *
 * @param {string} text Text to copy.
 * @return {Promise<void>} Resolves once copied; rejects when unavailable or denied.
 */
function writeClipboard( text ) {
	if ( ! window.navigator.clipboard?.writeText ) {
		return Promise.reject( new Error( 'Clipboard unavailable' ) );
	}
	return window.navigator.clipboard.writeText( text );
}

/**
 * Wire one copy section.
 *
 * @param {HTMLElement} root Copy section.
 * @return {{ copy: Function, model: Object }|null} Controls, or null when the markup is incomplete.
 */
export function setup( root ) {
	const button = root.querySelector( '.fair-weekly-summary__button' );
	const status = root.querySelector( '.fair-weekly-summary__status' );
	const textarea = root.querySelector( '.fair-weekly-summary__text' );
	if ( ! button || ! status || ! textarea ) {
		return null;
	}

	const model = {
		text: textarea.value,
		// 'idle' | 'copying' | 'copied' | 'failed'.
		phase: 'idle',
		messages: {
			copied: root.dataset.copiedMessage || '',
			failed: root.dataset.failedMessage || '',
		},
	};

	function render() {
		button.disabled = model.phase === 'copying';
		button.setAttribute(
			'aria-busy',
			model.phase === 'copying' ? 'true' : 'false'
		);
		status.textContent = model.messages[ model.phase ] || '';
		status.classList.toggle( 'is-error', model.phase === 'failed' );
		if ( model.phase === 'failed' ) {
			textarea.focus();
			textarea.select();
		}
	}

	async function copy() {
		if ( model.phase === 'copying' ) {
			return;
		}
		model.phase = 'copying';
		render();
		try {
			await writeClipboard( model.text );
			model.phase = 'copied';
		} catch {
			model.phase = 'failed';
		}
		render();
	}

	button.addEventListener( 'click', copy );
	render();

	return { copy, model };
}

function init() {
	document.querySelectorAll( ROOT_SELECTOR ).forEach( setup );
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', init );
} else {
	init();
}
