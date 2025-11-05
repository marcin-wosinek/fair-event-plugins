import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { DateTimeControl } from 'fair-events-shared';

registerBlockType('fair-rsvp/rsvp-button', {
	edit: ({ attributes, setAttributes, context }) => {
		const { respondBefore } = attributes;
		const { postId, postType } = context || {};

		// Get event metadata if available
		const { eventStart, eventEnd, eventAllDay } = useSelect(
			(select) => {
				if (postType !== 'fair_event' || !postId) {
					return {
						eventStart: null,
						eventEnd: null,
						eventAllDay: false,
					};
				}

				const { getEditedPostAttribute } = select('core/editor');
				const meta = getEditedPostAttribute('meta') || {};

				return {
					eventStart: meta.event_start || '',
					eventEnd: meta.event_end || '',
					eventAllDay: meta.event_all_day || false,
				};
			},
			[postType, postId]
		);

		const blockProps = useBlockProps({
			className: 'fair-rsvp-button-editor',
		});

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('RSVP Settings', 'fair-rsvp')}>
						<DateTimeControl
							value={respondBefore}
							onChange={(formatted) =>
								setAttributes({ respondBefore: formatted })
							}
							label={__('RSVP Deadline', 'fair-rsvp')}
							help={__(
								'Set a deadline for RSVPs. After this date, the RSVP form will be closed.',
								'fair-rsvp'
							)}
							eventStart={eventStart}
							eventEnd={eventEnd}
							eventAllDay={eventAllDay}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<div className="fair-rsvp-preview">
						<p className="fair-rsvp-preview-label">
							{__('RSVP Form Preview', 'fair-rsvp')}
						</p>
						<div className="fair-rsvp-preview-options">
							<label className="fair-rsvp-preview-option">
								<input
									type="radio"
									name="preview"
									value="yes"
								/>
								<span>{__('Yes', 'fair-rsvp')}</span>
							</label>
							<label className="fair-rsvp-preview-option">
								<input
									type="radio"
									name="preview"
									value="maybe"
								/>
								<span>{__('Maybe', 'fair-rsvp')}</span>
							</label>
							<label className="fair-rsvp-preview-option">
								<input type="radio" name="preview" value="no" />
								<span>{__('No', 'fair-rsvp')}</span>
							</label>
						</div>
						<button
							type="button"
							className="fair-rsvp-preview-button"
							disabled
						>
							{__('Update RSVP', 'fair-rsvp')}
						</button>
						<p className="fair-rsvp-preview-note">
							{__(
								'Users will see their current RSVP status and can update it.',
								'fair-rsvp'
							)}
						</p>
					</div>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
