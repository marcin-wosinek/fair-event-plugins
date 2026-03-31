<?php
/**
 * Render callback for the Fair Form Mailing Sign Up block
 *
 * @package FairAudience
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

$show_categories          = ! empty( $attributes['showCategories'] );
$category_ids             = $attributes['categoryIds'] ?? array();
$preselected_category_ids = $attributes['preselectedCategoryIds'] ?? array();

// Generate unique ID for this block instance.
$block_id = 'fair-form-mailing-' . wp_unique_id();

// Fetch categories if needed.
$categories = array();
if ( $show_categories ) {
	$cat_args = array(
		'taxonomy'   => 'category',
		'hide_empty' => false,
		'orderby'    => 'name',
		'order'      => 'ASC',
	);

	// Filter to specific categories if set.
	if ( ! empty( $category_ids ) ) {
		$cat_args['include'] = array_map( 'intval', $category_ids );
	}

	$categories = get_terms( $cat_args );
	if ( is_wp_error( $categories ) ) {
		$categories = array();
	}
}

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                         => 'fair-form-mailing-signup',
		'data-fair-form-mailing-signup' => '',
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<p>
		<label for="<?php echo esc_attr( $block_id ); ?>-optin">
			<input
				type="checkbox"
				id="<?php echo esc_attr( $block_id ); ?>-optin"
				name="fair_form_mailing_signup"
				value="1"
			/>
			<?php echo esc_html__( 'Sign me up for the mailing list', 'fair-audience' ); ?>
		</label>
	</p>

	<?php if ( $show_categories && ! empty( $categories ) ) : ?>
	<fieldset class="fair-form-mailing-signup-categories">
		<legend><?php echo esc_html__( 'I am interested in:', 'fair-audience' ); ?></legend>
		<?php foreach ( $categories as $category ) : ?>
		<label class="fair-form-mailing-signup-category-label">
			<input
				type="checkbox"
				name="fair_form_mailing_categories[]"
				value="<?php echo esc_attr( $category->term_id ); ?>"
				<?php checked( in_array( $category->term_id, $preselected_category_ids, true ) ); ?>
			/>
			<?php echo esc_html( $category->name ); ?>
		</label>
		<?php endforeach; ?>
	</fieldset>
	<?php endif; ?>
</div>
