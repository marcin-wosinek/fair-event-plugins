<?php
/**
 * Question Options
 *
 * @package FairForm
 */

namespace FairForm\Services;

defined( 'WPINC' ) || die;

/**
 * Resolves the choices of a select or multiselect question: the option
 * blocks typed into the question, or post categories (#1999).
 *
 * Category choices are resolved on every render, so they follow renamed,
 * added and deleted categories. A category's name is both the label and the
 * submitted value, the same shape as a typed option, so stored answers and
 * every read path stay unchanged.
 */
class QuestionOptions {

	/**
	 * Choices come from the question's option blocks.
	 */
	const SOURCE_MANUAL = 'manual';

	/**
	 * Choices are every post category.
	 */
	const SOURCE_CATEGORIES = 'categories';

	/**
	 * Choices are every descendant of one parent category.
	 */
	const SOURCE_CATEGORY_CHILDREN = 'categoryChildren';

	/**
	 * Option source of a question, falling back to manual for content saved
	 * before the attribute existed or with an unknown value.
	 *
	 * @param array $attributes Block attributes.
	 * @return string One of the SOURCE_* constants.
	 */
	public static function get_source( array $attributes ) {
		$source = $attributes['optionSource'] ?? self::SOURCE_MANUAL;
		if ( self::SOURCE_CATEGORIES === $source || self::SOURCE_CATEGORY_CHILDREN === $source ) {
			return $source;
		}
		return self::SOURCE_MANUAL;
	}

	/**
	 * Whether the question takes its choices from categories.
	 *
	 * @param array $attributes Block attributes.
	 * @return bool
	 */
	public static function is_category_source( array $attributes ) {
		return self::SOURCE_MANUAL !== self::get_source( $attributes );
	}

	/**
	 * Choices for a question block.
	 *
	 * @param array     $attributes Block attributes.
	 * @param \WP_Block $block      Block instance, for the option blocks.
	 * @return string[] Choice values in display order.
	 */
	public static function resolve( array $attributes, $block ) {
		$source = self::get_source( $attributes );
		if ( self::SOURCE_CATEGORIES === $source ) {
			return self::category_names( array() );
		}
		if ( self::SOURCE_CATEGORY_CHILDREN === $source ) {
			return self::child_category_names( (int) ( $attributes['parentCategoryId'] ?? 0 ) );
		}
		return self::manual_options( $block );
	}

	/**
	 * Values of the question's option blocks.
	 *
	 * @param \WP_Block $block Block instance.
	 * @return string[]
	 */
	private static function manual_options( $block ) {
		$options = array();
		foreach ( $block->inner_blocks as $inner_block ) {
			if ( 'fair-audience/fair-form-option' === $inner_block->name ) {
				$value = $inner_block->attributes['value'] ?? '';
				if ( '' !== $value ) {
					$options[] = $value;
				}
			}
		}
		return $options;
	}

	/**
	 * Names of every descendant of a parent category, excluding the parent.
	 *
	 * A missing, deleted or non-category parent yields no choices; it never
	 * widens to every category.
	 *
	 * @param int $parent_id Parent category term ID.
	 * @return string[]
	 */
	private static function child_category_names( $parent_id ) {
		if ( $parent_id <= 0 ) {
			return array();
		}
		$parent = get_term( $parent_id, 'category' );
		if ( ! $parent instanceof \WP_Term ) {
			return array();
		}
		return self::category_names( array( 'child_of' => $parent_id ) );
	}

	/**
	 * Category names, alphabetical, empty categories included.
	 *
	 * Names are decoded from the entity-encoded form WordPress stores, so
	 * "Arts & Crafts" is one value everywhere. Identically named categories
	 * are indistinguishable as answers and appear once.
	 *
	 * @param array $args Extra get_terms() arguments.
	 * @return string[]
	 */
	private static function category_names( array $args ) {
		$terms = get_terms(
			array_merge(
				array(
					'taxonomy'   => 'category',
					'hide_empty' => false,
					'orderby'    => 'name',
					'order'      => 'ASC',
				),
				$args
			)
		);
		if ( is_wp_error( $terms ) ) {
			return array();
		}

		$names = array();
		foreach ( $terms as $term ) {
			$name = html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' );
			if ( '' !== $name ) {
				$names[] = $name;
			}
		}
		return array_values( array_unique( $names ) );
	}
}
