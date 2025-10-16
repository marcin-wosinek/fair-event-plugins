import { PanelBody } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import DateTimeControl from '../../../components/DateTimeControl.js';

export default function EditComponent({ attributes, setAttributes, context }) {
	const { hideAfter } = attributes;
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
		className: 'show-until-container',
	});

	const allowedBlocks = undefined;

	const template = [
		[
			'core/paragraph',
			{
				content: __(
					'This content will be hidden after the date you set.',
					'fair-schedule-blocks'
				),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'show-until-content',
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
				<PanelBody
					title={__('Visibility Settings', 'fair-schedule-blocks')}
				>
					<DateTimeControl
						value={hideAfter}
						onChange={(formatted) =>
							setAttributes({ hideAfter: formatted })
						}
						label={__(
							'Hide After Date/Time',
							'fair-schedule-blocks'
						)}
						help={__(
							'Content will be hidden after this date and time.',
							'fair-schedule-blocks'
						)}
						eventStart={eventStart}
						eventEnd={eventEnd}
						eventAllDay={eventAllDay}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
