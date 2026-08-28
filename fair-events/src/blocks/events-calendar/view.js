/**
 * Events Calendar View - Interactivity API store
 *
 * Handles the subscribe dropdown: opening/closing, the "Copy link" button
 * for the subscribe fallback URL, and dismissal via outside click/Escape.
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

store( 'fair-events/calendar-subscribe', {
	state: {
		get isLoading() {
			return !! getContext().isLoading;
		},
		get label() {
			const context = getContext();
			return context.copied ? context.copiedLabel : context.copyLabel;
		},
		get isOpen() {
			const context = getContext();
			return !! context.isOpen;
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
		toggle() {
			const context = getContext();
			context.isOpen = ! context.isOpen;
		},
		close() {
			const context = getContext();
			context.isOpen = false;
		},
		handleOutsideClick( event ) {
			const context = getContext();
			if ( ! context.isOpen ) {
				return;
			}

			const { ref } = getElement();
			if ( ref.contains( event.target ) ) {
				return;
			}

			context.isOpen = false;
		},
		handleKeydown( event ) {
			if ( event.key !== 'Escape' ) {
				return;
			}

			const context = getContext();
			context.isOpen = false;
		},
		*copy() {
			const context = getContext();
			const feedUrl = context.feedUrl;

			if ( ! feedUrl ) {
				return;
			}

			let success = false;

			if ( navigator.clipboard ) {
				try {
					yield navigator.clipboard.writeText( feedUrl );
					success = true;
				} catch ( e ) {
					success = fallbackCopy( feedUrl );
				}
			} else {
				success = fallbackCopy( feedUrl );
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
