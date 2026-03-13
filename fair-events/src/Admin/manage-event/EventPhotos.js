import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	CheckboxControl,
	SelectControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import PhotoTagModal from './PhotoTagModal.js';
import PhotoDetail from './PhotoDetail.js';

export default function EventPhotos({ eventId }) {
	const [photos, setPhotos] = useState([]);
	const [loading, setLoading] = useState(true);
	const [selectMode, setSelectMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState([]);
	const [showTagModal, setShowTagModal] = useState(false);
	const [detailIndex, setDetailIndex] = useState(null);
	const [sortBy, setSortBy] = useState('default');

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

	const toggleSelect = (photoId) => {
		setSelectedIds((prev) =>
			prev.includes(photoId)
				? prev.filter((id) => id !== photoId)
				: [...prev, photoId]
		);
	};

	const handleBatchTag = (participant) => {
		setShowTagModal(false);
		apiFetch({
			path: '/fair-audience/v1/photos/batch-tag',
			method: 'POST',
			data: {
				attachment_ids: selectedIds,
				participant_id: participant.id,
			},
		}).then(() => {
			// Update local state with new tags.
			setPhotos((prev) =>
				prev.map((p) => {
					if (!selectedIds.includes(p.id)) return p;
					const alreadyTagged = (p.tagged_participants || []).some(
						(t) => t.participant_id === participant.id
					);
					if (alreadyTagged) return p;
					const newTag = {
						participant_id: participant.id,
						name: `${participant.name || ''} ${
							participant.surname || ''
						}`.trim(),
					};
					const updated = [...(p.tagged_participants || []), newTag];
					return {
						...p,
						tagged_participants: updated,
						tags_count: updated.length,
					};
				})
			);
			setSelectedIds([]);
			setSelectMode(false);
		});
	};

	const handleTagsChanged = useCallback((photoId, newTags) => {
		setPhotos((prev) =>
			prev.map((p) =>
				p.id === photoId
					? {
							...p,
							tagged_participants: newTags,
							tags_count: newTags.length,
					  }
					: p
			)
		);
	}, []);

	if (loading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	const sortedPhotos = [...photos].sort((a, b) => {
		if (sortBy === 'likes-desc') {
			return b.likes_count - a.likes_count;
		}
		if (sortBy === 'likes-asc') {
			return a.likes_count - b.likes_count;
		}
		return 0;
	});

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
				<div
					style={{
						display: 'flex',
						gap: '8px',
						alignItems: 'center',
					}}
				>
					<SelectControl
						value={sortBy}
						options={[
							{
								label: __('Default order', 'fair-events'),
								value: 'default',
							},
							{
								label: __('Most liked', 'fair-events'),
								value: 'likes-desc',
							},
							{
								label: __('Least liked', 'fair-events'),
								value: 'likes-asc',
							},
						]}
						onChange={setSortBy}
						__nextHasNoMarginBottom
					/>
					{selectMode && selectedIds.length > 0 && (
						<Button
							variant="primary"
							onClick={() => setShowTagModal(true)}
						>
							{__('Tag Person', 'fair-events')}
						</Button>
					)}
					<Button
						variant={selectMode ? 'primary' : 'secondary'}
						onClick={() => {
							setSelectMode(!selectMode);
							setSelectedIds([]);
						}}
					>
						{selectMode
							? __('Cancel Selection', 'fair-events')
							: __('Select Photos', 'fair-events')}
					</Button>
					<Button
						variant="secondary"
						href={`/?event_gallery_id=${eventId}`}
						target="_blank"
					>
						{__('View Gallery', 'fair-events')}
					</Button>
					<Button variant="secondary" href={mediaLibraryUrl}>
						{__('Media Library', 'fair-events')}
					</Button>
				</div>
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
					{sortedPhotos.map((photo) => (
						<div
							key={photo.id}
							style={{
								borderRadius: '4px',
								overflow: 'hidden',
								background: '#f9f9f9',
								cursor: selectMode ? 'pointer' : 'pointer',
								outline:
									selectMode && selectedIds.includes(photo.id)
										? '3px solid #007cba'
										: 'none',
								position: 'relative',
							}}
							onClick={() => {
								if (selectMode) {
									toggleSelect(photo.id);
								} else {
									setDetailIndex(
										sortedPhotos.findIndex(
											(p) => p.id === photo.id
										)
									);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									if (selectMode) {
										toggleSelect(photo.id);
									} else {
										setDetailIndex(
											photos.findIndex(
												(p) => p.id === photo.id
											)
										);
									}
								}
							}}
							role="button"
							tabIndex={0}
						>
							{selectMode && (
								<div
									style={{
										position: 'absolute',
										top: '6px',
										left: '6px',
										zIndex: 1,
									}}
									onClick={(e) => e.stopPropagation()}
									onKeyDown={(e) => e.stopPropagation()}
									role="presentation"
								>
									<CheckboxControl
										checked={selectedIds.includes(photo.id)}
										onChange={() => toggleSelect(photo.id)}
									/>
								</div>
							)}
							{photo.tags_count > 0 && (
								<div
									title={(photo.tagged_participants || [])
										.map((t) => t.name)
										.filter(Boolean)
										.join(', ')}
									style={{
										position: 'absolute',
										top: '6px',
										right: '6px',
										background: '#007cba',
										color: '#fff',
										borderRadius: '10px',
										padding: '2px 8px',
										fontSize: '11px',
										zIndex: 1,
									}}
								>
									{photo.tags_count}
								</div>
							)}
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
								<div
									style={{ color: '#9ca0a4' }}
									title={(photo.liked_by || []).join(', ')}
								>
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
			{detailIndex !== null && sortedPhotos[detailIndex] && (
				<PhotoDetail
					photo={sortedPhotos[detailIndex]}
					eventId={eventId}
					onClose={() => setDetailIndex(null)}
					onTagsChanged={handleTagsChanged}
					hasPrev={detailIndex > 0}
					hasNext={detailIndex < sortedPhotos.length - 1}
					onPrev={() => setDetailIndex((i) => i - 1)}
					onNext={() => setDetailIndex((i) => i + 1)}
				/>
			)}
			{showTagModal && (
				<PhotoTagModal
					eventId={eventId}
					onSelect={handleBatchTag}
					onClose={() => setShowTagModal(false)}
				/>
			)}
		</Card>
	);
}
