import './category-options.css';

/**
 * Editor controls shared by the Select One and Multiselect questions for
 * choosing where their choices come from (#1999).
 *
 * Switching to a category source keeps the typed option blocks: they are
 * hidden, not removed, and come back when the question returns to typed
 * options.
 *
 * @package FairForm
 */

import {
	PanelBody,
	SelectControl,
	ComboboxControl,
	Notice,
	Button,
	Spinner,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	SOURCE_MANUAL,
	SOURCE_CATEGORIES,
	SOURCE_CATEGORY_CHILDREN,
	isCategorySource,
	resolveCategoryChoices,
	categoryPath,
} from './category-options.js';

const PREVIEW_LIMIT = 10;

const SOURCE_OPTIONS = [
	{
		label: __( 'Options typed in the question', 'fair-form' ),
		value: SOURCE_MANUAL,
	},
	{
		label: __( 'All post categories', 'fair-form' ),
		value: SOURCE_CATEGORIES,
	},
	{
		label: __( 'Subcategories of one category', 'fair-form' ),
		value: SOURCE_CATEGORY_CHILDREN,
	},
];

/**
 * Inspector panel: the option source and, for subcategories, the parent.
 *
 * @param {Object}   props
 * @param {Object}   props.attributes      Question block attributes.
 * @param {Function} props.setAttributes   Block attribute setter.
 * @param {Object}   props.categoriesState Result of useCategories().
 */
export function OptionSourcePanel( {
	attributes,
	setAttributes,
	categoriesState,
} ) {
	const { optionSource = SOURCE_MANUAL, parentCategoryId = 0 } = attributes;
	const { categories } = categoriesState;
	const parentOptions = categories
		.map( ( category ) => ( {
			value: String( category.id ),
			label: categoryPath( category, categories ),
		} ) )
		.sort( ( a, b ) => a.label.localeCompare( b.label ) );

	return (
		<PanelBody title={ __( 'Choices', 'fair-form' ) }>
			<SelectControl
				label={ __( 'Where do the choices come from?', 'fair-form' ) }
				value={ optionSource }
				options={ SOURCE_OPTIONS }
				onChange={ ( value ) =>
					setAttributes( { optionSource: value } )
				}
				help={
					isCategorySource( attributes )
						? __(
								'Choices follow your categories as they are added, renamed or removed. Each answer keeps the category name the visitor picked. To turn this question into radio buttons, switch back to typed options first.',
								'fair-form'
							)
						: undefined
				}
			/>
			{ optionSource === SOURCE_CATEGORY_CHILDREN && (
				<ComboboxControl
					label={ __( 'Parent category', 'fair-form' ) }
					value={ parentCategoryId ? String( parentCategoryId ) : '' }
					options={ parentOptions }
					onChange={ ( value ) =>
						setAttributes( {
							parentCategoryId: value ? parseInt( value, 10 ) : 0,
						} )
					}
					help={ __(
						'All of its subcategories, at every level, become choices. The parent itself is not one.',
						'fair-form'
					) }
				/>
			) }
		</PanelBody>
	);
}

/**
 * In-canvas preview of the category choices, with the loading, error,
 * missing-parent and empty states the editor needs to see.
 *
 * @param {Object} props
 * @param {Object} props.attributes        Question block attributes.
 * @param {Object} props.categoriesState   Result of useCategories().
 * @param {number} props.manualOptionCount Typed option blocks kept aside.
 */
export function CategoryChoicesPreview( {
	attributes,
	categoriesState,
	manualOptionCount = 0,
} ) {
	const { status, categories, retry } = categoriesState;
	const keptNote =
		manualOptionCount > 0 ? (
			<p className="fair-form-category-choices__kept">
				{ sprintf(
					/* translators: %d: number of typed options */
					_n(
						'Your %d typed option is kept. Switch back to typed options to use it again.',
						'Your %d typed options are kept. Switch back to typed options to use them again.',
						manualOptionCount,
						'fair-form'
					),
					manualOptionCount
				) }
			</p>
		) : null;

	let body;
	if ( status === 'error' ) {
		body = (
			<Notice status="error" isDismissible={ false }>
				{ __(
					'The categories could not be loaded. Check your connection and try again.',
					'fair-form'
				) }{ ' ' }
				<Button variant="link" onClick={ retry }>
					{ __( 'Try again', 'fair-form' ) }
				</Button>
			</Notice>
		);
	} else if ( status !== 'success' ) {
		body = (
			<p>
				<Spinner /> { __( 'Loading categories…', 'fair-form' ) }
			</p>
		);
	} else {
		const { status: scopeStatus, choices } = resolveCategoryChoices(
			categories,
			attributes
		);
		if ( scopeStatus === 'no-parent' ) {
			body = (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'Choose a parent category in the block settings. Until then, visitors see no choices.',
						'fair-form'
					) }
				</Notice>
			);
		} else if ( scopeStatus === 'missing-parent' ) {
			body = (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'The parent category of this question no longer exists. Choose another one in the block settings; until then, visitors see no choices.',
						'fair-form'
					) }
				</Notice>
			);
		} else if ( scopeStatus === 'empty' ) {
			body = (
				<Notice status="warning" isDismissible={ false }>
					{ attributes.optionSource === SOURCE_CATEGORY_CHILDREN
						? __(
								'This category has no subcategories yet. Visitors see no choices until you add some.',
								'fair-form'
							)
						: __(
								'There are no categories yet. Visitors see no choices until you add some.',
								'fair-form'
							) }
				</Notice>
			);
		} else {
			const hidden = choices.length - PREVIEW_LIMIT;
			body = (
				<>
					<p className="fair-form-category-choices__count">
						{ sprintf(
							/* translators: %d: number of choices */
							_n(
								'%d choice from categories:',
								'%d choices from categories:',
								choices.length,
								'fair-form'
							),
							choices.length
						) }
					</p>
					<ul className="fair-form-category-choices__list">
						{ choices.slice( 0, PREVIEW_LIMIT ).map( ( choice ) => (
							<li key={ choice }>{ choice }</li>
						) ) }
					</ul>
					{ hidden > 0 && (
						<p className="fair-form-category-choices__more">
							{ sprintf(
								/* translators: %d: number of choices not listed in the preview */
								_n(
									'…and %d more.',
									'…and %d more.',
									hidden,
									'fair-form'
								),
								hidden
							) }
						</p>
					) }
				</>
			);
		}
	}

	return (
		<div className="fair-form-category-choices">
			{ body }
			{ keptNote }
		</div>
	);
}
