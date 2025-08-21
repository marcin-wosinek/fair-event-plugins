/**
 * Edit component for the Schedule Column Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { addHours, format, parse } from 'date-fns';

/**
 * Edit component for the Schedule Column Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, clientId }) {
	const blockProps = useBlockProps({
		className: 'schedule-column',
	});

	const { columnTitle, columnType, startHour, endHour } = attributes;

	// Get inner blocks to calculate next start time
	const innerBlocks = useSelect(
		(select) => {
			return select(blockEditorStore).getBlocks(clientId);
		},
		[clientId]
	);

	// Calculate the next start time based on the last time-block's end time
	const getNextStartTime = () => {
		if (innerBlocks.length === 0) {
			return '09:00'; // Default start time for first block
		}

		const lastBlock = innerBlocks[innerBlocks.length - 1];
		if (
			lastBlock.name === 'fair-schedule/time-block' &&
			lastBlock.attributes.endHour
		) {
			return lastBlock.attributes.endHour;
		}

		return '09:00';
	};

	// Calculate end time (1 hour after start time) using date-fns
	const getNextEndTime = () => {
		const startTime = getNextStartTime();
		const startDate = parse(startTime, 'HH:mm', new Date());
		const endDate = addHours(startDate, 1);
		return format(endDate, 'HH:mm');
	};

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
			__experimentalDefaultBlock: {
				name: 'fair-schedule/time-block',
				attributes: {
					title: 'New Event',
					startHour: getNextStartTime(),
					endHour: getNextEndTime(),
				},
			},
			__experimentalDirectInsert: true,
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
				<PanelBody title={__('Time Settings', 'fair-schedule')}>
					<TextControl
						label={__('Start Hour', 'fair-schedule')}
						value={startHour}
						onChange={(value) =>
							setAttributes({ startHour: value })
						}
						placeholder="09:00"
						help={__(
							'Column start time in HH:MM format',
							'fair-schedule'
						)}
					/>
					<TextControl
						label={__('End Hour', 'fair-schedule')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						placeholder="18:00"
						help={__(
							'Column end time in HH:MM format',
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
