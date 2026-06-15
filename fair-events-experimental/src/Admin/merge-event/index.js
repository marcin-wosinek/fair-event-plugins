/**
 * Merge Event Page - Entry Point
 *
 * @package FairEventsExperimental
 */

import domReady from '@wordpress/dom-ready';
import { createRoot, useState, useEffect } from '@wordpress/element';
import { Spinner, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import MergeEventWizard from '../manage-event/MergeEventWizard.js';

function MergeEventPage() {
	const { eventDateId, manageEventUrl } =
		window.fairEventsMergeEventData || {};

	const [eventDate, setEventDate] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		apiFetch({ path: `/fair-events/v1/event-dates/${eventDateId}` })
			.then((data) => {
				setEventDate(data);
				setLoading(false);
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to load event.', 'fair-events-experimental')
				);
				setLoading(false);
			});
	}, [eventDateId]);

	if (loading) {
		return <Spinner />;
	}

	if (error || !eventDate) {
		return (
			<Notice status="error" isDismissible={false}>
				{error || __('Event not found.', 'fair-events-experimental')}
			</Notice>
		);
	}

	return (
		<MergeEventWizard
			sourceEventDate={eventDate}
			sourceEventDateId={eventDateId}
			manageEventUrl={manageEventUrl || ''}
			onCancel={() => {
				window.location.href = `${manageEventUrl}&event_date_id=${eventDateId}&tab=admin`;
			}}
		/>
	);
}

domReady(() => {
	const container = document.getElementById('fair-events-merge-event-root');
	if (container) {
		const root = createRoot(container);
		root.render(<MergeEventPage />);
	}
});
