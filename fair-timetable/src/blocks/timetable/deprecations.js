/**
 * Block deprecations for the Timetable Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Version 0.2.0 deprecation
 * - Had verticalAlignment attribute
 * - Used single div structure with merged props
 * - Had dynamic vertical alignment classes
 */
const v1 = {
	attributes: {
		verticalAlignment: {
			type: 'string',
		},
		startTime: {
			type: 'string',
			default: '09:00',
		},
		endTime: {
			type: 'string',
			default: '17:00',
		},
		hourHeight: {
			type: 'number',
			default: 4,
		},
	},

	migrate(attributes) {
		// Remove verticalAlignment attribute, keep other attributes
		const { verticalAlignment, ...newAttributes } = attributes;

		// Return migrated attributes without verticalAlignment
		return newAttributes;
	},

	save: ({ attributes }) => {
		const { verticalAlignment } = attributes;

		const blockProps = useBlockProps.save({
			className: `timetable-container ${
				verticalAlignment
					? `is-vertically-aligned-${verticalAlignment}`
					: ''
			}`,
		});

		const innerBlocksProps = useInnerBlocksProps.save(blockProps);

		return <div {...innerBlocksProps} />;
	},
};

export default [v1];
