<?php

namespace FairRegistration\Core;

defined( 'WPINC' ) || die;

/**
 * Render callback for the email field block
 *
 * @package FairRegistration
 * @param  array $attributes Block attributes
 * @param  string $content Block content
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults
$label = $attributes['label'] ?? 'Email Address';
$placeholder = $attributes['placeholder'] ?? 'Enter your email';
$required = $attributes['required'] ?? true;
$field_id = $attributes['fieldId'] ?? 'email_' . uniqid();

// Get form context
$form_id = $block->context['fair-registration/formId'] ?? '';
$field_name = $form_id ? $form_id . '_' . $field_id : $field_id;

// Prepare wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes([
	'class' => 'wp-block-column fair-registration-field fair-registration-email-field'
]);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<label for="<?php echo esc_attr( $field_name ); ?>" class="wp-block-label fair-registration-field-label">
		<?php echo esc_html( $label ); ?>
		<?php if ( $required ): ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	
	<input
		type="email"
		id="<?php echo esc_attr( $field_name ); ?>"
		name="<?php echo esc_attr( $field_name ); ?>"
		class="wp-block-input fair-registration-field-input"
		placeholder="<?php echo esc_attr( $placeholder ); ?>"
		<?php if ( $required ): ?>required<?php endif; ?>
	/>
</div>