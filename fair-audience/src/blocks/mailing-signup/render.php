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

// Get block attributes.
$form_title      = $attributes['title'] ?? '';
$form_desc       = $attributes['description'] ?? '';
$submit_text     = $attributes['submitButtonText'] ?? __( 'Subscribe', 'fair-audience' );
$success_message = $attributes['successMessage'] ?? __( 'Please check your email to confirm your subscription.', 'fair-audience' );

// Generate unique ID for this form instance.
$form_id = 'fair-audience-mailing-' . wp_unique_id();

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-audience-mailing-signup',
		'data-success-message' => esc_attr( $success_message ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( ! empty( $form_title ) ) : ?>
		<h3 class="fair-audience-mailing-title"><?php echo esc_html( $form_title ); ?></h3>
	<?php endif; ?>

	<?php if ( ! empty( $form_desc ) ) : ?>
		<p class="fair-audience-mailing-description"><?php echo esc_html( $form_desc ); ?></p>
	<?php endif; ?>

	<form class="fair-audience-mailing-form">
		<div class="fair-audience-mailing-fields">
			<div class="fair-audience-mailing-field">
				<label for="<?php echo esc_attr( $form_id ); ?>-name">
					<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
				</label>
				<input
					type="text"
					id="<?php echo esc_attr( $form_id ); ?>-name"
					name="mailing_name"
					class="fair-audience-mailing-input"
					required
					placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
				/>
			</div>
			<div class="fair-audience-mailing-field">
				<label for="<?php echo esc_attr( $form_id ); ?>-surname">
					<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?> <span class="required">*</span>
				</label>
				<input
					type="text"
					id="<?php echo esc_attr( $form_id ); ?>-surname"
					name="mailing_surname"
					class="fair-audience-mailing-input"
					required
					placeholder="<?php echo esc_attr__( 'Enter your last name', 'fair-audience' ); ?>"
				/>
			</div>
			<div class="fair-audience-mailing-field fair-audience-mailing-field-email">
				<label for="<?php echo esc_attr( $form_id ); ?>-email">
					<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
				</label>
				<input
					type="email"
					id="<?php echo esc_attr( $form_id ); ?>-email"
					name="mailing_email"
					class="fair-audience-mailing-input"
					required
					placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
				/>
			</div>
		</div>

		<button type="submit" class="fair-audience-mailing-submit-button">
			<?php echo esc_html( $submit_text ); ?>
		</button>

		<div class="fair-audience-mailing-message" style="display: none;"></div>
	</form>
</div>
