/**
 * Calendar Button - Block Variation of core/button
 *
 * Registers a block variation for core/button that adds calendar functionality.
 * The button reads event data from the fair_event_dates table (via PHP render filter)
 * and is only available on posts with enabled event post types.
 */

import {
	registerBlockVariation,
	unregisterBlockVariation,
} from '@wordpress/blocks';
import { select, subscribe } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import domReady from '@wordpress/dom-ready';

/**
 * Register the calendar button variation
 */
function registerCalendarButtonVariation() {
	registerBlockVariation('core/button', {
		name: 'calendar-button',
		title: __('Add to Calendar', 'fair-events'),
		description: __(
			'Button to add this event to a calendar',
			'fair-events'
		),
		icon: 'calendar-alt',
		attributes: {
			isCalendarButton: true,
			text: __('Add to Calendar', 'fair-events'),
		},
		isActive: (blockAttributes) =>
			blockAttributes.isCalendarButton === true,
		scope: ['inserter', 'transform'],
	});
}

/**
 * Unregister the calendar button variation
 */
function unregisterCalendarButtonVariation() {
	unregisterBlockVariation('core/button', 'calendar-button');
}

/**
 * Check if current post type is enabled for events
 *
 * @return {boolean} True if current post type is enabled
 */
function isEnabledPostType() {
	const currentPostType = select('core/editor')?.getCurrentPostType();
	const enabledTypes = window.fairEventsData?.enabledPostTypes || [
		'fair_event',
	];
	return enabledTypes.includes(currentPostType);
}

/**
 * Initialize the block variation based on post type
 */
function initializeVariation() {
	let isRegistered = false;
	let lastPostType = null;

	const checkAndRegister = () => {
		const currentPostType = select('core/editor')?.getCurrentPostType();

		// Only process if post type has changed
		if (currentPostType === lastPostType) {
			return;
		}
		lastPostType = currentPostType;

		const shouldBeRegistered = isEnabledPostType();

		if (shouldBeRegistered && !isRegistered) {
			registerCalendarButtonVariation();
			isRegistered = true;
		} else if (!shouldBeRegistered && isRegistered) {
			unregisterCalendarButtonVariation();
			isRegistered = false;
		}
	};

	// Initial check
	checkAndRegister();

	// Subscribe to store changes to handle post type changes
	subscribe(checkAndRegister);
}

// Initialize when DOM is ready
domReady(() => {
	// Wait a bit for the editor to be fully initialized
	setTimeout(initializeVariation, 100);
});
