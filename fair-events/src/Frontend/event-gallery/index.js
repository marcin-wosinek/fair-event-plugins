/**
 * Event Gallery - Frontend JavaScript
 *
 * @package FairEvents
 */

import {
	render,
	useState,
	useEffect,
	useCallback,
	useRef,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import './style.css';

/**
 * Heart icon component
 *
 * @param {Object} props - Component props
 * @param {boolean} props.filled - Whether heart is filled
 */
function HeartIcon( { filled } ) {
	if ( filled ) {
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
 * Close icon component
 */
function CloseIcon() {
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
			<path d="M18 6L6 18M6 6l12 12" />
		</svg>
	);
}

/**
 * Arrow icon component
 *
 * @param {Object} props - Component props
 * @param {string} props.direction - Arrow direction ('left' or 'right')
 */
function ArrowIcon( { direction } ) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			width="32"
			height="32"
			aria-hidden="true"
		>
			{ direction === 'left' ? (
				<path d="M15 18l-6-6 6-6" />
			) : (
				<path d="M9 18l6-6-6-6" />
			) }
		</svg>
	);
}

/**
 * Lightbox component for fullscreen photo view
 *
 * @param {Object} props - Component props
 * @param {Object} props.photo - Photo data
 * @param {Function} props.onClose - Close handler
 * @param {Function} props.onPrev - Previous photo handler
 * @param {Function} props.onNext - Next photo handler
 * @param {boolean} props.hasPrev - Whether there is a previous photo
 * @param {boolean} props.hasNext - Whether there is a next photo
 * @param {number} props.likeCount - Like count
 * @param {boolean} props.userLiked - Whether user has liked
 * @param {Function} props.onLikeToggle - Like toggle handler
 */
