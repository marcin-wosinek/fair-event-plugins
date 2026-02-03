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
	registerBlockType,
	unregisterBlockType,
	getBlockType,
	createBlock,
} from '@wordpress/blocks';
import { select, subscribe } from '@wordpress/data';
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import domReady from '@wordpress/dom-ready';

let variationRegistered = false;

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
 * Register the calendar button variation
 *
 * @param {boolean} includeInserter Whether to include in block inserter
 */
function registerCalendarButtonVariation(includeInserter = true) {
	if (variationRegistered) {
		return;
	}

	const scope = includeInserter
		? ['inserter', 'transform', 'block']
		: ['transform', 'block'];

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
		scope,
	});

	variationRegistered = true;
}

/**
 * Update the variation's scope based on post type
 */
function updateVariationScope() {
	let lastPostType = null;
	let currentIncludesInserter = true;

	const checkAndUpdate = () => {
		const currentPostType = select('core/editor')?.getCurrentPostType();

		// Only process if post type has changed
		if (currentPostType === lastPostType) {
			return;
		}
		lastPostType = currentPostType;

		const shouldIncludeInserter = isEnabledPostType();

		if (shouldIncludeInserter !== currentIncludesInserter) {
			// Unregister and re-register with new scope
			unregisterBlockVariation('core/button', 'calendar-button');
			variationRegistered = false;
			registerCalendarButtonVariation(shouldIncludeInserter);
			currentIncludesInserter = shouldIncludeInserter;
		}
	};

	// Initial check
	checkAndUpdate();

	// Subscribe to store changes to handle post type changes
	subscribe(checkAndUpdate);
}

/**
 * Add variation when core/button is registered
 *
 * @param {Object} settings Block settings
 * @param {string} name     Block name
 * @return {Object} Modified settings
 */
function addCalendarButtonToButton(settings, name) {
	if (name !== 'core/button') {
		return settings;
	}

	// Add the variation directly to the block settings
	const existingVariations = settings.variations || [];

	const calendarVariation = {
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
		scope: ['inserter', 'transform', 'block'],
	};

	return {
		...settings,
		variations: [...existingVariations, calendarVariation],
	};
}

/**
 * Add transform to fair-calendar-button block by re-registering it
 */
function addTransformToFairCalendarButton() {
	const blockName = 'fair-calendar-button/calendar-button';
	const blockType = getBlockType(blockName);

	if (!blockType) {
		// Block not registered yet, try again later
		return false;
	}

	// Get existing settings
	const { name, ...settings } = blockType;

	// Check if we already added the transform
	const existingTo = settings.transforms?.to || [];
	const hasOurTransform = existingTo.some(
		(t) =>
			t.blocks?.includes('core/buttons') &&
			t.__fairEventsTransform === true
	);

	if (hasOurTransform) {
		return true;
	}

	// Create new transform to core/buttons (which contains core/button)
	const newTransform = {
		type: 'block',
		blocks: ['core/buttons'],
		__fairEventsTransform: true, // Marker to identify our transform
		transform: (attributes, innerBlocks) => {
			// The fair-calendar-button contains a core/button as inner block
			const buttonBlock = innerBlocks.find(
				(block) => block.name === 'core/button'
			);

			const calendarButton = createBlock('core/button', {
				...(buttonBlock?.attributes || {}),
				text:
					buttonBlock?.attributes?.text ||
					__('Add to Calendar', 'fair-events'),
				isCalendarButton: true,
			});

			// Wrap in core/buttons
			return createBlock('core/buttons', {}, [calendarButton]);
		},
	};

	// Unregister the block
	unregisterBlockType(blockName);

	// Re-register with the new transform
	registerBlockType(blockName, {
		...settings,
		transforms: {
			...settings.transforms,
			to: [...existingTo, newTransform],
		},
	});

	return true;
}

// Register the variation filter - this runs when blocks are registered
addFilter(
	'blocks.registerBlockType',
	'fair-events/calendar-button-variation',
	addCalendarButtonToButton
);

// Initialize after DOM is ready
domReady(() => {
	// Mark as registered since it was added via filter
	variationRegistered = true;

	// Add transform to fair-calendar-button block
	// Try immediately, then retry if not ready
	if (!addTransformToFairCalendarButton()) {
		// Retry after a short delay
		setTimeout(() => {
			if (!addTransformToFairCalendarButton()) {
				// Retry again after blocks are fully loaded
				setTimeout(addTransformToFairCalendarButton, 500);
			}
		}, 100);
	}

	// Update scope based on post type
	setTimeout(updateVariationScope, 100);
});
