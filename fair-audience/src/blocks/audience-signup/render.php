<?php
/**
 * Render callback for the Audience Signup block
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

// Get block attributes.
$submit_text        = $attributes['submitButtonText'] ?? __( 'Register', 'fair-audience' );
$success_message    = $attributes['successMessage'] ?? __( 'You have been registered successfully!', 'fair-audience' );
$show_instagram     = $attributes['showInstagram'] ?? false;
$show_keep_informed = $attributes['showKeepInformed'] ?? true;

// Generate unique ID for this form instance.
$form_id = 'fair-audience-audience-' . wp_unique_id();

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-audience-audience-signup',
		'data-success-message' => esc_attr( $success_message ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-audience-form">
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="audience_name"
				required
				placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-surname">
				<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-surname"
				name="audience_surname"
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
				name="audience_email"
				required
				placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
			/>
		</p>

		<?php if ( $show_instagram ) : ?>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-instagram">
				<?php echo esc_html__( 'Instagram', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-instagram"
				name="audience_instagram"
				placeholder="<?php echo esc_attr__( '@username', 'fair-audience' ); ?>"
			/>
		</p>
		<?php endif; ?>

		<?php if ( $show_keep_informed ) : ?>
		<div class="fair-audience-audience-checkbox">
			<label>
				<input type="checkbox" name="audience_keep_informed" value="1" />
				<?php echo esc_html__( 'Keep me informed about future events', 'fair-audience' ); ?>
			</label>
		</div>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-audience-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-audience-message" style="display: none;"></div>
	</form>
</div>