function Lightbox( {
	photo,
	onClose,
	onPrev,
	onNext,
	hasPrev,
	hasNext,
	likeCount,
	userLiked,
	onLikeToggle,
} ) {
	const lightboxRef = useRef( null );
	const [ isToggling, setIsToggling ] = useState( false );

	// Handle keyboard navigation.
	useEffect( () => {
		const handleKeyDown = ( e ) => {
			switch ( e.key ) {
				case 'Escape':
					onClose();
					break;
				case 'ArrowLeft':
					if ( hasPrev ) onPrev();
					break;
				case 'ArrowRight':
					if ( hasNext ) onNext();
					break;
			}
		};

		document.addEventListener( 'keydown', handleKeyDown );
		// Prevent body scroll when lightbox is open.
		document.body.style.overflow = 'hidden';

		return () => {
			document.removeEventListener( 'keydown', handleKeyDown );
			document.body.style.overflow = '';
		};
	}, [ onClose, onPrev, onNext, hasPrev, hasNext ] );

	// Close on backdrop click.
	const handleBackdropClick = ( e ) => {
		if ( e.target === lightboxRef.current ) {
			onClose();
		}
	};

	const handleLikeClick = async () => {
		if ( isToggling ) return;

		setIsToggling( true );
		await onLikeToggle( photo.id );
		setIsToggling( false );
	};

	return (
		<div
			className="fe-lightbox"
			ref={ lightboxRef }
			onClick={ handleBackdropClick }
			role="dialog"
			aria-modal="true"
			aria-label={ __( 'Photo viewer', 'fair-events' ) }
		>
			<button
				className="fe-lightbox__close"
				onClick={ onClose }
				aria-label={ __( 'Close', 'fair-events' ) }
			>
				<CloseIcon />
			</button>

			{ hasPrev && (
				<button
					className="fe-lightbox__nav fe-lightbox__nav--prev"
					onClick={ onPrev }
					aria-label={ __( 'Previous photo', 'fair-events' ) }
				>
					<ArrowIcon direction="left" />
				</button>
			) }

			<div className="fe-lightbox__content">
				<img
					src={ photo.sizes?.full || photo.url }
					alt={ photo.alt_text || photo.title }
					className="fe-lightbox__image"
				/>
			</div>

			{ hasNext && (
				<button
					className="fe-lightbox__nav fe-lightbox__nav--next"
					onClick={ onNext }
					aria-label={ __( 'Next photo', 'fair-events' ) }
				>
					<ArrowIcon direction="right" />
				</button>
			) }

			<button
				className={ `fe-lightbox__like-btn ${
					userLiked ? 'fe-lightbox__like-btn--liked' : ''
				}` }
				onClick={ handleLikeClick }
				disabled={ isToggling }
				aria-label={
					userLiked
						? __( 'Unlike this photo', 'fair-events' )
						: __( 'Like this photo', 'fair-events' )
				}
			>
				<HeartIcon filled={ userLiked } />
				<span className="fe-lightbox__like-count">{ likeCount }</span>
			</button>
		</div>
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
 * @param {Function} props.onImageClick - Image click handler
 */
function PhotoCard( {
	photo,
	likeCount,
	userLiked,
	onLikeToggle,
	onImageClick,
} ) {
	const [ isToggling, setIsToggling ] = useState( false );

	const handleLikeClick = async () => {
		if ( isToggling ) return;

		setIsToggling( true );
		await onLikeToggle( photo.id );
		setIsToggling( false );
	};

	return (
		<div className="fe-gallery-card">
			<button
				className="fe-gallery-card__image-wrapper"
				onClick={ onImageClick }
				aria-label={ __( 'View photo fullscreen', 'fair-events' ) }
			>
				<img
					src={
						photo.sizes?.large || photo.sizes?.medium || photo.url
					}
					alt={ photo.alt_text || photo.title }
					loading="lazy"
				/>
			</button>
			<button
				className={ `fe-gallery-card__like-btn ${
					userLiked ? 'fe-gallery-card__like-btn--liked' : ''
				}` }
				onClick={ handleLikeClick }
				disabled={ isToggling }
				aria-label={
					userLiked
						? __( 'Unlike this photo', 'fair-events' )
						: __( 'Like this photo', 'fair-events' )
				}
			>
				<HeartIcon filled={ userLiked } />
				<span className="fe-gallery-card__like-count">
					{ likeCount }
				</span>
			</button>
		</div>
	);
}

/**
 * Gallery component
 */
function Gallery() {
	const [ photos, setPhotos ] = useState( [] );
	const [ likeCounts, setLikeCounts ] = useState( {} );
	const [ userLikes, setUserLikes ] = useState( {} );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ lightboxIndex, setLightboxIndex ] = useState( null );

	// Get event info from the root element.
	const root = document.getElementById( 'fair-events-gallery-root' );
	const eventId = root?.dataset?.eventId;
	const eventTitle = root?.dataset?.eventTitle;
	const eventUrl = root?.dataset?.eventUrl;
	// Get participant ID if token-based access.
	const participantId =
		root?.dataset?.participantId || window.fairEventsGallery?.participantId;

	// Fetch photos on mount.
	useEffect( () => {
		if ( ! eventId ) {
			setError( __( 'Event ID not found.', 'fair-events' ) );
			setLoading( false );
			return;
		}

		fetchPhotos();
	}, [ eventId ] );

	const fetchPhotos = async () => {
		try {
			setLoading( true );
			setError( null );

			const response = await apiFetch( {
				path: `/fair-events/v1/events/${ eventId }/gallery`,
			} );

			setPhotos( response );

			// Fetch like counts for all photos.
			if ( response.length > 0 ) {
				await fetchLikeCounts( response.map( ( p ) => p.id ) );
			}
		} catch ( err ) {
			console.error( 'Failed to fetch photos:', err );
			setError(
				err.message || __( 'Failed to load photos.', 'fair-events' )
			);
		} finally {
			setLoading( false );
		}
	};

	const fetchLikeCounts = async ( photoIds ) => {
		const counts = {};
		const likes = {};

		// Fetch like info for each photo.
		await Promise.all(
			photoIds.map( async ( id ) => {
				try {
					// Build path with participant_id if available.
					let path = `/fair-events/v1/photos/${ id }/likes`;
					if ( participantId ) {
						path += `?participant_id=${ participantId }`;
					}
					const response = await apiFetch( { path } );
					counts[ id ] = response.count || 0;
					likes[ id ] = response.user_liked || false;
				} catch ( err ) {
					counts[ id ] = 0;
					likes[ id ] = false;
				}
			} )
		);

		setLikeCounts( counts );
		setUserLikes( likes );
	};

	const handleLikeToggle = useCallback(
		async ( photoId ) => {
			const currentlyLiked = userLikes[ photoId ];

			// Optimistic update.
			setUserLikes( ( prev ) => ( {
				...prev,
				[ photoId ]: ! currentlyLiked,
			} ) );
			setLikeCounts( ( prev ) => ( {
				...prev,
				[ photoId ]: prev[ photoId ] + ( currentlyLiked ? -1 : 1 ),
			} ) );

			try {
				// Build request data with participant_id if available.
				const requestData = participantId
					? { participant_id: parseInt( participantId, 10 ) }
					: {};

				if ( currentlyLiked ) {
					await apiFetch( {
						path: `/fair-events/v1/photos/${ photoId }/likes`,
						method: 'DELETE',
						data: requestData,
					} );
				} else {
					await apiFetch( {
						path: `/fair-events/v1/photos/${ photoId }/likes`,
						method: 'POST',
						data: requestData,
					} );
				}
			} catch ( err ) {
				// Revert on error.
				console.error( 'Like toggle failed:', err );
				setUserLikes( ( prev ) => ( {
					...prev,
					[ photoId ]: currentlyLiked,
				} ) );
				setLikeCounts( ( prev ) => ( {
					...prev,
					[ photoId ]: prev[ photoId ] + ( currentlyLiked ? 1 : -1 ),
				} ) );
			}
		},
		[ userLikes, participantId ]
	);

	// Lightbox handlers.
	const openLightbox = useCallback( ( index ) => {
		setLightboxIndex( index );
	}, [] );

	const closeLightbox = useCallback( () => {
		setLightboxIndex( null );
	}, [] );

	const goToPrevPhoto = useCallback( () => {
		setLightboxIndex( ( prev ) => ( prev > 0 ? prev - 1 : prev ) );
	}, [] );

	const goToNextPhoto = useCallback( () => {
		setLightboxIndex( ( prev ) =>
			prev < photos.length - 1 ? prev + 1 : prev
		);
	}, [ photos.length ] );

	if ( loading ) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">
						<a href={ eventUrl }>{ eventTitle }</a>
					</h1>
				</header>
				<div className="fe-gallery__loading">
					{ __( 'Loading...', 'fair-events' ) }
				</div>
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">
						<a href={ eventUrl }>{ eventTitle }</a>
					</h1>
				</header>
				<div className="fe-gallery__error">{ error }</div>
			</div>
		);
	}

	if ( photos.length === 0 ) {
		return (
			<div className="fe-gallery">
				<header className="fe-gallery__header">
					<h1 className="fe-gallery__title">
						<a href={ eventUrl }>{ eventTitle }</a>
					</h1>
				</header>
				<div className="fe-gallery__empty">
					{ __(
						'No photos available for this event.',
						'fair-events'
					) }
				</div>
			</div>
		);
	}

	return (
		<div className="fe-gallery">
			<header className="fe-gallery__header">
				<h1 className="fe-gallery__title">
					<a href={ eventUrl }>{ eventTitle }</a>
				</h1>
			</header>
			<div className="fe-gallery__grid">
				{ photos.map( ( photo, index ) => (
					<PhotoCard
						key={ photo.id }
						photo={ photo }
						likeCount={ likeCounts[ photo.id ] || 0 }
						userLiked={ userLikes[ photo.id ] || false }
						onLikeToggle={ handleLikeToggle }
						onImageClick={ () => openLightbox( index ) }
					/>
				) ) }
			</div>
			{ lightboxIndex !== null && (
				<Lightbox
					photo={ photos[ lightboxIndex ] }
					onClose={ closeLightbox }
					onPrev={ goToPrevPhoto }
					onNext={ goToNextPhoto }
					hasPrev={ lightboxIndex > 0 }
					hasNext={ lightboxIndex < photos.length - 1 }
					likeCount={ likeCounts[ photos[ lightboxIndex ].id ] || 0 }
					userLiked={
						userLikes[ photos[ lightboxIndex ].id ] || false
					}
					onLikeToggle={ handleLikeToggle }
				/>
			) }
		</div>
	);
}

// Mount the gallery.
const root = document.getElementById( 'fair-events-gallery-root' );
if ( root ) {
	render( <Gallery />, root );
}
