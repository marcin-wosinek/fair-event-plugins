<?php
/**
 * Server-side rendering for Long Text Field block
 *
 * @package FairRegistration
 */

$label = $attributes['label'] ?? 'Message';
$placeholder = $attributes['placeholder'] ?? 'Enter your message';
$required = $attributes['required'] ?? false;
$field_id = $attributes['fieldId'] ?? 'message_' . uniqid();
$rows = $attributes['rows'] ?? 4;
$max_length = $attributes['maxLength'] ?? 1000;
$form_id = $block->context['fair-registration/formId'] ?? '';

$field_name = $form_id ? $form_id . '_' . $field_id : $field_id;
?>

<div class="wp-block-column fair-registration-field fair-registration-long-text-field">
	<label for="<?php echo esc_attr($field_name); ?>" class="wp-block-label fair-registration-field-label">
		<?php echo esc_html($label); ?>
		<?php if ($required): ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	
	<textarea
		id="<?php echo esc_attr($field_name); ?>"
		name="<?php echo esc_attr($field_name); ?>"
		class="wp-block-input fair-registration-field-input"
		placeholder="<?php echo esc_attr($placeholder); ?>"
		rows="<?php echo esc_attr($rows); ?>"
		maxlength="<?php echo esc_attr($max_length); ?>"
		<?php if ($required): ?>required<?php endif; ?>
	></textarea>
</div>