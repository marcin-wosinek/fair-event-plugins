/**
 * Shared category selector for the Events Calendar, Events Week, and Events
 * List blocks.
 *
 * Loads categories from every configured Polylang language (falling back to
 * the plain category list on sites without Polylang) so an editor can select
 * same-named categories from different languages independently — see #1627.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import { CheckboxControl, Spinner, Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * @param {Object}   props
 * @param {number[]} props.selectedCategories - Array of selected category term IDs.
 * @param {Function} props.onChange           - Callback when selection changes: (ids: number[]) => void
 */
export default function CategorySelector( {
	selectedCategories = [],
	onChange,
} ) {
	const [ categories, setCategories ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( {
			path: '/fair-events/v1/sources/categories?all_languages=true',
		} )
			.then( ( data ) => {
				setCategories( data );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError(
					err.message ||
						__( 'Failed to load categories.', 'fair-events' )
				);
				setLoading( false );
			} );
	}, [] );

	const handleToggle = ( categoryId, checked ) => {
		const newSelection = checked
			? [ ...selectedCategories, categoryId ]
			: selectedCategories.filter( ( id ) => id !== categoryId );
		onChange( newSelection );
	};

	const meaningfulCategories = categories.filter(
		( cat ) => cat.slug !== 'uncategorized'
	);

	return (
		<div style={ { marginTop: '16px' } }>
			<strong>{ __( 'Categories', 'fair-events' ) }</strong>
			{ loading && <Spinner /> }
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			{ ! loading && ! error && meaningfulCategories.length === 0 && (
				<p style={ { fontStyle: 'italic', color: '#757575' } }>
					{ __(
						'Define more categories if you want to use category filtering',
						'fair-events'
					) }
				</p>
			) }
			{ ! loading &&
				! error &&
				meaningfulCategories.length > 0 &&
				meaningfulCategories.map( ( cat ) => (
					<CheckboxControl
						key={ cat.id }
						label={
							cat.language
								? sprintf(
										/* translators: 1: category name, 2: language name */
										__( '%1$s — %2$s', 'fair-events' ),
										cat.name,
										cat.language
								  )
								: cat.name
						}
						checked={ selectedCategories.includes( cat.id ) }
						onChange={ ( checked ) =>
							handleToggle( cat.id, checked )
						}
					/>
				) ) }
		</div>
	);
}
