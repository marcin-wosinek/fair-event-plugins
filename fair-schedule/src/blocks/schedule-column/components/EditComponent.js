/**
 * Edit component for the Schedule Column Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Edit component for the Schedule Column Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps({
		className: 'schedule-column',
	});

	const { columnTitle, columnType } = attributes;

	// Template for allowed inner blocks
	const allowedBlocks = ['fair-schedule/time-block'];

	// Default template with a sample time block
	const template = [
		[
			'fair-schedule/time-block',
			{
				title: 'Sample Event',
				startHour: '09:00',
				endHour: '10:00',
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'schedule-column-content',
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
				<PanelBody title={__('Column Settings', 'fair-schedule')}>
					<TextControl
						label={__('Column Title', 'fair-schedule')}
						value={columnTitle}
						onChange={(value) =>
							setAttributes({ columnTitle: value })
						}
						placeholder={__(
							'e.g. Main Stage, Day 1, Room A',
							'fair-schedule'
						)}
					/>
					<SelectControl
						label={__('Column Type', 'fair-schedule')}
						value={columnType}
						options={[
							{
								label: __('Day', 'fair-schedule'),
								value: 'day',
							},
							{
								label: __('Place', 'fair-schedule'),
								value: 'place',
							},
						]}
						onChange={(value) =>
							setAttributes({ columnType: value })
						}
						help={__(
							'Choose how this column represents your schedule organization',
							'fair-schedule'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div className="schedule-column-header">
					{columnTitle ? (
						<h3 className="schedule-column-title">{columnTitle}</h3>
					) : (
						<h3 className="schedule-column-title placeholder">
							{__('Column Title', 'fair-schedule')}
						</h3>
					)}
				</div>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
