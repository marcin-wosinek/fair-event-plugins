/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from '@wordpress/element';
import { Button, TextControl, Spinner } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { PHOTO_UPLOAD_PLACEHOLDER } from './mail-content.js';

/**
 * Email body editor.
 *
 * Wraps the classic WordPress editor (TinyMCE, with a plain textarea when it
 * is unavailable) and reports every edit through `onChange`, so the draft
 * lives in the page's React state rather than in the editor. A `value` the
 * editor did not produce itself (cleared draft, duplicated message) is written
 * back into it.
 *
 * The ref exposes `read()`, the editor's current content, for the moment of
 * sending: the editor's Code view can change the textarea without an event.
 *
 * @param {Object}   props               Component props.
 * @param {string}   props.id            Textarea ID.
 * @param {string}   props.value         Draft HTML.
 * @param {Function} props.onChange      Called with the next HTML.
 * @param {boolean}  props.disabled      Whether editing is locked.
 * @param {boolean}  props.eventSelected Whether an event is chosen.
 * @param {boolean}  props.photoUpload   Whether photo upload links work.
 * @return {JSX.Element} The editor.
 */
const ContentEditor = forwardRef( function ContentEditor(
	{ id, value, onChange, disabled, eventSelected, photoUpload },
	ref
) {
	const textareaRef = useRef( null );
	const lastEmitted = useRef( value );
	const onChangeRef = useRef( onChange );
	onChangeRef.current = onChange;

	const [ pageSearch, setPageSearch ] = useState( '' );
	const [ pageResults, setPageResults ] = useState( [] );
	const [ selectedPage, setSelectedPage ] = useState( null );
	const [ isSearchingPages, setIsSearchingPages ] = useState( false );

	const getVisualEditor = () => {
		const editor = window.tinymce ? window.tinymce.get( id ) : null;
		return editor && ! editor.isHidden() ? editor : null;
	};

	const read = () => {
		const editor = getVisualEditor();
		if ( editor ) {
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

	// Write a draft the editor did not produce itself back into it.
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

	// Lock the visual editor while a send is in flight.
	useEffect( () => {
		const editor = window.tinymce ? window.tinymce.get( id ) : null;
		if ( editor && editor.setMode ) {
			editor.setMode( disabled ? 'readonly' : 'design' );
		}
	}, [ id, disabled ] );

	// Search pages for the personal-link picker.
	useEffect( () => {
		if ( pageSearch.length < 2 ) {
			setPageResults( [] );
			return undefined;
		}

		let cancelled = false;
		const timeout = setTimeout( () => {
			setIsSearchingPages( true );
			apiFetch( {
				path: `/wp/v2/search?search=${ encodeURIComponent(
					pageSearch
				) }&per_page=10&_fields=id,title`,
			} )
				.then( ( results ) => {
					if ( ! cancelled ) {
						setPageResults( results || [] );
					}
				} )
				.catch( () => {
					if ( ! cancelled ) {
						setPageResults( [] );
					}
				} )
				.finally( () => {
					if ( ! cancelled ) {
						setIsSearchingPages( false );
					}
				} );
		}, 300 );

		return () => {
			cancelled = true;
			clearTimeout( timeout );
		};
	}, [ pageSearch ] );

	/**
	 * Insert a link whose address is filled in per recipient when sending.
	 * Selected text becomes the link text.
	 *
	 * @param {string} placeholder Address placeholder, e.g. '{event_page_url}'.
	 * @param {string} defaultText Link text when nothing is selected.
	 */
	const insertPlaceholderLink = ( placeholder, defaultText ) => {
		const editor = getVisualEditor();
		if ( editor ) {
			const selected = editor.selection.getContent( { format: 'text' } );
			const link = document.createElement( 'a' );
			link.setAttribute( 'href', placeholder );
			link.textContent = selected || defaultText;
			editor.execCommand( 'mceInsertContent', false, link.outerHTML );
			emit();
			return;
		}

		const textarea = textareaRef.current;
		if ( ! textarea ) {
			return;
		}
		const start = textarea.selectionStart ?? textarea.value.length;
		const end = textarea.selectionEnd ?? textarea.value.length;
		const text = textarea.value;
		const linkText = text.substring( start, end ) || defaultText;
		textarea.value =
			text.substring( 0, start ) +
			`<a href="${ placeholder }">${ linkText }</a>` +
			text.substring( end );
		emit();
	};

	return (
		<div className="fair-audience-custom-mail__editor">
			<label htmlFor={ id } className="fair-audience-custom-mail__label">
				{ __( 'Content', 'fair-audience' ) }
			</label>
			<textarea
				id={ id }
				ref={ textareaRef }
				rows={ 10 }
				defaultValue={ value }
				onChange={ emit }
				disabled={ disabled }
			/>

			<div className="fair-audience-custom-mail__links">
				{ photoUpload && (
					<Button
						variant="secondary"
						size="small"
						onClick={ () =>
							insertPlaceholderLink(
								PHOTO_UPLOAD_PLACEHOLDER,
								__( 'Upload photos', 'fair-audience' )
							)
						}
						disabled={ disabled }
					>
						{ __( 'Insert photo upload link', 'fair-audience' ) }
					</Button>
				) }
				<Button
					variant="secondary"
					size="small"
					onClick={ () =>
						insertPlaceholderLink(
							'{event_page_url}',
							__( 'Open event page', 'fair-audience' )
						)
					}
					disabled={ disabled || ! eventSelected }
					aria-describedby={
						eventSelected ? undefined : `${ id }-event-link-help`
					}
				>
					{ __( 'Insert event page link', 'fair-audience' ) }
				</Button>
				<div className="fair-audience-custom-mail__page-link">
					<TextControl
						label={ __( 'Page to link to', 'fair-audience' ) }
						hideLabelFromVision
						placeholder={ __( 'Search page…', 'fair-audience' ) }
						value={ selectedPage ? selectedPage.title : pageSearch }
						onChange={ ( next ) => {
							setPageSearch( next );
							setSelectedPage( null );
						} }
						disabled={ disabled }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					{ isSearchingPages && <Spinner /> }
					{ pageResults.length > 0 && ! selectedPage && (
						<ul className="fair-audience-custom-mail__page-results">
							{ pageResults.map( ( page ) => (
								<li key={ page.id }>
									<Button
										variant="tertiary"
										onClick={ () => {
											setSelectedPage( page );
											setPageSearch( '' );
											setPageResults( [] );
										} }
									>
										{ page.title ||
											__(
												'(untitled)',
												'fair-audience'
											) }
									</Button>
								</li>
							) ) }
						</ul>
					) }
					<Button
						variant="secondary"
						size="small"
						onClick={ () =>
							insertPlaceholderLink(
								`{token_link_${ selectedPage.id }}`,
								selectedPage.title
							)
						}
						disabled={ disabled || ! selectedPage }
					>
						{ __( 'Insert personal page link', 'fair-audience' ) }
					</Button>
				</div>
			</div>
			{ ! eventSelected && (
				<p
					id={ `${ id }-event-link-help` }
					className="fair-audience-custom-mail__help"
				>
					{ __(
						'Select an event to insert a link to its page.',
						'fair-audience'
					) }
				</p>
			) }
		</div>
	);
} );

export default ContentEditor;
