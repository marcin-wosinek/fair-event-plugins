/**
 * WordPress dependencies
 */
import {
	createContext,
	useCallback,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';

/**
 * Unsaved drafts of every notification, by configuration ID, for as long as
 * the page is open. An editor left for the list or the history keeps its
 * draft here and finds it again when it is opened.
 *
 * Without a provider, as in a single editor, each editor keeps its draft to
 * itself and guards it against leaving the page on its own.
 */
export const DraftsContext = createContext( null );

/**
 * The page's draft store.
 *
 * @return {Object} `store` for DraftsContext, and `dirty`, the IDs of
 *     notifications with unsaved changes.
 */
export function useDraftStore() {
	const drafts = useRef( {} );
	const [ dirty, setDirty ] = useState( [] );

	const get = useCallback( ( id ) => drafts.current[ id ], [] );
	const set = useCallback( ( id, draft, isDirty ) => {
		drafts.current[ id ] = draft;
		setDirty( ( current ) => {
			if ( isDirty === current.includes( id ) ) {
				return current;
			}
			return isDirty
				? [ ...current, id ]
				: current.filter( ( shown ) => shown !== id );
		} );
	}, [] );

	const store = useMemo( () => ( { get, set } ), [ get, set ] );
	return { store, dirty };
}
