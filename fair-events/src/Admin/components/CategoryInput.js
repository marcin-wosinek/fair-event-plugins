/**
 * CategoryInput — the category token field shared by the Quick Add popup
 * and Manage Event (#2292).
 *
 * Selection is controlled by category IDs, never by display names, so
 * same-named categories from different languages stay distinct. Each token
 * and suggestion reads "Name — Language" when the category carries language
 * metadata, and the plain name otherwise. When two categories still share
 * a complete label, those entries also show their term ID.
 *
 * The parent screens own fetching and saving: they pass the known
 * categories (see mergeCategories) and the selected IDs. Passing `onCreate`
 * lets typed names that match no category become new categories; without
 * it the input only selects existing ones.
 *
 * @package FairEvents
 */

import { useRef, useState, useMemo } from '@wordpress/element';
import { FormTokenField } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

/**
 * Display label for one category: "Name — Language" when the language is
 * known (#1636), otherwise the plain name.
 *
 * @param {Object} category Category with `name` and optional `language`.
 * @return {string} Label.
 */
export function getCategoryLabel( category ) {
	return category.language
		? sprintf(
				/* translators: 1: category name, 2: language name */
				__( '%1$s — %2$s', 'fair-events' ),
				category.name,
				category.language
			)
		: category.name;
}

/**
 * Merges incoming categories into the known list by ID.
 *
 * A category already known never disappears because a later response
 * omitted it, and a language-less record (the saved event's own
 * `categories` field) never overwrites one that already has a language,
 * whichever request lands last (#1636).
 *
 * @param {Array} previous Known categories.
 * @param {Array} incoming Categories from a response.
 * @return {Array} Merged categories.
 */
export function mergeCategories( previous, incoming ) {
	const byId = new Map( previous.map( ( c ) => [ c.id, c ] ) );
	( incoming || [] ).forEach( ( c ) => {
		const existing = byId.get( c.id );
		if ( existing?.language && ! c.language ) {
			return;
		}
		byId.set( c.id, c );
	} );
	return Array.from( byId.values() );
}

/**
 * Builds the ID ↔ label maps for the token field. Labels that would still
 * collide get their term ID appended, so no token is ambiguous.
 *
 * @param {Array} categories  Known categories.
 * @param {Array} selectedIds Selected category IDs.
 * @return {Object} `labelById`, `idByLabel` maps and `suggestions` list.
 */
export function buildCategoryOptions( categories, selectedIds = [] ) {
	const counts = new Map();
	categories.forEach( ( c ) => {
		const label = getCategoryLabel( c );
		counts.set( label, ( counts.get( label ) || 0 ) + 1 );
	} );

	const labelById = new Map();
	const idByLabel = new Map();
	const suggestions = [];
	categories.forEach( ( c ) => {
		let label = getCategoryLabel( c );
		if ( counts.get( label ) > 1 ) {
			label = sprintf(
				/* translators: 1: category label, 2: category term ID */
				__( '%1$s (ID %2$d)', 'fair-events' ),
				label,
				c.id
			);
		}
		labelById.set( c.id, label );
		idByLabel.set( label, c.id );
		suggestions.push( label );
	} );

	// A selected category that no response has described yet (still
	// loading, or the request failed) keeps a token so it is neither
	// hidden nor dropped by an unrelated edit.
	selectedIds.forEach( ( id ) => {
		if ( labelById.has( id ) ) {
			return;
		}
		const label = sprintf(
			/* translators: %d: category term ID */
			__( 'Category ID %d', 'fair-events' ),
			id
		);
		labelById.set( id, label );
		idByLabel.set( label, id );
	} );

	return { labelById, idByLabel, suggestions };
}

const unique = ( ids ) => Array.from( new Set( ids ) );

export default function CategoryInput( {
	value,
	categories,
	onChange,
	onCreate,
	label = __( 'Categories', 'fair-events' ),
} ) {
	// Names typed into the field that are being created (Manage Event only).
	const [ pending, setPending ] = useState( [] );
	const pendingRef = useRef( pending );
	const valueRef = useRef( value );
	valueRef.current = value;
	const requestsRef = useRef( new Set() );

	const { labelById, idByLabel, suggestions } = useMemo(
		() => buildCategoryOptions( categories, value ),
		[ categories, value ]
	);

	const updatePending = ( next ) => {
		pendingRef.current = next;
		setPending( next );
	};

	const emitChange = ( ids ) => {
		valueRef.current = ids;
		onChange( ids );
	};

	const startCreate = ( name ) => {
		// One request per name, however often its token is re-added
		// while the first request is still running.
		if ( requestsRef.current.has( name ) ) {
			return;
		}
		requestsRef.current.add( name );
		Promise.resolve()
			.then( () => onCreate( name ) )
			.then(
				( created ) => {
					// A token removed while its request ran stays removed.
					if ( ! pendingRef.current.includes( name ) ) {
						return;
					}
					updatePending(
						pendingRef.current.filter( ( n ) => n !== name )
					);
					if ( created && created.id ) {
						emitChange(
							unique( [ ...valueRef.current, created.id ] )
						);
					}
				},
				() => {
					// The parent reports the error.
					updatePending(
						pendingRef.current.filter( ( n ) => n !== name )
					);
				}
			)
			.finally( () => {
				requestsRef.current.delete( name );
			} );
	};

	const handleChange = ( tokens ) => {
		const ids = [];
		const names = [];
		tokens.forEach( ( token ) => {
			const text = typeof token === 'string' ? token : token.value;
			if ( idByLabel.has( text ) ) {
				ids.push( idByLabel.get( text ) );
			} else if ( onCreate && text.trim() ) {
				names.push( text.trim() );
			}
		} );

		const nextPending = unique( names );
		const added = nextPending.filter(
			( name ) => ! pendingRef.current.includes( name )
		);
		updatePending( nextPending );
		emitChange( unique( ids ) );
		added.forEach( startCreate );
	};

	return (
		<FormTokenField
			label={ label }
			value={ [
				...value.map( ( id ) => labelById.get( id ) ),
				...pending,
			] }
			suggestions={ suggestions }
			onChange={ handleChange }
			__experimentalValidateInput={
				onCreate ? undefined : ( token ) => idByLabel.has( token )
			}
			__experimentalExpandOnFocus
		/>
	);
}
