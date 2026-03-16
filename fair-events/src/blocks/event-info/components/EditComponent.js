/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';

/**
 * Internal dependencies — import store to ensure it is registered
 */
import { STORE_NAME } from '../../../Admin/event-meta-box/store.js';

/**
 * Edit component for Event Info block
 *
 * @param {Object} props            - Component props
 * @param {Object} props.attributes - Block attributes
 * @param {Object} props.context    - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, context }) {
	const blockProps = useBlockProps();
	const { postId, postType } = context;

	const eventData = useSelect(
		(select) => {
			if (postType !== 'fair_event' || !postId) {
				return null;
			}
			return select(STORE_NAME).getEventData();
		},
		[postId, postType]
	);

	const isLinked = eventData && eventData.id;

	return (
		<div {...blockProps}>
			{isLinked ? (
				<ServerSideRender
					block="fair-events/event-info"
					attributes={attributes}
				/>
			) : (
				<p style={{ fontStyle: 'italic', color: '#999' }}>
					{__(
						'Event Info block is disabled — no event is linked to this post.',
						'fair-events'
					)}
				</p>
			)}
		</div>
	);
}
