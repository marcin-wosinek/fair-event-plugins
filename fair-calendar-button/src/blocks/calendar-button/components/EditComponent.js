/**
 * Edit component for the Calendar Button Block
 */

import {
	TextControl,
	PanelBody,
	ToggleControl,
	TextareaControl,
} from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Edit component for the Calendar Button Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps();

	const { start, end, allDay, description, location } = attributes;

	const TEMPLATE = [
		[
			'core/button',
			{
				text: __('Add to Calendar', 'fair-calendar-button'),
				url: '',
			},
		],
	];

	// Add wp-block-buttons class to support button width settings
	const innerBlocksProps = useInnerBlocksProps(
		{
			...blockProps,
			className: `${blockProps.className || ''} wp-block-buttons`.trim(),
		},
		{
			template: TEMPLATE,
			templateLock: false,
			allowedBlocks: ['core/button'],
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__(
						'Calendar Button Settings',
						'fair-calendar-button'
					)}
				>
					<TextControl
						label={__('Start Date/Time', 'fair-calendar-button')}
						value={start}
						onChange={(value) => setAttributes({ start: value })}
						type="datetime-local"
					/>
					<TextControl
						label={__('End Date/Time', 'fair-calendar-button')}
						value={end}
						onChange={(value) => setAttributes({ end: value })}
						type="datetime-local"
					/>
					<ToggleControl
						label={__('All Day Event', 'fair-calendar-button')}
						checked={allDay}
						onChange={(value) => setAttributes({ allDay: value })}
					/>
					<TextareaControl
						label={__('Description', 'fair-calendar-button')}
						value={description}
						onChange={(value) =>
							setAttributes({ description: value })
						}
					/>
					<TextControl
						label={__('Location', 'fair-calendar-button')}
						value={location}
						onChange={(value) => setAttributes({ location: value })}
					/>
				</PanelBody>
			</InspectorControls>
			<div {...innerBlocksProps} />
		</>
	);
}
