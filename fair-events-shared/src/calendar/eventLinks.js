/**
 * Event link classification for the admin month calendars.
 *
 * Event pills show one of four link-type variants (icon and colour), and the
 * pill's own link goes either to the event's management page or, when the
 * calendar has none, to the event's destination.
 *
 * @package FairEventsShared
 */

/**
 * Extract the event post ID from a uid string.
 * Post-linked events use format: fair_event_{id}_...@ or fair_event_{id}@
 * Returns null for standalone or non-post events.
 *
 * @param {string} uid Event uid.
 * @return {string|null} Event post ID or null.
 */
function getEventPostId( uid ) {
	const match = uid?.match( /^fair_event_(\d+)(?:_\d+)?@/ );
	return match ? match[ 1 ] : null;
}

/**
 * Extract event date ID from a uid string.
 * Post-linked: fair_event_{postId}_{eventDateId}@host
 * Standalone: standalone_{eventDateId}@host
 *
 * @param {string} uid Event uid.
 * @return {string|null} Event date ID or null.
 */
export function getEventDateId( uid ) {
	const standaloneMatch = uid?.match( /standalone_(\d+)@/ );
	if ( standaloneMatch ) {
		return standaloneMatch[ 1 ];
	}

	const postMatch = uid?.match( /^fair_event_\d+_(\d+)@/ );
	if ( postMatch ) {
		return postMatch[ 1 ];
	}

	return null;
}

/**
 * Get event link type from uid and url.
 *
 * @param {Object} event Event object with uid, url, and occurrence_type.
 * @return {string} 'instance', 'post', 'external', or 'unlinked'.
 */
export function getEventLinkType( event ) {
	if ( getEventPostId( event.uid ) ) {
		return event.occurrence_type === 'generated' ? 'instance' : 'post';
	}
	return event.url ? 'external' : 'unlinked';
}

/**
 * Get the dashicon class for a link type.
 *
 * @param {string} linkType 'post', 'instance', 'external', or 'unlinked'.
 * @return {string} Dashicon class name.
 */
export function getLinkTypeIcon( linkType ) {
	switch ( linkType ) {
		case 'instance':
			return 'dashicons-update';
		case 'external':
			return 'dashicons-admin-links';
		case 'unlinked':
			return 'dashicons-editor-unlink';
		case 'post':
		default:
			return 'dashicons-admin-post';
	}
}

/**
 * Build the URL an event pill links to.
 * With a manage-event URL, local events link to their management page.
 * Otherwise (and for external/source events) falls back to event.url.
 *
 * @param {Object}      event          Event object with uid and url.
 * @param {string|null} manageEventUrl Base URL for managing events, if any.
 * @return {string|null} URL or null.
 */
export function getEventUrl( event, manageEventUrl ) {
	const eventDateId = getEventDateId( event.uid );
	if ( eventDateId && manageEventUrl ) {
		return `${ manageEventUrl }&event_date_id=${ eventDateId }`;
	}

	return event.url || null;
}
