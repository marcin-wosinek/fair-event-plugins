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
import { PanelBody, TextControl, SelectControl } from '@wordpress/components';
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
	const { verticalAlignment, startHour, endHour, hourHeight } = attributes;

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
			},
		],
		[
			'fair-timetable/timetable-column',
			{
				columnType: 'day',
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
				<PanelBody title={__('Time Settings', 'fair-timetable')}>
					<TextControl
						label={__('Start Hour', 'fair-timetable')}
						value={startHour}
						onChange={(value) =>
							setAttributes({ startHour: value })
						}
						type="time"
						help={__(
							'Start time for all columns in this timetable',
							'fair-timetable'
						)}
					/>
					<TextControl
						label={__('End Hour', 'fair-timetable')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						type="time"
						help={__(
							'End time for all columns in this timetable',
							'fair-timetable'
						)}
					/>
					<SelectControl
						label={__('Hour Height', 'fair-timetable')}
						value={hourHeight}
						options={[
							{
								label: __('Small', 'fair-timetable'),
								value: 1.5,
							},
							{
								label: __('Medium', 'fair-timetable'),
								value: 2.5,
							},
							{
								label: __('Large', 'fair-timetable'),
								value: 3.5,
							},
						]}
						onChange={(value) =>
							setAttributes({ hourHeight: parseFloat(value) })
						}
						help={__(
							'Visual height multiplier for each hour in all columns',
							'fair-timetable'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...innerBlocksProps} />
		</>
	);
}
