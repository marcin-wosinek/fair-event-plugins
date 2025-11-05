/**
 * Edit component for the Schedule Accordion Block
 */

import { PanelBody } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { DateTimeControl } from 'fair-events-shared';

/**
 * Edit component for the Schedule Accordion Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const { autoCollapsedAfter } = attributes;

	const blockProps = useBlockProps({
		className: 'schedule-accordion-container',
	});

	// Allow any blocks that can be used at the top level of content
	const allowedBlocks = undefined; // undefined means all blocks are allowed

	// Default template with some example content
	const template = [
		[
			'core/heading',
			{
				level: 2,
				content: __('Schedule', 'fair-schedule-blocks'),
			},
		],
		[
			'core/paragraph',
			{
				content: __(
					'Replace this value with content you want to hide after some date'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'schedule-accordion-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__('Accordion Settings', 'fair-schedule-blocks')}
				>
					<DateTimeControl
						value={autoCollapsedAfter}
						onChange={(formatted) =>
							setAttributes({ autoCollapsedAfter: formatted })
						}
						label={__(
							'Auto-collapse after',
							'fair-schedule-blocks'
						)}
						help={__(
							'Hide content after this date and time.',
							'fair-schedule-blocks'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
