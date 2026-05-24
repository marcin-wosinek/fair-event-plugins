/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import ServerSideRender from '@wordpress/server-side-render';

/**
 * Edit component for Event Info block.
 *
 * Linkage is resolved the same way the server does (by post ID, not post type):
 * an event-date is linked to this post if its primary `event_id` matches, or if
 * the post appears in the date's junction-linked posts. This mirrors
 * SelectedOccurrence::resolve() in render.php, so the editor preview matches the
 * published output for any enabled post type — including pages.
 *
 * @param {Object} props            - Component props
 * @param {Object} props.attributes - Block attributes
 * @param {Object} props.context    - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, context }) {
	const blockProps = useBlockProps();
	const { postId } = context;

	// null = still resolving, true/false = resolved linkage.
	const [linked, setLinked] = useState(null);

	useEffect(() => {
		if (!postId) {
			setLinked(false);
			return undefined;
		}

		let cancelled = false;
		const currentPostId = parseInt(postId, 10);

		apiFetch({ path: '/fair-events/v1/event-dates?include_linked=true' })
			.then((eventDates) => {
				if (cancelled) {
					return;
				}
				const isLinked = (eventDates || []).some(
					(ed) =>
						ed.event_id === currentPostId ||
						(ed.linked_posts || []).some(
							(p) => p.id === currentPostId
						)
				);
				setLinked(isLinked);
			})
			.catch(() => {
				if (!cancelled) {
					setLinked(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [postId]);

	return (
		<div {...blockProps}>
			{linked === null ? null : linked ? (
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
