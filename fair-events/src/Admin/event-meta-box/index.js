/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import EventMetaBox from './EventMetaBox.js';

domReady(() => {
	const container = document.getElementById('fair-events-meta-box-root');
	if (!container) {
		return;
	}

	const config = window.fairEventsMetaBox || {};
	const { postId, postType, eventDateId, manageEventUrl } = config;

	const root = createRoot(container);
	root.render(
		<EventMetaBox
			postId={postId}
			postType={postType}
			eventDateId={eventDateId}
			manageEventUrl={manageEventUrl}
		/>
	);
});
