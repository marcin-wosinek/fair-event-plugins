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

export default function EventPhotos({ eventDateId }) {
	const [photos, setPhotos] = useState([]);
	const [loading, setLoading] = useState(true);
	const [selectMode, setSelectMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState([]);
	const [showTagModal, setShowTagModal] = useState(false);
	const [detailIndex, setDetailIndex] = useState(null);
	const [sortBy, setSortBy] = useState('default');
	const [groupBy, setGroupBy] = useState('none');

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		apiFetch({ path: `/fair-events/v1/event-dates/${eventDateId}/gallery` })
			.then((data) => {
				setPhotos(data || []);
			})
			.catch(() => {
				setPhotos([]);
			})
			.finally(() => setLoading(false));
	}, [eventDateId]);

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

	const handleDownload = () => {
		const ids = selectMode && selectedIds.length > 0 ? selectedIds : null;
		let path = `/fair-events/v1/event-dates/${eventDateId}/gallery/download`;
		if (ids) {
			path += `?ids=${ids.join(',')}`;
		}
		apiFetch({ path, parse: false }).then((response) => {
			response.blob().then((blob) => {
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				const disposition = response.headers.get('Content-Disposition');
				const match =
					disposition && disposition.match(/filename="(.+)"/);
				a.download = match ? match[1] : 'photos.zip';
				document.body.appendChild(a);
				a.click();
				a.remove();
				URL.revokeObjectURL(url);
			});
		});
	};

	const sortedPhotos = [...photos].sort((a, b) => {
		if (sortBy === 'likes-desc') {
			return b.likes_count - a.likes_count;
		}
		if (sortBy === 'likes-asc') {
			return a.likes_count - b.likes_count;
		}
		return 0;
	});

	const groupedPhotos = (() => {
		if (groupBy === 'none') {
			return null;
		}
		const groups = new Map();
		const ungroupedKey = __('Unknown', 'fair-events');
		sortedPhotos.forEach((photo) => {
			if (groupBy === 'author') {
				const key = photo.author_name || ungroupedKey;
				if (!groups.has(key)) {
					groups.set(key, []);
				}
				groups.get(key).push(photo);
			} else if (groupBy === 'tagged') {
				const tags = photo.tagged_participants || [];
				if (tags.length === 0) {
					const key = __('Not tagged', 'fair-events');
					if (!groups.has(key)) {
						groups.set(key, []);
					}
					groups.get(key).push(photo);
				} else {
					tags.forEach((tag) => {
						const key = tag.name || ungroupedKey;
						if (!groups.has(key)) {
							groups.set(key, []);
						}
						groups.get(key).push(photo);
					});
				}
			}
		});
		return Array.from(groups.entries()).map(([name, items]) => ({
			name,
			photos: items,
		}));
	})();

	const toggleGroupSelect = (groupPhotos) => {
		const groupIds = groupPhotos.map((p) => p.id);
		const allSelected = groupIds.every((id) => selectedIds.includes(id));
		if (allSelected) {
			setSelectedIds((prev) =>
				prev.filter((id) => !groupIds.includes(id))
			);
		} else {
			setSelectedIds((prev) => [
				...prev,
				...groupIds.filter((id) => !prev.includes(id)),
			]);
		}
	};

	const mediaLibraryUrl = eventDateId
		? `upload.php?fair_event_filter=${eventDateId}`
		: 'upload.php';

	const renderPhotoGrid = (photoList) => (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
				gap: '8px',
			}}
		>
			{photoList.map((photo) => (
				<div
					key={photo.id}
					style={{
						borderRadius: '4px',
						overflow: 'hidden',
						background: '#f9f9f9',
						cursor: 'pointer',
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
								sortedPhotos.findIndex((p) => p.id === photo.id)
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
									sortedPhotos.findIndex(
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
	);

	if (!eventDateId || photos.length === 0) {
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
					<SelectControl
						value={groupBy}
						options={[
							{
								label: __('No grouping', 'fair-events'),
								value: 'none',
							},
							{
								label: __('Group by author', 'fair-events'),
								value: 'author',
							},
							{
								label: __('Group by tagged', 'fair-events'),
								value: 'tagged',
							},
						]}
						onChange={setGroupBy}
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
					<Button variant="secondary" onClick={handleDownload}>
						{selectMode && selectedIds.length > 0
							? __('Download Selected', 'fair-events')
							: __('Download All', 'fair-events')}
					</Button>
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
						href={`/?event_gallery_id=${eventDateId}`}
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
				{groupedPhotos
					? groupedPhotos.map((group) => (
							<div
								key={group.name}
								style={{ marginBottom: '24px' }}
							>
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '8px',
										marginBottom: '8px',
									}}
								>
									{selectMode && (
										<CheckboxControl
											checked={group.photos
												.map((p) => p.id)
												.every((id) =>
													selectedIds.includes(id)
												)}
											onChange={() =>
												toggleGroupSelect(group.photos)
											}
											__nextHasNoMarginBottom
										/>
									)}
									<h3 style={{ margin: 0 }}>
										{group.name} ({group.photos.length})
									</h3>
								</div>
								{renderPhotoGrid(group.photos)}
							</div>
					  ))
					: renderPhotoGrid(sortedPhotos)}
				<Button
					variant="secondary"
					href={`media-new.php?fair_event=${eventDateId}`}
					style={{ marginTop: '16px' }}
				>
					{__('Add New Photos', 'fair-events')}
				</Button>
			</CardBody>
			{detailIndex !== null && sortedPhotos[detailIndex] && (
				<PhotoDetail
					photo={sortedPhotos[detailIndex]}
					eventDateId={eventDateId}
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
					eventDateId={eventDateId}
					onSelect={handleBatchTag}
					onClose={() => setShowTagModal(false)}
				/>
			)}
		</Card>
	);
}
