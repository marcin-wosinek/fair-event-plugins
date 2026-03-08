import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function EventPhotos({ eventId }) {
	const [photos, setPhotos] = useState([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!eventId) {
			setLoading(false);
			return;
		}
		apiFetch({ path: `/fair-events/v1/events/${eventId}/gallery` })
			.then((data) => {
				setPhotos(data || []);
			})
			.catch(() => {
				setPhotos([]);
			})
			.finally(() => setLoading(false));
	}, [eventId]);

	if (loading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	const mediaLibraryUrl = eventId
		? `upload.php?fair_event_filter=${eventId}`
		: 'upload.php';

	if (!eventId || photos.length === 0) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Photos', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<p>{__('No photos for this event.', 'fair-events')}</p>
					<Button variant="secondary" href={mediaLibraryUrl}>
						{__('Media Library', 'fair-events')}
					</Button>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card
			className="fair-events-photos"
			style={{ marginTop: '16px', maxWidth: 'none' }}
		>
			<CardHeader>
				<h2>{__('Photos', 'fair-events')}</h2>
				<Button variant="secondary" href={mediaLibraryUrl}>
					{__('Media Library', 'fair-events')}
				</Button>
			</CardHeader>
			<CardBody>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns:
							'repeat(auto-fill, minmax(180px, 1fr))',
						gap: '8px',
					}}
				>
					{photos.map((photo) => (
						<div
							key={photo.id}
							style={{
								borderRadius: '4px',
								overflow: 'hidden',
								background: '#f9f9f9',
							}}
						>
							<img
								src={photo.sizes.medium || photo.url}
								alt={photo.alt_text || photo.title}
								style={{
									width: '100%',
									aspectRatio: '1',
									objectFit: 'cover',
									display: 'block',
								}}
							/>
							<div
								style={{
									padding: '6px 8px',
									fontSize: '13px',
								}}
							>
								{photo.author_name && (
									<div
										style={{
											marginBottom: '2px',
											color: '#50575e',
										}}
									>
										{photo.author_name}
									</div>
								)}
								<div style={{ color: '#9ca0a4' }}>
									{'♥ '}
									{photo.likes_count}
								</div>
							</div>
						</div>
					))}
				</div>
				<Button
					variant="secondary"
					href={`media-new.php?fair_event=${eventId}`}
					style={{ marginTop: '16px' }}
				>
					{__('Add New Photos', 'fair-events')}
				</Button>
			</CardBody>
		</Card>
	);
}
