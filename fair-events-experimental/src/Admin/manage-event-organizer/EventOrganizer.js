/**
 * Organizer section of Manage Event's Event Details (#2305).
 *
 * Administrators choose which organizer an event belongs to: the sitewide
 * default or one of the additional organizers. It sits above Categories and
 * saves on its own. A series has one organizer, chosen on the series; its
 * dates show it with a link there.
 *
 * @package FairEventsExperimental
 */

import { useEffect, useRef, useState } from '@wordpress/element';
import {
	BaseControl,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import OrganizerSelect, {
	DEFAULT_ORGANIZER_ID,
	organizerLabel,
} from '../components/OrganizerSelect.js';

export { organizerLabel };

export const SECTION_NAME = 'organizer';

// Key the section reports unsaved edits and parks drafts under, so the
// host marks the Event Details tab.
export const DIRTY_KEY = `event-details/${ SECTION_NAME }`;

/**
 * URL of this page for another event date, opened on Event Details.
 *
 * @param {number} eventDateId Event date to open.
 * @return {string} Manage Event URL.
 */
function manageEventUrl( eventDateId ) {
	const url = new URL( window.location.href );
	url.searchParams.set( 'event_date_id', String( eventDateId ) );
	url.searchParams.delete( 'tab' );
	return url.toString();
}

/**
 * Organizer section content.
 *
 * @param {Object}   props             Component props.
 * @param {number}   props.eventDateId Event date ID.
 * @param {Function} props.setTabDirty Reports unsaved edits to the host page.
 * @param {Function} props.getTabDraft Reads edits parked while another tab was open.
 * @param {Function} props.setTabDraft Parks edits with the host page.
 * @return {JSX.Element} The section.
 */
export default function EventOrganizer( {
	eventDateId,
	setTabDirty,
	getTabDraft,
	setTabDraft,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	// Last loaded or saved response; null until loaded.
	const [ saved, setSaved ] = useState( null );
	const [ selected, setSelected ] = useState( DEFAULT_ORGANIZER_ID );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const savingRef = useRef( false );

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setLoadError( null );

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/organizer`,
		} )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				setSaved( data );
				// A choice parked when the organizer switched tabs wins over
				// what was just loaded.
				const draft = getTabDraft?.( DIRTY_KEY );
				setSelected(
					draft && ! data.series_event_date_id
						? draft.selected
						: data.organizer_id
				);
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The organizer could not be loaded.',
								'fair-events-experimental'
							)
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setLoading( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ eventDateId, getTabDraft, reloadKey ] );

	const isSeriesDate = !! saved?.series_event_date_id;
	const dirty = !! saved && ! isSeriesDate && selected !== saved.organizer_id;

	useEffect( () => {
		setTabDirty?.( DIRTY_KEY, dirty );
	}, [ dirty, setTabDirty ] );

	// Park an unsaved choice with the host page, which outlives this tab.
	useEffect( () => {
		if ( ! saved ) {
			return;
		}
		setTabDraft?.( DIRTY_KEY, dirty ? { selected } : undefined );
	}, [ dirty, selected, saved, setTabDraft ] );

	const handleSave = async () => {
		if ( savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setSaving( true );
		setError( null );
		setSuccess( null );

		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/organizer`,
				method: 'PUT',
				data: { organizer_id: selected },
			} );
			setSaved( data );
			setSelected( data.organizer_id );
			setSuccess(
				DEFAULT_ORGANIZER_ID === data.organizer_id
					? __(
							'Organizer saved. This event uses the sitewide organizer.',
							'fair-events-experimental'
						)
					: __( 'Organizer saved.', 'fair-events-experimental' )
			);
		} catch ( err ) {
			setError(
				err?.message ||
					__(
						'The organizer could not be saved. Try again.',
						'fair-events-experimental'
					)
			);
		} finally {
			savingRef.current = false;
			setSaving( false );
		}
	};

	if ( loading ) {
		return (
			<BaseControl
				label={ __( 'Organizer', 'fair-events-experimental' ) }
				__nextHasNoMarginBottom
			>
				<div>
					<Spinner />
				</div>
			</BaseControl>
		);
	}

	if ( loadError ) {
		return (
			<VStack spacing={ 2 }>
				<Notice status="error" isDismissible={ false }>
					{ loadError }
				</Notice>
				<div>
					<Button
						variant="secondary"
						onClick={ () => setReloadKey( ( key ) => key + 1 ) }
					>
						{ __( 'Try again', 'fair-events-experimental' ) }
					</Button>
				</div>
			</VStack>
		);
	}

	const organizers = saved.organizers || [];
	const findOrganizer = ( id ) => organizers.find( ( o ) => o.id === id );
	const savedMissing = ! findOrganizer( saved.organizer_id );

	const missingNotice = savedMissing && (
		<Notice status="warning" isDismissible={ false }>
			{ __(
				'The organizer chosen for this event is no longer available, so the sitewide organizer is shown publicly. Choose another organizer to replace it.',
				'fair-events-experimental'
			) }
		</Notice>
	);

	if ( isSeriesDate ) {
		const effective = findOrganizer( saved.effective_organizer_id );
		return (
			<VStack spacing={ 2 }>
				{ missingNotice }
				<p style={ { margin: 0, overflowWrap: 'anywhere' } }>
					{ sprintf(
						/* translators: %s: organizer name. */
						__( 'Organizer: %s', 'fair-events-experimental' ),
						effective
							? organizerLabel( effective )
							: __(
									'Sitewide default',
									'fair-events-experimental'
								)
					) }
				</p>
				<p style={ { margin: 0, color: '#757575' } }>
					{ __(
						'This date is part of a series. All its dates share the series’ organizer, which is chosen on the series.',
						'fair-events-experimental'
					) }
				</p>
				<div>
					<Button
						variant="secondary"
						href={ manageEventUrl( saved.series_event_date_id ) }
					>
						{ __(
							'Choose the organizer on the series',
							'fair-events-experimental'
						) }
					</Button>
				</div>
			</VStack>
		);
	}

	return (
		<VStack spacing={ 2 }>
			{ missingNotice }
			<OrganizerSelect
				organizers={ organizers }
				value={ selected }
				unavailableId={ savedMissing ? saved.organizer_id : undefined }
				onChange={ ( value ) => {
					setSelected( value );
					setSuccess( null );
				} }
				disabled={ saving }
				help={ __(
					'The organizer named for this event in search results and other public event information. All dates of a series share it. Saved separately from the other event details.',
					'fair-events-experimental'
				) }
			/>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			{ success && (
				<Notice status="success" onRemove={ () => setSuccess( null ) }>
					{ success }
				</Notice>
			) }
			<div>
				<Button
					variant="secondary"
					onClick={ handleSave }
					isBusy={ saving }
					disabled={ saving }
					__next40pxDefaultSize
				>
					{ saving
						? __( 'Saving…', 'fair-events-experimental' )
						: __( 'Save organizer', 'fair-events-experimental' ) }
				</Button>
			</div>
		</VStack>
	);
}
