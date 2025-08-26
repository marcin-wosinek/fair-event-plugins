/**
 * Edit component for the Timetable Block
 */

import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	BlockControls,
	BlockVerticalAlignmentToolbar,
} from '@wordpress/block-editor';
import { PanelBody, RangeControl } from '@wordpress/components';
import { useSelect } from '@wordpress/data';

/**
 * Edit component for the Timetable Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, clientId }) {
	const { verticalAlignment } = attributes;

	// Get inner blocks count
	const { innerBlockCount } = useSelect(
		(select) => ({
			innerBlockCount:
				select('core/block-editor').getBlocks(clientId).length,
		}),
		[clientId]
	);

	const blockProps = useBlockProps({
		className: `timetable-container ${verticalAlignment ? `is-vertically-aligned-${verticalAlignment}` : ''}`,
	});

	// Template with default timetable columns
	const template = [
		[
			'fair-timetable/timetable-column',
			{
				columnType: 'day',
				startHour: '09:00',
				endHour: '18:00',
				hourHeight: 2.5,
			},
		],
		[
			'fair-timetable/timetable-column',
			{
				columnType: 'day',
				startHour: '09:00',
				endHour: '18:00',
				hourHeight: 2.5,
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(blockProps, {
		allowedBlocks: ['fair-timetable/timetable-column'],
		template: innerBlockCount === 0 ? template : undefined,
		templateLock: false,
		orientation: 'horizontal',
		renderAppender: false,
	});

	return (
		<>
			<BlockControls>
				<BlockVerticalAlignmentToolbar
					onChange={(value) =>
						setAttributes({ verticalAlignment: value })
					}
					value={verticalAlignment}
				/>
			</BlockControls>

			<InspectorControls>
				<PanelBody title={__('Timetable Settings', 'fair-timetable')}>
					<p>
						{__('This timetable contains ', 'fair-timetable')}
						<strong>{innerBlockCount}</strong>
						{innerBlockCount === 1
							? __(' column.', 'fair-timetable')
							: __(' columns.', 'fair-timetable')}
					</p>
					<p>
						{__(
							'Add or remove timetable columns using the block inserter.',
							'fair-timetable'
						)}
					</p>
				</PanelBody>
			</InspectorControls>

			<div {...innerBlocksProps} />
		</>
	);
}
