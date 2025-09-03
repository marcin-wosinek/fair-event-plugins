/**
 * Edit component for the Time Column Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Edit component for the Time Column Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent() {
	const blockProps = useBlockProps({
		className: 'time-column-container',
	});

	// Locked template with H2 and time-column-body
	const template = [
		[
			'core/heading',
			{
				level: 2,
				content: __('Column Title', 'fair-timetable'),
				placeholder: __('Enter column title...', 'fair-timetable'),
			},
		],
		['fair-timetable/time-column-body'],
	];

	// Template is locked - users cannot add/remove/reorder blocks
	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'time-column-content',
		},
		{
			template,
			templateLock: 'all', // Completely locked template
		}
	);

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
