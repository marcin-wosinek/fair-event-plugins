/**
 * Edit component for the Time Block
 */

import { TextControl, PanelBody } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	RichText,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { differenceInMinutes, parse } from 'date-fns';

/**
 * Edit component for the Time Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, context }) {
	const { title, startHour, endHour } = attributes;
	const hourHeight = context?.['fair-schedule/hourHeight'] || 2.5; // Default to medium

	// Calculate block height based on duration
	const calculateBlockHeight = () => {
		if (!startHour || !endHour) return `${hourHeight}em`; // Default 1 hour

		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		const durationInMinutes = differenceInMinutes(endDate, startDate);
		const durationInHours = durationInMinutes / 60;

		return `${durationInHours * hourHeight}em`;
	};

	const blockProps = useBlockProps({
		className: 'time-block',
		style: {
			height: calculateBlockHeight(),
		},
	});

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Time Block Settings', 'fair-schedule')}>
					<TextControl
						label={__('Start Hour', 'fair-schedule')}
						value={startHour}
						onChange={(value) =>
							setAttributes({ startHour: value })
						}
						type="time"
					/>
					<TextControl
						label={__('End Hour', 'fair-schedule')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						type="time"
					/>
				</PanelBody>
			</InspectorControls>
			<div {...blockProps}>
				<div className="time-slot">
					<span className="time-range">
						{startHour} - {endHour}
					</span>
					<RichText
						tagName="h5"
						className="event-title"
						value={title}
						onChange={(value) => setAttributes({ title: value })}
						placeholder={__('Event title', 'fair-schedule')}
					/>
				</div>
			</div>
		</>
	);
}
