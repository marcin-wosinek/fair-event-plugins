/**
 * Classic email editor lifecycle shared by Fair Audience's Custom Mail and
 * Fair Events' Event Messages.
 *
 * Mounts the classic WordPress editor (TinyMCE with a Code view, or a plain
 * textarea when the editor scripts are unavailable) on a textarea and reports
 * every edit through `onChange`, so the draft lives in the caller's React
 * state rather than in the editor. A `value` the editor did not produce itself
 * (a cleared draft, a reused message, the saved and sanitized result) is
 * written back into it.
 *
 * `read()` returns the editor's current content. Callers expose it for the
 * moment of saving or sending, because the Code view can change the textarea
 * without an event.
 *
 * Presentation stays with the caller: render
 * `<textarea id={ id } ref={ textareaRef } defaultValue={ value }
 * onChange={ emit } disabled={ disabled } />` plus any labels and controls.
 *
 * @package FairEventsShared
 */

import { useCallback, useEffect, useRef } from '@wordpress/element';

/**
 * Editor settings passed to `wp.editor.initialize()`.
 *
 * @param {Function} setup TinyMCE setup callback.
 * @return {Object} Settings.
 */
const editorSettings = ( setup ) => ( {
	tinymce: {
		toolbar1: 'bold,italic,bullist,numlist,link,unlink,removeformat',
		plugins: 'lists,link',
		branding: false,
		menubar: false,
		statusbar: false,
		// TinyMCE would otherwise save its visual content into the textarea
		// when a surrounding form submits, overwriting Code-view edits just
		// before `read()` collects them. The draft lives in React state.
		add_form_submit_trigger: false,
		setup,
	},
	quicktags: true,
	mediaButtons: false,
} );

/**
 * TinyMCE instance for an editor ID, if one exists.
 *
 * @param {string} id Textarea ID.
 * @return {Object|null} The instance.
 */
const getInstance = ( id ) =>
	window.tinymce ? window.tinymce.get( id ) || null : null;

/**
 * Apply the read-only state to a TinyMCE instance.
 *
 * @param {Object}  editor   TinyMCE instance.
 * @param {boolean} disabled Whether editing is locked.
 */
const applyMode = ( editor, disabled ) => {
	if ( editor && editor.setMode ) {
		editor.setMode( disabled ? 'readonly' : 'design' );
	}
};

/**
 * Share the classic editor lifecycle for one email body textarea.
 *
 * @param {Object}   options          Options.
 * @param {string}   options.id       Textarea ID; one editor instance per ID.
 * @param {string}   options.value    Draft HTML.
 * @param {Function} options.onChange Called with the next HTML.
 * @param {boolean}  options.disabled Whether editing is locked.
 * @return {{textareaRef: Object, read: Function, emit: Function, getVisualEditor: Function}}
 *         Ref for the textarea, a reader of the current content, a reporter
 *         of the current content to `onChange`, and the visible TinyMCE
 *         instance (null in Code view or without TinyMCE).
 */
export default function useClassicEmailEditor( {
	id,
	value,
	onChange,
	disabled,
} ) {
	const textareaRef = useRef( null );
	// The newest draft known to the editor: what it last reported, or the
	// last value written into it.
	const lastEmitted = useRef( value );
	const onChangeRef = useRef( onChange );
	onChangeRef.current = onChange;
	const disabledRef = useRef( disabled );
	disabledRef.current = disabled;

	const getVisualEditor = useCallback( () => {
		const editor = getInstance( id );
		return editor && ! editor.isHidden() ? editor : null;
	}, [ id ] );

	const read = useCallback( () => {
		const editor = getVisualEditor();
		if ( editor ) {
			return editor.getContent();
		}
		return textareaRef.current ? textareaRef.current.value : '';
	}, [ getVisualEditor ] );

	const emit = useCallback( () => {
		const next = read();
		lastEmitted.current = next;
		onChangeRef.current( next );
	}, [ read ] );

	// Mount the classic editor on the textarea.
	useEffect( () => {
		if ( ! window.wp || ! window.wp.editor ) {
			return undefined;
		}
		// Remove through the API that created this instance.
		const classicEditor = window.wp.editor;

		classicEditor.initialize(
			id,
			editorSettings( ( editor ) => {
				editor.on( 'change keyup input undo redo', emit );
				// TinyMCE becomes ready after the effects below have run;
				// apply the draft and lock state current at that moment.
				editor.on( 'init', () => {
					const draft = lastEmitted.current ?? '';
					if ( editor.getContent() !== draft ) {
						editor.setContent( draft );
					}
					applyMode( editor, disabledRef.current );
				} );
			} )
		);

		return () => classicEditor.remove( id );
	}, [ id, emit ] );

	// Write a draft the editor did not produce itself back into it.
	useEffect( () => {
		if ( value === lastEmitted.current ) {
			return;
		}
		lastEmitted.current = value;
		const editor = getInstance( id );
		if ( editor ) {
			editor.setContent( value );
		}
		if ( textareaRef.current ) {
			textareaRef.current.value = value;
		}
	}, [ id, value ] );

	// Lock the visual editor while a save or send is in flight.
	useEffect( () => {
		applyMode( getInstance( id ), disabled );
	}, [ id, disabled ] );

	return { textareaRef, read, emit, getVisualEditor };
}
