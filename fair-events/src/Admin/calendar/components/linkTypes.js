/**
 * Event Link Type Legend Metadata
 *
 * Labels for the four link-type variants shown as event pills on the shared
 * calendar grid, with their icons from fair-events-shared.
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import { getLinkTypeIcon } from 'fair-events-shared/src/calendar/eventLinks.js';

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
			icon: getLinkTypeIcon( 'post' ),
			label: __( 'Public page', 'fair-events' ),
		},
		{
			type: 'instance',
			icon: getLinkTypeIcon( 'instance' ),
			label: __( 'Series occurrence', 'fair-events' ),
		},
		{
			type: 'external',
			icon: getLinkTypeIcon( 'external' ),
			label: __( 'External page', 'fair-events' ),
		},
		{
			type: 'unlinked',
			icon: getLinkTypeIcon( 'unlinked' ),
			label: __( 'No public page yet', 'fair-events' ),
		},
	];
}
