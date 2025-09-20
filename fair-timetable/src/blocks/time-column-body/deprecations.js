/**
 * Block deprecations for the Time Column Body Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Version 0.1.0 deprecation
 * - Had 'time-column-body-container' className in blockProps
 * - Used double container structure before cleanup
 * - Removed in commit 131efac "Remove the double container on timetable"
 */
const v1 = {
	attributes: {},

	migrate(attributes) {
		// No attribute changes needed, just structural cleanup
		return attributes;
	},

	save: () => {
		const blockProps = useBlockProps.save({
			className: 'time-column-body-container',
		});

		const innerBlocksProps = useInnerBlocksProps.save({
			className: 'time-column-body-content',
		});

		return (
			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		);
	},
};

export default [v1];
