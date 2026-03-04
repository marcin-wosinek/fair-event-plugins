import { useState, useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { Button, TextControl, Spinner, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

function EventLinkPanel({ eventDateId, onChange }) {
	const [search, setSearch] = useState('');
	const [results, setResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [linkedEvent, setLinkedEvent] = useState(null);
	const [loadingLinked, setLoadingLinked] = useState(false);
	const [autoDetected, setAutoDetected] = useState(null);
	const [loadingAuto, setLoadingAuto] = useState(true);

	// Get current post info from the editor store.
	const { postType, postId } = useSelect((select) => {
		const editor = select('core/editor');
		return {
			postType: editor.getCurrentPostType(),
			postId: editor.getCurrentPostId(),
		};
	}, []);

	// Auto-detect if current page is an event.
	useEffect(() => {
		if (postType !== 'fair_event' || !postId) {
			setLoadingAuto(false);
			return;
		}

		apiFetch({
			path: `/fair-events/v1/event-dates?search=&include_linked=true&per_page=50`,
		})
			.then((dates) => {
				const match = dates.find((d) => d.event_id === postId);
				if (match) {
					setAutoDetected({
						id: match.id,
						title: match.title,
						start_datetime: match.start_datetime,
					});
				}
			})
			.catch(() => {})
			.finally(() => setLoadingAuto(false));
	}, [postType, postId]);

	// Load linked event details when eventDateId changes.
	useEffect(() => {
		if (!eventDateId) {
			setLinkedEvent(null);
			return;
		}

		setLoadingLinked(true);
		apiFetch({
			path: `/fair-events/v1/event-dates/${eventDateId}`,
		})
			.then((data) => {
				setLinkedEvent({
					id: data.id,
					title: data.title,
					start_datetime: data.start_datetime,
				});
			})
			.catch(() => {
				setLinkedEvent(null);
			})
			.finally(() => setLoadingLinked(false));
	}, [eventDateId]);

	// Search for events.
	useEffect(() => {
		if (search.length < 2) {
			setResults([]);
			return;
		}

		setSearching(true);
		apiFetch({
			path: `/fair-events/v1/event-dates?search=${encodeURIComponent(
				search
			)}&include_linked=true&per_page=10`,
		})
			.then((data) => {
				setResults(data);
			})
			.catch(() => {
				setResults([]);
			})
			.finally(() => setSearching(false));
	}, [search]);

	const formatDate = (datetime) => {
		if (!datetime) return '';
		const date = new Date(datetime);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	const isAutoLinked =
		autoDetected && (!eventDateId || eventDateId === autoDetected.id);

	return (
		<div>
			{loadingAuto && <Spinner />}

			{!loadingAuto && autoDetected && (
				<Notice
					status={isAutoLinked ? 'success' : 'warning'}
					isDismissible={false}
					className="fair-audience-event-link-notice"
				>
					{isAutoLinked
						? __('Auto-linked to this event page:', 'fair-audience')
						: __(
								'This page is an event, but a different event is linked:',
								'fair-audience'
						  )}
					<br />
					<strong>{autoDetected.title}</strong>
					{autoDetected.start_datetime && (
						<> ({formatDate(autoDetected.start_datetime)})</>
					)}
					{!isAutoLinked && (
						<div style={{ marginTop: '8px' }}>
							<Button
								variant="link"
								onClick={() => {
									onChange(0);
									setSearch('');
									setResults([]);
								}}
							>
								{__('Use auto-detected event', 'fair-audience')}
							</Button>
						</div>
					)}
				</Notice>
			)}

			{eventDateId > 0 && (
				<div className="fair-audience-event-link-current">
					{loadingLinked ? (
						<Spinner />
					) : linkedEvent ? (
						<>
							<p>
								<strong>
									{__('Linked event:', 'fair-audience')}
								</strong>
								<br />
								{linkedEvent.title}
								{linkedEvent.start_datetime && (
									<>
										{' '}
										(
										{formatDate(linkedEvent.start_datetime)}
										)
									</>
								)}
							</p>
							<Button
								variant="secondary"
								isDestructive
								size="small"
								onClick={() => {
									onChange(0);
									setSearch('');
									setResults([]);
								}}
							>
								{__('Remove link', 'fair-audience')}
							</Button>
						</>
					) : (
						<p>
							{__('Linked event not found (ID:', 'fair-audience')}{' '}
							{eventDateId})
						</p>
					)}
				</div>
			)}

			<TextControl
				label={__('Search events', 'fair-audience')}
				value={search}
				onChange={setSearch}
				placeholder={__('Type to search...', 'fair-audience')}
				help={
					!eventDateId && !autoDetected
						? __(
								'Link this form to a specific event.',
								'fair-audience'
						  )
						: ''
				}
			/>

			{searching && <Spinner />}

			{results.length > 0 && (
				<ul className="fair-audience-event-link-results">
					{results.map((event) => (
						<li key={event.id}>
							<Button
								variant="link"
								onClick={() => {
									onChange(event.id);
									setSearch('');
									setResults([]);
								}}
							>
								{event.title}
								{event.start_datetime && (
									<> ({formatDate(event.start_datetime)})</>
								)}
							</Button>
						</li>
					))}
				</ul>
			)}

			{search.length >= 2 && !searching && results.length === 0 && (
				<p className="fair-audience-event-link-no-results">
					{__('No events found.', 'fair-audience')}
				</p>
			)}
		</div>
	);
}

export default EventLinkPanel;
