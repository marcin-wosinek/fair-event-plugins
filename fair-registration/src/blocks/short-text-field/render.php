<?php
/**
 * Server-side rendering for Short Text Field block
 *
 * @package FairRegistration
 */

$label = $attributes['label'] ?? 'Text Field';
$placeholder = $attributes['placeholder'] ?? 'Enter text';
$required = $attributes['required'] ?? false;
$field_id = $attributes['fieldId'] ?? 'text_' . uniqid();
$max_length = $attributes['maxLength'] ?? 255;
// Use field ID directly as field name
$field_name = $field_id;
?>

<div class="wp-block-column fair-registration-field fair-registration-short-text-field">
	<label for="<?php echo esc_attr($field_name); ?>" class="wp-block-label fair-registration-field-label">
		<?php echo esc_html($label); ?>
		<?php if ($required): ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	
	<input
		type="text"
		id="<?php echo esc_attr($field_name); ?>"
		name="<?php echo esc_attr($field_name); ?>"
		class="wp-block-input fair-registration-field-input"
		placeholder="<?php echo esc_attr($placeholder); ?>"
		maxlength="<?php echo esc_attr($max_length); ?>"
		<?php if ($required): ?>required<?php endif; ?>
	/>
</div>