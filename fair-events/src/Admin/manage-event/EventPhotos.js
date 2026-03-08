import { useState, useEffect } from '@wordpress/element';
import { Card, CardHeader, CardBody, Spinner } from '@wordpress/components';
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

	if (!eventId || photos.length === 0) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Photos', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<p>{__('No photos for this event.', 'fair-events')}</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Photos', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<div
					style={{
						display: 'grid',
						gridTemplateColumns:
							'repeat(auto-fill, minmax(180px, 1fr))',
						gap: '16px',
					}}
				>
					{photos.map((photo) => (
						<div
							key={photo.id}
							style={{
								border: '1px solid #ddd',
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
									padding: '8px',
									fontSize: '13px',
								}}
							>
								{photo.author_name && (
									<div
										style={{
											marginBottom: '4px',
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
			</CardBody>
		</Card>
	);
}
