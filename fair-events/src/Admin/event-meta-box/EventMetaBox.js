/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
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
export default function EventMetaBox( {
	postId,
	postType,
	eventDateId: initialEventDateId,
	manageEventUrl: initialManageEventUrl,
} ) {
	const [ eventDateId, setEventDateId ] = useState( initialEventDateId || 0 );
	const [ manageEventUrl, setManageEventUrl ] = useState(
		initialManageEventUrl || ''
	);
	const [ loading, setLoading ] = useState( ! initialEventDateId );
	const [ error, setError ] = useState( null );
	const resolutionVersion = useRef( 0 );

	const { setEventData } = useDispatch( STORE_NAME );

	const isFairEvent = postType === 'fair_event';
	const isLinked = eventDateId > 0;

	// Give automatic creation a short window to finish before showing recovery actions.
	useEffect( () => {
		if ( isLinked || ! isFairEvent || ! postId ) {
			setLoading( false );
			return;
		}

		let cancelled = false;
		let timerId;
		const requestVersion = resolutionVersion.current;
		const maxAttempts = 3;

		const checkForEventDate = async ( attempt = 1 ) => {
			try {
				const response = await apiFetch( {
					path: `/fair-events/v1/event-dates?event_id=${ parseInt(
						postId,
						10
					) }`,
				} );

				const match = response[ 0 ];
				if (
					match &&
					! cancelled &&
					requestVersion === resolutionVersion.current
				) {
					resolutionVersion.current += 1;
					setEventDateId( match.id );
					setManageEventUrl(
						`${ window.location.origin }/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ match.id }`
					);
					setLoading( false );
					return;
				}
			} catch {
				// Ignore errors - the event may not be created yet.
			}

			if ( cancelled || requestVersion !== resolutionVersion.current ) {
				return;
			}

			if ( attempt < maxAttempts ) {
				timerId = window.setTimeout(
					() => checkForEventDate( attempt + 1 ),
					500
				);
				return;
			}

			setLoading( false );
		};

		checkForEventDate();

		return () => {
			cancelled = true;
			window.clearTimeout( timerId );
		};
	}, [ postId, isFairEvent, isLinked ] );

	const handleEventLinked = ( newEventDateId ) => {
		resolutionVersion.current += 1;
		setEventDateId( newEventDateId );
		setLoading( false );
		setManageEventUrl(
			`${ window.location.origin }/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ newEventDateId }`
		);
	};

	const [ unlinking, setUnlinking ] = useState( false );

	const handleUnlink = async () => {
		setUnlinking( true );
		try {
			await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/link-post`,
				method: 'DELETE',
				data: { post_id: parseInt( postId, 10 ) },
			} );
			setEventDateId( 0 );
			setManageEventUrl( '' );
			setEventData( null );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to unlink event.', 'fair-events' )
			);
		} finally {
			setUnlinking( false );
		}
	};

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return <p style={ { color: 'red' } }>{ error }</p>;
	}

	// For fair_event posts or linked posts: show edit form.
	if ( isLinked ) {
		return (
			<EventEditForm
				eventDateId={ eventDateId }
				manageEventUrl={ manageEventUrl }
				postId={ postId }
				postType={ postType }
				onUnlink={ ! isFairEvent ? handleUnlink : undefined }
				unlinking={ unlinking }
			/>
		);
	}

	return (
		<LinkOptions
			postId={ postId }
			postType={ postType }
			onEventLinked={ handleEventLinked }
			setError={ setError }
		/>
	);
}
