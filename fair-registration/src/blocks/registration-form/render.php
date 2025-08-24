<?php

namespace FairRegistration\Core;

defined( 'WPINC' ) || die;

/**
 * Render callback for the registration form block
 *
 * @package FairRegistration
 * @param  array $attributes Block attributes
 * @param  string $content Block content
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults
$form_name = $attributes['name'] ?? '';
$form_id = $attributes['id'] ?? '';

// Generate unique form ID if none provided
$unique_form_id = !empty($form_id) ? $form_id : 'fair-registration-form-' . uniqid();

// Prepare wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes([
	'class' => 'fair-registration-form'
]);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form 
		id="<?php echo esc_attr( $unique_form_id ); ?>" 
		class="wp-block-group fair-registration-form-element"
		method="post"
		action=""
		data-form-name="<?php echo esc_attr( $form_name ); ?>"
	>
		<?php echo $content; ?>
		
		<?php wp_nonce_field( 'fair_registration_submit_' . $unique_form_id, 'fair_registration_nonce' ); ?>
	</form>
</div>
