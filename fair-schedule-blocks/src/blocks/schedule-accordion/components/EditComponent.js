/**
 * Edit component for the Schedule Accordion Block
 */

import { PanelBody, RangeControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

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

	// Template for allowed inner blocks
	const allowedBlocks = [
		'core/heading',
		'core/paragraph',
		'core/list',
		'core/group',
		'core/details',
	];

	// Default template with some example content
	const template = [
		[
			'core/details',
			{
				summary: __('Schedule Item 1', 'fair-schedule-blocks'),
			},
			[
				[
					'core/paragraph',
					{
						content: __(
							'Schedule details go here...',
							'fair-schedule-blocks'
						),
					},
				],
			],
		],
		[
			'core/details',
			{
				summary: __('Schedule Item 2', 'fair-schedule-blocks'),
			},
			[
				[
					'core/paragraph',
					{
						content: __(
							'More schedule details...',
							'fair-schedule-blocks'
						),
					},
				],
			],
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
					<RangeControl
						label={__(
							'Auto-collapse after',
							'fair-schedule-blocks'
						)}
						value={autoCollapsedAfter}
						onChange={(value) =>
							setAttributes({ autoCollapsedAfter: value })
						}
						min={1}
						max={10}
						step={1}
						help={__(
							'Number of items to show expanded by default. Items beyond this number will be collapsed.',
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
