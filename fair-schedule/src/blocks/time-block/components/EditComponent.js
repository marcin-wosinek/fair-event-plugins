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

/**
 * Edit component for the Time Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps({
		className: 'time-block',
	});

	const { title, startHour, endHour } = attributes;

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
