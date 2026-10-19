/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

/**
 * Internal dependencies — import store to ensure it is registered
 */
import { STORE_NAME } from '../../../Admin/event-meta-box/store.js';
import { formatEventTiming } from '../../../Admin/components/eventTiming.js';

/**
 * Edit component for Event Dates block
 *
 * @param {Object} props            - Component props
 * @param {Object} props.context    - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { context } ) {
	const blockProps = useBlockProps();
	const { postId, postType } = context;

	// Check if we're in an event post context
	const isEventContext = postType === 'fair_event' && postId;

	// The event's timing from the custom store, summarized with only the
	// times it has: a missing time is never shown as midnight.
	const eventData = useSelect(
		( select ) =>
			isEventContext ? select( STORE_NAME ).getEventData() : null,
		[ isEventContext, postId ]
	);

	const formattedDate = isEventContext ? formatEventTiming( eventData ) : '';

	return (
		<div { ...blockProps }>
			{ isEventContext ? (
				<div className="event-dates">
					{ formattedDate || (
						<em style={ { color: '#999' } }>
							{ __(
								'No event dates set. Add dates in the Event Details panel.',
								'fair-events'
							) }
						</em>
					) }
				</div>
			) : (
				<p style={ { fontStyle: 'italic', color: '#999' } }>
					{ __(
						'Event Dates block: Only displays in event post context.',
						'fair-events'
					) }
				</p>
			) }
		</div>
	);
}
