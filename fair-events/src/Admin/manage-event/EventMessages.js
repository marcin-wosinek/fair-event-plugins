/**
 * Event Messages Component
 *
 * Edits the organizer's own message added to the booking confirmation email
 * (issue #2126). A series has one message, edited on the series; its dates
 * show it read-only with a link there.
 *
 * @package FairEvents
 */

import {
	forwardRef,
	RawHTML,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { isLinkOnlyEvent } from 'fair-events-shared/src/event-utils.js';

const TAB_NAME = 'messages';

/**
 * Classic WordPress editor (TinyMCE with a Code view, or a plain textarea
 * when the editor scripts are unavailable) reporting every edit through
 * `onChange`, so the draft lives in React state. A `value` the editor did
 * not produce itself (the saved, sanitized message) is written back into it.
 *
 * The ref exposes `read()`: the Code view can change the textarea without
 * an event, so saving reads the editor directly.
 *
 * Follows fair-audience's custom-mail ContentEditor lifecycle, without its
 * mailing-specific link placeholders.
 *
 * @param {Object}   props          Component props.
 * @param {string}   props.id       Textarea ID.
 * @param {string}   props.value    Draft HTML.
 * @param {Function} props.onChange Called with the next HTML.
 * @param {boolean}  props.disabled Whether editing is locked.
 * @param {string}   props.helpId   ID of the help text describing the editor.
 * @return {JSX.Element} The editor.
 */
const MessageEditor = forwardRef( function MessageEditor(
	{ id, value, onChange, disabled, helpId },
	ref
) {
	const textareaRef = useRef( null );
	const lastEmitted = useRef( value );
	const onChangeRef = useRef( onChange );
	onChangeRef.current = onChange;

	const read = () => {
		const editor = window.tinymce ? window.tinymce.get( id ) : null;
		if ( editor && ! editor.isHidden() ) {
			return editor.getContent();
		}
		return textareaRef.current ? textareaRef.current.value : '';
	};

	const emit = () => {
		const next = read();
		lastEmitted.current = next;
		onChangeRef.current( next );
	};

	useImperativeHandle( ref, () => ( { read } ) );

	// Mount the classic editor on the textarea.
	useEffect( () => {
		if ( ! window.wp || ! window.wp.editor ) {
			return undefined;
		}

		window.wp.editor.initialize( id, {
			tinymce: {
				toolbar1:
					'bold,italic,bullist,numlist,link,unlink,removeformat',
				plugins: 'lists,link',
				branding: false,
				menubar: false,
				statusbar: false,
				setup: ( editor ) => {
					editor.on( 'change keyup input undo redo', emit );
				},
			},
			quicktags: true,
			mediaButtons: false,
		} );

		return () => window.wp.editor.remove( id );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ id ] );

	// Write a value the editor did not produce itself back into it.
	useEffect( () => {
		if ( value === lastEmitted.current ) {
			return;
		}
		lastEmitted.current = value;
		const editor = window.tinymce ? window.tinymce.get( id ) : null;
		if ( editor ) {
			editor.setContent( value );
		}
		if ( textareaRef.current ) {
			textareaRef.current.value = value;
		}
	}, [ id, value ] );

	// Lock the visual editor while a save is in flight.
	useEffect( () => {
		const editor = window.tinymce ? window.tinymce.get( id ) : null;
		if ( editor && editor.setMode ) {
			editor.setMode( disabled ? 'readonly' : 'design' );
		}
	}, [ id, disabled ] );

	return (
		<div className="fair-events-booking-message__editor">
			<label
				htmlFor={ id }
				className="fair-events-booking-message__label"
			>
				{ __( 'Message', 'fair-events' ) }
			</label>
			<textarea
				id={ id }
				ref={ textareaRef }
				rows={ 10 }
				defaultValue={ value }
				onChange={ emit }
				disabled={ disabled }
				aria-describedby={ helpId }
				style={ { width: '100%' } }
			/>
		</div>
	);
} );

/**
 * Messages tab of the Manage Event page.
 *
 * @param {Object}   props                Component props.
 * @param {number}   props.eventDateId    Event date ID.
 * @param {Object}   props.eventDate      Loaded event date.
 * @param {string}   props.manageEventUrl Manage Event page URL.
 * @param {Function} props.setTabDirty    Marks this tab as holding unsaved edits.
 * @param {Function} props.getTabDraft    Reads edits parked while another tab was open.
 * @param {Function} props.setTabDraft    Parks edits with the host page.
 * @return {JSX.Element} The tab content.
 */
export default function EventMessages( {
	eventDateId,
	eventDate,
	manageEventUrl,
	setTabDirty,
	getTabDraft,
	setTabDraft,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ value, setValue ] = useState( '' );
	// Message as last loaded or saved; null until loaded.
	const [ savedValue, setSavedValue ] = useState( null );
	const [ seriesEventDateId, setSeriesEventDateId ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	const savingRef = useRef( false );
	const editorRef = useRef( null );

	const linkOnly = isLinkOnlyEvent( eventDate );
	const editorId = `fair-events-booking-message-${ eventDateId }`;
	const helpId = `${ editorId }-help`;

	useEffect( () => {
		if ( linkOnly ) {
			setLoading( false );
			return undefined;
		}

		let cancelled = false;
		setLoading( true );
		setLoadError( null );

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/booking-message`,
		} )
			.then( ( data ) => {
				if ( cancelled ) {
					return;
				}
				const message = data.message || '';
				setSeriesEventDateId( data.series_event_date_id || null );

				// Unsaved edits parked when the organizer switched tabs win
				// over what was just loaded.
				const draft = getTabDraft?.( TAB_NAME );
				if ( draft && ! data.series_event_date_id ) {
					setValue( draft.value );
					setSavedValue( draft.savedValue );
				} else {
					setValue( message );
					setSavedValue( message );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The message could not be loaded.',
								'fair-events'
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
	}, [ eventDateId, linkOnly, getTabDraft, reloadKey ] );

	const dirty = savedValue !== null && value !== savedValue;

	useEffect( () => {
		setTabDirty?.( TAB_NAME, dirty );
	}, [ dirty, setTabDirty ] );

	// Park unsaved edits with the host page, which outlives this tab.
	useEffect( () => {
		if ( savedValue === null ) {
			return;
		}
		setTabDraft?.( TAB_NAME, dirty ? { value, savedValue } : undefined );
	}, [ dirty, value, savedValue, setTabDraft ] );

	const handleChange = useCallback( ( next ) => {
		setValue( next );
		setSuccess( null );
	}, [] );

	const handleSave = async () => {
		if ( savingRef.current ) {
			return;
		}
		savingRef.current = true;

		const message = editorRef.current ? editorRef.current.read() : value;

		setSaving( true );
		setError( null );
		setSuccess( null );

		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/booking-message`,
				method: 'PUT',
				data: { message },
			} );
			const saved = data.message || '';
			setValue( saved );
			setSavedValue( saved );
			setSuccess(
				saved
					? __(
							'Message saved. It will be added to confirmation emails for new bookings.',
							'fair-events'
						)
					: __(
							'Message removed. New bookings get the standard confirmation email.',
							'fair-events'
						)
			);
		} catch ( err ) {
			setError(
				err?.message ||
					__(
						'The message could not be saved. Try again.',
						'fair-events'
					)
			);
		} finally {
			savingRef.current = false;
			setSaving( false );
		}
	};

	const seriesUrl =
		seriesEventDateId && manageEventUrl
			? `${ manageEventUrl }&event_date_id=${ seriesEventDateId }&tab=${ TAB_NAME }`
			: '';

	const renderBody = () => {
		if ( linkOnly ) {
			return (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'This event links to a page elsewhere, so bookings are not made here and there is no confirmation email to add a message to.',
						'fair-events'
					) }
				</Notice>
			);
		}

		if ( loading ) {
			return <Spinner />;
		}

		if ( loadError ) {
			return (
				<VStack spacing={ 3 }>
					<Notice status="error" isDismissible={ false }>
						{ loadError }
					</Notice>
					<div>
						<Button
							variant="secondary"
							onClick={ () => setReloadKey( ( key ) => key + 1 ) }
						>
							{ __( 'Try again', 'fair-events' ) }
						</Button>
					</div>
				</VStack>
			);
		}

		if ( seriesEventDateId ) {
			return (
				<VStack spacing={ 4 }>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'This date is part of a series. All its dates share the series’ message, which is edited on the series.',
							'fair-events'
						) }
					</Notice>
					{ value ? (
						<div className="fair-events-booking-message__preview">
							<RawHTML>{ value }</RawHTML>
						</div>
					) : (
						<p>
							{ __(
								'The series has no message. Bookings get the standard confirmation email.',
								'fair-events'
							) }
						</p>
					) }
					{ seriesUrl && (
						<div>
							<Button variant="secondary" href={ seriesUrl }>
								{ __(
									'Edit the message on the series',
									'fair-events'
								) }
							</Button>
						</div>
					) }
				</VStack>
			);
		}

		return (
			<VStack spacing={ 4 }>
				<p id={ helpId } style={ { margin: 0 } }>
					{ __(
						'This message is added to the confirmation email people get after a successful booking: right away for free bookings, and once payment is confirmed for paid ones. Leave it empty to send the standard confirmation only.',
						'fair-events'
					) }
				</p>
				<MessageEditor
					ref={ editorRef }
					id={ editorId }
					value={ value }
					onChange={ handleChange }
					disabled={ saving }
					helpId={ helpId }
				/>
				<p style={ { margin: 0, color: '#646970' } }>
					{ __(
						'Saving does not email anyone who has already booked; the message applies to bookings confirmed from now on.',
						'fair-events'
					) }
				</p>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				{ success && (
					<Notice
						status="success"
						onRemove={ () => setSuccess( null ) }
					>
						{ success }
					</Notice>
				) }
				<div>
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ saving }
						disabled={ saving }
						__next40pxDefaultSize
					>
						{ saving
							? __( 'Saving…', 'fair-events' )
							: __( 'Save message', 'fair-events' ) }
					</Button>
				</div>
			</VStack>
		);
	};

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>{ __( 'Booking confirmation message', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>{ renderBody() }</CardBody>
		</Card>
	);
}
