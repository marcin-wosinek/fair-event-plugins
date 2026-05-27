/**
 * Block deprecations for the Timetable Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

console.log('timetable depre...');

/**
 * Version 0.2.0 deprecation
 * - Had verticalAlignment attribute
 * - Used single div structure with merged props
 * - Had dynamic vertical alignment classes
 */
const v1 = {
	attributes: {
		startHour: {
			type: 'string',
			default: '09:00',
		},
		endHour: {
			type: 'string',
			default: '17:00',
		},
		length: {
			type: 'number',
		},
		hourHeight: {
			type: 'number',
			default: 4,
		},
	},

	migrate(attributes) {
		console.log('timetable migrate!', attributes);

		// Convert old attributes to new format
		const {
			verticalAlignment,
			startHour,
			endHour,
			length,
			hourHeight,
			...otherAttributes
		} = attributes;

		// Return migrated attributes with renamed time attributes
		return {
			...otherAttributes,
			startTime: startHour || '09:00',
			endTime: endHour || '17:00',
			hourHeight: hourHeight || 4,
		};
	},

	isEligible(attributes) {
		console.log('is eligi, timetable', attributes);

		// Force migration for debugging - check if old attributes exist
		return (
			attributes &&
			!!(attributes.startHour || attributes.endHour || attributes.length)
		);
	},

	save: ({ attributes }) => {
		console.log('timetable save', attributes);

		const { verticalAlignment } = attributes;

		const blockProps = useBlockProps.save({
			className: `timetable-container ${
				verticalAlignment
					? `is-vertically-aligned-${verticalAlignment}`
					: ''
			}`,
		});

		const innerBlocksProps = useInnerBlocksProps.save({
			className: 'timetable-content',
		});

		return (
			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		);
	},
};

export default [v1];
