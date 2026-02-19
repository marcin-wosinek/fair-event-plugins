/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	SelectControl,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * LinkOptions component
 *
 * Shows "Create New Event" and "Link Existing Event" options
 * for non-fair_event posts that aren't yet linked to an event.
 */
export default function LinkOptions({ postId, onEventLinked, setError }) {
	const [allEvents, setAllEvents] = useState([]);
	const [selectedEventDateId, setSelectedEventDateId] = useState('');
	const [creating, setCreating] = useState(false);
	const [linking, setLinking] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/event-dates?include_linked=true' })
			.then(setAllEvents)
			.catch(() => {});
	}, []);

	const handleCreateNew = async () => {
		setCreating(true);
		try {
			const postTitle =
				document.getElementById('title')?.value ||
				__('Untitled Event', 'fair-events');

			const newEvent = await apiFetch({
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: postTitle,
					start_datetime: null,
					link_type: 'none',
				},
			});

			// Link the new event to this post.
			await apiFetch({
				path: `/fair-events/v1/event-dates/${newEvent.id}/link-post`,
				method: 'POST',
				data: { post_id: parseInt(postId, 10) },
			});

			onEventLinked(newEvent.id);
		} catch (err) {
			setError(
				err.message || __('Failed to create event.', 'fair-events')
			);
		} finally {
			setCreating(false);
		}
	};

	const handleLinkExisting = async () => {
		if (!selectedEventDateId) return;
		setLinking(true);
		try {
			await apiFetch({
				path: `/fair-events/v1/event-dates/${selectedEventDateId}/link-post`,
				method: 'POST',
				data: { post_id: parseInt(postId, 10) },
			});

			onEventLinked(parseInt(selectedEventDateId, 10));
		} catch (err) {
			setError(err.message || __('Failed to link event.', 'fair-events'));
		} finally {
			setLinking(false);
		}
	};

	const eventOptions = [
		{ label: __('Select an event...', 'fair-events'), value: '' },
		...allEvents.map((event) => {
			const date = event.start_datetime
				? new Date(
						event.start_datetime.replace(' ', 'T')
				  ).toLocaleDateString()
				: '';
			const linkedCount = event.linked_posts?.length || 0;
			let label = event.title ? `${event.title} - ${date}` : date;
			if (linkedCount > 0) {
				const postTitles = event.linked_posts
					.map((p) => p.title)
					.join(', ');
				label += ` [${postTitles}]`;
			}
			return { label, value: String(event.id) };
		}),
	];

	return (
		<VStack spacing={3}>
			<Button
				variant="primary"
				onClick={handleCreateNew}
				isBusy={creating}
				disabled={creating}
				style={{
					width: '100%',
					justifyContent: 'center',
				}}
			>
				{__('Create New Event', 'fair-events')}
			</Button>

			<p
				style={{
					textAlign: 'center',
					color: '#666',
					margin: 0,
				}}
			>
				&mdash; {__('or', 'fair-events')} &mdash;
			</p>

			<SelectControl
				label={__('Link Existing Event', 'fair-events')}
				value={selectedEventDateId}
				options={eventOptions}
				onChange={setSelectedEventDateId}
			/>

			{selectedEventDateId && (
				<Button
					variant="secondary"
					onClick={handleLinkExisting}
					isBusy={linking}
					disabled={linking}
					style={{
						width: '100%',
						justifyContent: 'center',
					}}
				>
					{__('Link Event', 'fair-events')}
				</Button>
			)}
		</VStack>
	);
}
