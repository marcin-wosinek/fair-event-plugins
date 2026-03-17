<?php
/**
 * Render callback for the Mailing Signup block
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

// Get block attributes — translate defaults so stored English values get localized.
$submit_text              = __( $attributes['submitButtonText'] ?? 'Subscribe', 'fair-audience' );
$success_message          = __( $attributes['successMessage'] ?? 'Please check your email to confirm your subscription.', 'fair-audience' );
$show_categories          = ! empty( $attributes['showCategories'] );
$category_ids             = $attributes['categoryIds'] ?? array();
$preselected_category_ids = $attributes['preselectedCategoryIds'] ?? array();

// Generate unique ID for this form instance.
$form_id = 'fair-audience-mailing-' . wp_unique_id();

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

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-audience-mailing-signup',
		'data-success-message' => esc_attr( $success_message ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-mailing-form">
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="mailing_name"
				required
				placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-surname">
				<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-surname"
				name="mailing_surname"
				required
				placeholder="<?php echo esc_attr__( 'Enter your last name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-email">
				<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="mailing_email"
				required
				placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
			/>
		</p>

		<?php if ( $show_categories && ! empty( $categories ) ) : ?>
		<fieldset class="fair-audience-mailing-categories">
			<legend><?php echo esc_html__( 'I am interested in:', 'fair-audience' ); ?></legend>
			<?php foreach ( $categories as $category ) : ?>
			<label class="fair-audience-mailing-category-label">
				<input
					type="checkbox"
					name="mailing_categories[]"
					value="<?php echo esc_attr( $category->term_id ); ?>"
					<?php checked( in_array( $category->term_id, $preselected_category_ids, true ) ); ?>
				/>
				<?php echo esc_html( $category->name ); ?>
			</label>
			<?php endforeach; ?>
		</fieldset>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-mailing-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-mailing-message" style="display: none;"></div>
	</form>
</div>
