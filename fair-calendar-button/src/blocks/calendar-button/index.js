/**
 * Calendar Button Block
 *
 * Block for adding calendar buttons to posts and pages.
 */

import { registerBlockType } from '@wordpress/blocks';
import { TextControl, PanelBody } from '@wordpress/components';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Register the block
 */
registerBlockType('fair-calendar-button/calendar-button', {
	/**
	 * Block edit function
	 *
	 * @param {Object}   props               - Block props
	 * @param {Object}   props.attributes    - Block attributes
	 * @param {Function} props.setAttributes - Function to set attributes
	 * @return {JSX.Element} The edit component
	 */
	edit: EditComponent,

	/**
	 * Block save function
	 *
	 * @param {Object} props            - Block props
	 * @param {Object} props.attributes - Block attributes
	 * @return {JSX.Element} The save component
	 */
	save: SaveComponent,
});

/**
 * Edit component for the Calendar Button Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps({
		className: 'calendar-button',
	});

	const { buttonText, eventTitle, eventDate, eventTime } = attributes;

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
						label={__('Button Text', 'fair-calendar-button')}
						value={buttonText}
						onChange={(value) =>
							setAttributes({ buttonText: value })
						}
					/>
					<TextControl
						label={__('Event Title', 'fair-calendar-button')}
						value={eventTitle}
						onChange={(value) =>
							setAttributes({ eventTitle: value })
						}
					/>
					<TextControl
						label={__('Event Date', 'fair-calendar-button')}
						value={eventDate}
						onChange={(value) =>
							setAttributes({ eventDate: value })
						}
						type="date"
					/>
					<TextControl
						label={__('Event Time', 'fair-calendar-button')}
						value={eventTime}
						onChange={(value) =>
							setAttributes({ eventTime: value })
						}
						type="time"
					/>
				</PanelBody>
			</InspectorControls>
			<div {...blockProps}>
				<button className="calendar-button-preview">
					{buttonText ||
						__('Add to Calendar', 'fair-calendar-button')}
				</button>
				{eventTitle && (
					<div className="event-details">
						<strong>{eventTitle}</strong>
						{eventDate && <div>{eventDate}</div>}
						{eventTime && <div>{eventTime}</div>}
					</div>
				)}
			</div>
		</>
	);
}

/**
 * Save component for the Calendar Button Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'calendar-button',
	});

	const { buttonText, eventTitle, eventDate, eventTime } = attributes;

	return (
		<div {...blockProps}>
			<button className="calendar-button-btn">
				{buttonText || __('Add to Calendar', 'fair-calendar-button')}
			</button>
			{eventTitle && (
				<div className="event-details">
					<strong>{eventTitle}</strong>
					{eventDate && <div>{eventDate}</div>}
					{eventTime && <div>{eventTime}</div>}
				</div>
			)}
		</div>
	);
}
