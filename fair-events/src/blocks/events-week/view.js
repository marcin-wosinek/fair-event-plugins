/**
 * Events Week View - Interactivity API store
 *
 * Handles the "Copy summary" button click.
 */

import {
	store,
	getContext,
	getElement,
	withSyncEvent,
} from '@wordpress/interactivity';

/**
 * Copy text to the clipboard via the throwaway-textarea + execCommand
 * trick, for browsers/contexts (plain HTTP, non-localhost) where the
 * modern Clipboard API isn't available.
 *
 * @param {string} text Text to copy.
 * @return {boolean} Whether the copy succeeded.
 */
function fallbackCopy( text ) {
	const textarea = document.createElement( 'textarea' );
	textarea.value = text;
	textarea.style.position = 'fixed';
	textarea.style.opacity = '0';
	document.body.appendChild( textarea );
	textarea.focus();
	textarea.select();

	let success = false;
	try {
		success = document.execCommand( 'copy' );
	} finally {
		document.body.removeChild( textarea );
	}

	return success;
}

store( 'fair-events/copy-summary', {
	state: {
		get isLoading() {
			return !! getContext().isLoading;
		},
		get label() {
			const context = getContext();
			return context.copied ? context.copiedLabel : context.copyLabel;
		},
	},
	actions: {
		navigatePeriod: withSyncEvent( function* ( event ) {
			const context = getContext();
			const { ref } = getElement();
			const url = ref.href;

			if ( context.isLoading ) {
				event.preventDefault();
				return;
			}

			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey ||
				ref.target ||
				ref.hasAttribute( 'download' )
			) {
				return;
			}

			event.preventDefault();
			context.isLoading = true;

			try {
				const routerUrl = new URL( url );
				routerUrl.hash = '';
				const { actions } = yield import(
					'@wordpress/interactivity-router'
				);
				yield actions.navigate( routerUrl.href );
				document
					.getElementById( new URL( url ).hash.slice( 1 ) )
					?.querySelector( '.navigation-title' )
					?.focus( { preventScroll: true } );
			} catch ( error ) {
				window.location.assign( url );
			} finally {
				context.isLoading = false;
			}
		} ),
		*copy() {
			const context = getContext();
			const { ref } = getElement();
			const summary = ref.dataset.summary;

			if ( ! summary ) {
				return;
			}

			let success = false;

			if ( navigator.clipboard ) {
				try {
					yield navigator.clipboard.writeText( summary );
					success = true;
				} catch ( e ) {
					success = fallbackCopy( summary );
				}
			} else {
				success = fallbackCopy( summary );
			}

			if ( ! success ) {
				return;
			}

			context.copied = true;
			setTimeout( () => {
				context.copied = false;
			}, 2000 );
		},
	},
} );
