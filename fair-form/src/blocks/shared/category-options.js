/**
 * Category-based choices for the Select One and Multiselect questions
 * (#1999): the editor side of FairForm\Services\QuestionOptions.
 *
 * The question stores only where its choices come from (`optionSource`) and,
 * for subcategories, the parent's term ID. The public render resolves the
 * category names on every page load; the editor resolves the same scope here
 * for its preview and for Conditional Section values.
 *
 * @package FairForm
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import apiFetch from '@wordpress/api-fetch';

export const SOURCE_MANUAL = 'manual';
export const SOURCE_CATEGORIES = 'categories';
export const SOURCE_CATEGORY_CHILDREN = 'categoryChildren';

const CATEGORIES_PER_PAGE = 100;

/**
 * Whether a question takes its choices from categories.
 *
 * @param {Object} attributes Question block attributes.
 * @return {boolean} True for either category source.
 */
export function isCategorySource( attributes ) {
	return (
		attributes?.optionSource === SOURCE_CATEGORIES ||
		attributes?.optionSource === SOURCE_CATEGORY_CHILDREN
	);
}

/**
 * Load every post category, following the REST pagination past 100 terms.
 *
 * @return {Promise<Array<{id: number, name: string, parent: number}>>} Categories.
 */
export async function fetchAllCategories() {
	const categories = [];
	let page = 1;
	let totalPages = 1;
	do {
		const response = await apiFetch( {
			path: `/wp/v2/categories?per_page=${ CATEGORIES_PER_PAGE }&page=${ page }&orderby=name&order=asc&_fields=id,name,parent`,
			parse: false,
		} );
		totalPages =
			parseInt( response.headers.get( 'X-WP-TotalPages' ), 10 ) || 1;
		categories.push( ...( await response.json() ) );
		page++;
	} while ( page <= totalPages );
	return categories;
}

/**
 * Categories for an editor component, loaded only while `enabled`.
 *
 * @param {boolean} enabled Whether categories are needed.
 * @return {{status: string, categories: Array, retry: Function}} Load state:
 *         `idle`, `loading`, `success` or `error`.
 */
export function useCategories( enabled ) {
	const [ state, setState ] = useState( {
		status: 'idle',
		categories: [],
	} );
	const [ attempt, setAttempt ] = useState( 0 );

	useEffect( () => {
		if ( ! enabled ) {
			setState( { status: 'idle', categories: [] } );
			return;
		}
		let cancelled = false;
		setState( { status: 'loading', categories: [] } );
		fetchAllCategories()
			.then( ( categories ) => {
				if ( ! cancelled ) {
					setState( { status: 'success', categories } );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( { status: 'error', categories: [] } );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ enabled, attempt ] );

	const retry = useCallback( () => setAttempt( ( n ) => n + 1 ), [] );

	return { ...state, retry };
}

/**
 * Choices a category-backed question offers, mirroring the server: all
 * categories, or every descendant of the parent (excluding the parent).
 * A missing parent yields no choices, never every category.
 *
 * @param {Array}  categories Categories from fetchAllCategories().
 * @param {Object} attributes Question block attributes.
 * @return {{status: string, choices: string[]}} `ready`, `empty`,
 *         `no-parent` (none chosen yet) or `missing-parent`.
 */
export function resolveCategoryChoices( categories, attributes ) {
	let scope = categories;

	if ( attributes.optionSource === SOURCE_CATEGORY_CHILDREN ) {
		const parentId = attributes.parentCategoryId || 0;
		if ( ! parentId ) {
			return { status: 'no-parent', choices: [] };
		}
		if ( ! categories.some( ( category ) => category.id === parentId ) ) {
			return { status: 'missing-parent', choices: [] };
		}
		const inScope = new Set( [ parentId ] );
		scope = [];
		let added = true;
		while ( added ) {
			added = false;
			for ( const category of categories ) {
				if (
					! inScope.has( category.id ) &&
					inScope.has( category.parent )
				) {
					inScope.add( category.id );
					scope.push( category );
					added = true;
				}
			}
		}
	}

	const choices = [
		...new Set(
			scope
				.map( ( category ) => decodeEntities( category.name ) )
				.filter( Boolean )
		),
	].sort( ( a, b ) => a.localeCompare( b ) );

	return { status: choices.length > 0 ? 'ready' : 'empty', choices };
}

/**
 * Category name with its ancestors ("Workshops › Circus"), so same-named
 * subcategories stay distinguishable in the parent picker.
 *
 * @param {Object} category   Category to label.
 * @param {Array}  categories All categories.
 * @return {string} Path label.
 */
export function categoryPath( category, categories ) {
	const byId = new Map( categories.map( ( c ) => [ c.id, c ] ) );
	const names = [ decodeEntities( category.name ) ];
	const seen = new Set( [ category.id ] );
	let parent = byId.get( category.parent );
	while ( parent && ! seen.has( parent.id ) ) {
		names.unshift( decodeEntities( parent.name ) );
		seen.add( parent.id );
		parent = byId.get( parent.parent );
	}
	return names.join( ' › ' );
}
