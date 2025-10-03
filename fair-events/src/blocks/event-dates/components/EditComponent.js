/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Edit component for Event Dates block
 *
 * @param {Object} props            - Component props
 * @param {Object} props.context    - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ context }) {
	const blockProps = useBlockProps();
	const { postId, postType } = context;

	// Check if we're in an event post context
	const isEventContext = postType === 'fair_event' && postId;

	return (
		<div {...blockProps}>
			<div className="event-dates-placeholder">
				{isEventContext ? (
					<>
						<p>
							<strong>{__('Event Dates', 'fair-events')}</strong>
						</p>
						<p>
							{__(
								'Start and end dates will appear here on the frontend.',
								'fair-events'
							)}
						</p>
						<p>
							<em>
								{__(
									'Dates are formatted using WordPress date/time settings.',
									'fair-events'
								)}
							</em>
						</p>
					</>
				) : (
					<p style={{ fontStyle: 'italic', color: '#999' }}>
						{__(
							'Event Dates block: Only displays in event post context.',
							'fair-events'
						)}
					</p>
				)}
			</div>
		</div>
	);
}
