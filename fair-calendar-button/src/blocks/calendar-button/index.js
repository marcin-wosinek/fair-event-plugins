/**
 * Calendar Button Block
 *
 * Block for adding calendar buttons to posts and pages.
 */

import { registerBlockType } from '@wordpress/blocks';
import {
	TextControl,
	PanelBody,
	ToggleControl,
	TextareaControl,
} from '@wordpress/components';
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

	const { buttonText, start, end, allDay, description, location } =
		attributes;

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
			<div {...blockProps}>
				<button className="calendar-button-preview">
					{buttonText ||
						__('Add to Calendar', 'fair-calendar-button')}
				</button>
				{(start || end || location || allDay) && (
					<div className="event-details">
						{start && <div>{start}</div>}
						{end && (
							<div>
								{__('Until:', 'fair-calendar-button')} {end}
							</div>
						)}
						{location && (
							<div>
								{__('Location:', 'fair-calendar-button')}{' '}
								{location}
							</div>
						)}
						{allDay && (
							<div>
								{__('All Day Event', 'fair-calendar-button')}
							</div>
						)}
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

	const { buttonText, start, end, allDay, description, location } =
		attributes;

	return (
		<div {...blockProps}>
			<button className="calendar-button-btn">
				{buttonText || __('Add to Calendar', 'fair-calendar-button')}
			</button>
			{(start || end || location || allDay) && (
				<div className="event-details">
					{start && <div>{start}</div>}
					{end && (
						<div>
							{__('Until:', 'fair-calendar-button')} {end}
						</div>
					)}
					{location && (
						<div>
							{__('Location:', 'fair-calendar-button')} {location}
						</div>
					)}
					{allDay && (
						<div>{__('All Day Event', 'fair-calendar-button')}</div>
					)}
				</div>
			)}
		</div>
	);
}
