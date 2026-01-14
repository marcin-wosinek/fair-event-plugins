/**
 * Event Gallery - Frontend JavaScript
 *
 * @package FairEvents
 */

import { render, useState, useEffect, useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import './style.css';

/**
 * Heart icon component
 *
 * @param {Object} props - Component props
 * @param {boolean} props.filled - Whether heart is filled
 */
function HeartIcon({ filled }) {
	if (filled) {
		return (
			<svg
				viewBox="0 0 24 24"
				fill="currentColor"
				width="24"
				height="24"
				aria-hidden="true"
			>
				<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
			</svg>
		);
	}
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			width="24"
			height="24"
			aria-hidden="true"
		>
			<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
		</svg>
	);
}

/**
 * Photo card component
 *
 * @param {Object} props - Component props
 * @param {Object} props.photo - Photo data
 * @param {number} props.likeCount - Like count
 * @param {boolean} props.userLiked - Whether user has liked
 * @param {Function} props.onLikeToggle - Like toggle handler
 */
function PhotoCard({ photo, likeCount, userLiked, onLikeToggle }) {
	const [isToggling, setIsToggling] = useState(false);

	const handleLikeClick = async () => {
		if (isToggling) return;

		setIsToggling(true);
		await onLikeToggle(photo.id);
		setIsToggling(false);
	};

	return (
		<div className="fe-gallery-card">
			<div className="fe-gallery-card__image-wrapper">
				<img
					src={photo.sizes?.large || photo.sizes?.medium || photo.url}
					alt={photo.alt_text || photo.title}
					loading="lazy"
				/>
			</div>
			<button
				className={`fe-gallery-card__like-btn ${userLiked ? 'fe-gallery-card__like-btn--liked' : ''}`}
				onClick={handleLikeClick}
				disabled={isToggling}
				aria-label={
					userLiked
						? __('Unlike this photo', 'fair-events')
						: __('Like this photo', 'fair-events')
				}
			>
				<HeartIcon filled={userLiked} />
				<span className="fe-gallery-card__like-count">{likeCount}</span>
			</button>
		</div>
	);
}

/**
 * Gallery component
 */
function Gallery() {
	const [photos, setPhotos] = useState([]);
	const [likeCounts, setLikeCounts] = useState({});
	const [userLikes, setUserLikes] = useState({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	// Get event info from the root element.
	const root = document.getElementById('fair-events-gallery-root');
	const eventId = root?.dataset?.eventId;
	const eventTitle = root?.dataset?.eventTitle;

	// Fetch photos on mount.
	useEffect(() => {
		if (!eventId) {
			setError(__('Event ID not found.', 'fair-events'));
			setLoading(false);
			return;
		}

		fetchPhotos();
	}, [eventId]);

	const fetchPhotos = async () => {
		try {
			setLoading(true);
			setError(null);

			const response = await apiFetch({
				path: `/fair-events/v1/events/${eventId}/gallery`,
			});

			setPhotos(response);

			// Fetch like counts for all photos.
			if (response.length > 0) {
				await fetchLikeCounts(response.map((p) => p.id));
			}
		} catch (err) {
			console.error('Failed to fetch photos:', err);
			setError(
				err.message || __('Failed to load photos.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const fetchLikeCounts = async (photoIds) => {
		const counts = {};
		const likes = {};

		// Fetch like info for each photo.
		await Promise.all(
			photoIds.map(async (id) => {
				try {
					const response = await apiFetch({
						path: `/fair-events/v1/photos/${id}/likes`,
					});
					counts[id] = response.count || 0;
					likes[id] = response.user_liked || false;
				} catch (err) {
					counts[id] = 0;
					likes[id] = false;
				}
			})
		);

		setLikeCounts(counts);
		setUserLikes(likes);
	};

	const handleLikeToggle = useCallback(
		async (photoId) => {
			const currentlyLiked = userLikes[photoId];

			// Optimistic update.
			setUserLikes((prev) => ({
				...prev,
				[photoId]: !currentlyLiked,
			}));
			setLikeCounts((prev) => ({
				...prev,
				[photoId]: prev[photoId] + (currentlyLiked ? -1 : 1),
			}));

			try {
				if (currentlyLiked) {
					await apiFetch({
						path: `/fair-events/v1/photos/${photoId}/likes`,
						method: 'DELETE',
					});
				} else {
					await apiFetch({
						path: `/fair-events/v1/photos/${photoId}/likes`,
						method: 'POST',
					});
				}
			} catch (err) {
				// Revert on error.
				console.error('Like toggle failed:', err);
				setUserLikes((prev) => ({
					...prev,
					[photoId]: currentlyLiked,
				}));
				setLikeCounts((prev) => ({
					...prev,
					[photoId]: prev[photoId] + (currentlyLiked ? 1 : -1),
				}));
			}
		},
		[userLikes]
	);

	if (loading) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">{eventTitle}</h1>
				</header>
				<div className="fe-gallery__loading">
					{__('Loading...', 'fair-events')}
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">{eventTitle}</h1>
				</header>
				<div className="fe-gallery__error">{error}</div>
			</div>
		);
	}

	if (photos.length === 0) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">{eventTitle}</h1>
				</header>
				<div className="fe-gallery__empty">
					{__('No photos available for this event.', 'fair-events')}
				</div>
			</div>
		);
	}

	return (
		<div className="fe-gallery">
			<header className="fe-gallery__header">
				<h1 className="fe-gallery__title">{eventTitle}</h1>
			</header>
			<div className="fe-gallery__grid">
				{photos.map((photo) => (
					<PhotoCard
						key={photo.id}
						photo={photo}
						likeCount={likeCounts[photo.id] || 0}
						userLiked={userLikes[photo.id] || false}
						onLikeToggle={handleLikeToggle}
					/>
				))}
			</div>
		</div>
	);
}

// Mount the gallery.
const root = document.getElementById('fair-events-gallery-root');
if (root) {
	render(<Gallery />, root);
}
