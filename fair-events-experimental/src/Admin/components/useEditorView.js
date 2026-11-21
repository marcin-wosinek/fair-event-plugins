/**
 * WordPress dependencies
 */
import { useEffect, useRef } from '@wordpress/element';

/**
 * Shared behaviour of the list/editor admin pages (organizers, team members).
 *
 * Derives whether the open editor has unsaved edits, warns before leaving the
 * page while it does, and moves focus to the heading of the view that just
 * opened: set `focusTarget.current` to `'editor'` or `'list'` before changing
 * the editor state.
 *
 * @param {Object|null} editor Editor state with `draft` and `saved`, or null.
 * @return {Object} `{ isDirty, focusTarget, listHeadingRef, editorHeadingRef }`.
 */
export default function useEditorView( editor ) {
	const listHeadingRef = useRef( null );
	const editorHeadingRef = useRef( null );
	const focusTarget = useRef( null );

	const isDirty =
		!! editor &&
		JSON.stringify( editor.draft ) !== JSON.stringify( editor.saved );

	// Warn before leaving the page with unsaved edits.
	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}
		const onBeforeUnload = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', onBeforeUnload );
		return () =>
			window.removeEventListener( 'beforeunload', onBeforeUnload );
	}, [ isDirty ] );

	// Move focus to the heading of the view that just opened.
	useEffect( () => {
		const target =
			'editor' === focusTarget.current
				? editorHeadingRef.current
				: listHeadingRef.current;
		if ( focusTarget.current && target ) {
			target.focus();
		}
		focusTarget.current = null;
	}, [ editor ] );

	return { isDirty, focusTarget, listHeadingRef, editorHeadingRef };
}
