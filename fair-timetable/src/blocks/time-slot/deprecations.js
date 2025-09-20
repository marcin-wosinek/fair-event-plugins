/**
 * Block deprecations for the Time Slot Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';

/**
 * Version 3 deprecation (commit f19b5d0)
 * - Had title, startHour, endHour attributes
 * - Used RichText for title display
 * - Had complex height calculations based on duration
 * - Used context for hourHeight (fair-timetable namespace)
 * - Had fixed HTML structure with time range and title
 * - Used time-slot-block className
 */
const v1 = {
	attributes: {
		startHour: {
			type: 'string',
			default: '09:00',
		},
		endHour: {
			type: 'string',
			default: '10:00',
		},
	},

	isEligible(attributes) {
		// Force migration for debugging - check if old attributes exist
		return (
			attributes &&
			!!(attributes.title || attributes.startHour || attributes.endHour)
		);
	},

	migrate(attributes, innerBlocks) {
		// Convert old attributes and create inner blocks from old content
		const { title, startHour, endHour } = attributes;

		// Create inner blocks from old content
		const newInnerBlocks = [];

		// Add title as a heading block if it exists
		if (title) {
			newInnerBlocks.push(
				createBlock('core/heading', {
					content: title,
					level: 5,
					className: 'event-title',
				})
			);
		}

		// Add any existing inner blocks
		newInnerBlocks.push(...innerBlocks);

		// Return new attributes (preserve startTime/endTime for render.php) and inner blocks
		return [
			{
				startTime: startHour || '09:00',
				endTime: endHour || '10:00',
			},
			newInnerBlocks,
		];
	},

	save: () => {
		const blockProps = useBlockProps.save();
		const innerBlocksProps = useInnerBlocksProps.save({
			className: 'time-slot-content',
		});

		return (
			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		);
	},
};

export default [v1];
