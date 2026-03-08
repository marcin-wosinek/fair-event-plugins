import { useState, useEffect, useCallback } from '@wordpress/element';
import { Modal, Button, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import PhotoTagModal from './PhotoTagModal.js';

export default function PhotoDetail({
	photo,
	eventId,
	onClose,
	onTagsChanged,
	onPrev,
	onNext,
	hasPrev,
	hasNext,
}) {
	const [tags, setTags] = useState(photo.tagged_participants || []);
	const [loading, setLoading] = useState(false);
	const [showTagModal, setShowTagModal] = useState(false);

	useEffect(() => {
		setTags(photo.tagged_participants || []);
	}, [photo]);

	const handleKeyDown = useCallback(
		(e) => {
			if (e.key === 'ArrowLeft' && hasPrev) {
				onPrev();
			} else if (e.key === 'ArrowRight' && hasNext) {
				onNext();
			}
		},
		[hasPrev, hasNext, onPrev, onNext]
	);

	useEffect(() => {
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [handleKeyDown]);

	const handleAddTag = (participant) => {
		setShowTagModal(false);
		setLoading(true);
		apiFetch({
			path: `/fair-audience/v1/photos/${photo.id}/tags`,
			method: 'POST',
			data: { participant_id: participant.id },
		})
			.then((result) => {
				const newTag = {
					participant_id: result.participant_id,
					name: result.name,
				};
				const updated = [...tags, newTag];
				setTags(updated);
				onTagsChanged(photo.id, updated);
			})
			.finally(() => setLoading(false));
	};

	const handleRemoveTag = (participantId) => {
		setLoading(true);
		apiFetch({
			path: `/fair-audience/v1/photos/${photo.id}/tags/${participantId}`,
			method: 'DELETE',
		})
			.then(() => {
				const updated = tags.filter(
					(t) => t.participant_id !== participantId
				);
				setTags(updated);
				onTagsChanged(photo.id, updated);
			})
			.finally(() => setLoading(false));
	};

	return (
		<Modal
			title={photo.title || __('Photo Details', 'fair-events')}
			onRequestClose={onClose}
			style={{ maxWidth: '900px', width: '90vw' }}
		>
			<div style={{ display: 'flex', gap: '24px' }}>
				<div
					style={{
						flex: '1 1 60%',
						position: 'relative',
						display: 'flex',
						alignItems: 'center',
					}}
				>
					{hasPrev && (
						<Button
							variant="secondary"
							onClick={onPrev}
							style={{
								position: 'absolute',
								left: '8px',
								zIndex: 1,
								minWidth: '36px',
								height: '36px',
								borderRadius: '50%',
								padding: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
							label={__('Previous photo', 'fair-events')}
						>
							&#8249;
						</Button>
					)}
					<img
						src={photo.sizes.large || photo.url}
						alt={photo.alt_text || photo.title}
						style={{
							width: '100%',
							borderRadius: '4px',
							display: 'block',
						}}
					/>
					{hasNext && (
						<Button
							variant="secondary"
							onClick={onNext}
							style={{
								position: 'absolute',
								right: '8px',
								zIndex: 1,
								minWidth: '36px',
								height: '36px',
								borderRadius: '50%',
								padding: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
							}}
							label={__('Next photo', 'fair-events')}
						>
							&#8250;
						</Button>
					)}
				</div>
				<div style={{ flex: '0 0 250px' }}>
					{photo.author_name && (
						<p style={{ color: '#50575e', marginBottom: '4px' }}>
							{__('Author:', 'fair-events')} {photo.author_name}
						</p>
					)}
					<p style={{ color: '#9ca0a4', marginBottom: '16px' }}>
						{'♥ '}
						{photo.likes_count}
					</p>

					<h4 style={{ marginTop: 0 }}>
						{__('Tagged People', 'fair-events')}
					</h4>
					{loading && <Spinner />}
					{tags.length === 0 && !loading && (
						<p style={{ color: '#9ca0a4' }}>
							{__('No one tagged yet.', 'fair-events')}
						</p>
					)}
					{tags.map((tag) => (
						<div
							key={tag.participant_id}
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								padding: '4px 0',
							}}
						>
							<span>{tag.name}</span>
							<Button
								variant="tertiary"
								isDestructive
								onClick={() =>
									handleRemoveTag(tag.participant_id)
								}
							>
								{__('Remove', 'fair-events')}
							</Button>
						</div>
					))}
					<Button
						variant="secondary"
						onClick={() => setShowTagModal(true)}
						style={{ marginTop: '8px' }}
					>
						{__('Add Tag', 'fair-events')}
					</Button>
				</div>
			</div>
			{showTagModal && (
				<PhotoTagModal
					eventId={eventId}
					onSelect={handleAddTag}
					onClose={() => setShowTagModal(false)}
				/>
			)}
		</Modal>
	);
}
