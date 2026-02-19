/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { STORE_NAME } from './store.js';
import EventEditForm from './EventEditForm.js';
import LinkOptions from './LinkOptions.js';

/**
 * EventMetaBox component
 *
 * For fair_event posts: always shows the edit form (event auto-created).
 * For other post types: shows link/create options if unlinked, edit form if linked.
 */
export default function EventMetaBox({
	postId,
	postType,
	eventDateId: initialEventDateId,
	manageEventUrl: initialManageEventUrl,
}) {
	const [eventDateId, setEventDateId] = useState(initialEventDateId || 0);
	const [manageEventUrl, setManageEventUrl] = useState(
		initialManageEventUrl || ''
	);
	const [loading, setLoading] = useState(!initialEventDateId);
	const [error, setError] = useState(null);

	const { setEventData } = useDispatch(STORE_NAME);

	const isFairEvent = postType === 'fair_event';
	const isLinked = eventDateId > 0;

	// For fair_event posts that don't have an eventDateId yet, poll until auto-create completes.
	useEffect(() => {
		if (isLinked || !isFairEvent || !postId) {
			setLoading(false);
			return;
		}

		let cancelled = false;

		const checkForEventDate = async () => {
			try {
				// The auto-create hook fires on wp_after_insert_post, so the event_date
				// should exist by the time the editor loads. Try fetching it.
				const response = await apiFetch({
					path: `/fair-events/v1/event-dates?include_linked=true`,
				});

				const match = response.find(
					(ed) => ed.event_id === parseInt(postId, 10)
				);
				if (match && !cancelled) {
					setEventDateId(match.id);
					setManageEventUrl(
						`${window.location.origin}/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${match.id}`
					);
				}
			} catch {
				// Ignore errors - the event may not be created yet.
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		checkForEventDate();

		return () => {
			cancelled = true;
		};
	}, [postId, isFairEvent, isLinked]);

	const handleEventLinked = (newEventDateId) => {
		setEventDateId(newEventDateId);
		setManageEventUrl(
			`${window.location.origin}/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${newEventDateId}`
		);
	};

	if (loading) {
		return <Spinner />;
	}

	if (error) {
		return <p style={{ color: 'red' }}>{error}</p>;
	}

	// For fair_event posts or linked posts: show edit form.
	if (isLinked) {
		return (
			<EventEditForm
				eventDateId={eventDateId}
				manageEventUrl={manageEventUrl}
				postId={postId}
				postType={postType}
			/>
		);
	}

	// For non-fair_event posts that are not linked: show link options.
	if (!isFairEvent) {
		return (
			<LinkOptions
				postId={postId}
				onEventLinked={handleEventLinked}
				setError={setError}
			/>
		);
	}

	// Fair event post but no event date found (edge case).
	return (
		<p>
			{__(
				'No event data found. Please save the post and reload.',
				'fair-events'
			)}
		</p>
	);
}
