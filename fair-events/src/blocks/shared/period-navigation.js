/**
 * Shared period navigation for the public month and week calendars.
 *
 * Both Interactivity API stores bind this action to their previous/next
 * links. It enhances an eligible click into a client-side region refresh
 * through the WordPress router, keeps the loading flag in the clicked
 * instance's own context, and falls back to a full page load when the
 * router can't be loaded or the navigation fails.
 */

import {
	getContext,
	getElement,
	withSyncEvent,
} from '@wordpress/interactivity';

/**
 * Navigate to the clicked link's period.
 *
 * Loading is checked before click eligibility, so any click on a
 * navigation link is swallowed while that instance is still refreshing.
 *
 * @param {MouseEvent} event Click event on a period navigation link.
 */
export const navigatePeriod = withSyncEvent( function* ( event ) {
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
		const { actions } = yield import( '@wordpress/interactivity-router' );
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
} );
