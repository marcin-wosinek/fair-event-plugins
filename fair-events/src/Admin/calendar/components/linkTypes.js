/**
 * Event Link Type Metadata
 *
 * Shared source of truth for the four link-type variants shown as event
 * pills on the calendar grid (DayCell) and explained in the legend
 * (CalendarLegend).
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';

/**
 * Get the dashicon class for a link type.
 *
 * @param {string} linkType 'post', 'instance', 'external', or 'unlinked'.
 * @return {string} Dashicon class name.
 */
export function getLinkTypeIcon(linkType) {
	switch (linkType) {
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
 * Get the list of link-type variants with their icon and user-facing label,
 * in the order they should appear in the legend.
 *
 * @return {Array<{type: string, icon: string, label: string}>} Variants.
 */
export function getLinkTypeVariants() {
	return [
		{
			type: 'post',
			icon: getLinkTypeIcon('post'),
			label: __('Public page', 'fair-events'),
		},
		{
			type: 'instance',
			icon: getLinkTypeIcon('instance'),
			label: __('Series occurrence', 'fair-events'),
		},
		{
			type: 'external',
			icon: getLinkTypeIcon('external'),
			label: __('External page', 'fair-events'),
		},
		{
			type: 'unlinked',
			icon: getLinkTypeIcon('unlinked'),
			label: __('No public page yet', 'fair-events'),
		},
	];
}
