/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useState,
} from '@wordpress/element';
import { Button, TextControl, Spinner } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';
import useClassicEmailEditor from 'fair-events-shared/src/useClassicEmailEditor.js';

/**
 * Email body editor.
 *
 * The classic editor lifecycle (TinyMCE, with a plain textarea when it is
 * unavailable) comes from the shared `useClassicEmailEditor`: every edit is
 * reported through `onChange`, so the draft lives in the page's React state,
 * and a `value` the editor did not produce itself (cleared draft, duplicated
 * message) is written back into it. The page and event link insertion stays
 * here.
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
 * @return {JSX.Element} The editor.
 */
const ContentEditor = forwardRef( function ContentEditor(
	{ id, value, onChange, disabled, eventSelected },
	ref
) {
	const { textareaRef, read, emit, getVisualEditor } = useClassicEmailEditor(
		{ id, value, onChange, disabled }
	);

	const [ pageSearch, setPageSearch ] = useState( '' );
	const [ pageResults, setPageResults ] = useState( [] );
	const [ selectedPage, setSelectedPage ] = useState( null );
	const [ isSearchingPages, setIsSearchingPages ] = useState( false );

	useImperativeHandle( ref, () => ( { read } ), [ read ] );

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
