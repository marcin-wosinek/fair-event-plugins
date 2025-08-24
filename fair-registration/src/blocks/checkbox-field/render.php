<?php
/**
 * Server-side rendering for Checkbox Field block
 *
 * @package FairRegistration
 */

$label = $attributes['label'] ?? 'Checkbox Option';
$required = $attributes['required'] ?? false;
$field_id = $attributes['fieldId'] ?? 'checkbox_' . uniqid();
$checked = $attributes['checked'] ?? false;
$value = $attributes['value'] ?? '1';
$form_id = $block->context['fair-registration/formId'] ?? '';

$field_name = $form_id ? $form_id . '_' . $field_id : $field_id;
?>

<div class="wp-block-column fair-registration-field fair-registration-checkbox-field">
	<label for="<?php echo esc_attr($field_name); ?>" class="wp-block-label fair-registration-field-label fair-registration-checkbox-label">
		<input
			type="checkbox"
			id="<?php echo esc_attr($field_name); ?>"
			name="<?php echo esc_attr($field_name); ?>"
			class="wp-block-input fair-registration-field-checkbox"
			value="<?php echo esc_attr($value); ?>"
			<?php if ($checked): ?>checked<?php endif; ?>
			<?php if ($required): ?>required<?php endif; ?>
		/>
		<?php echo esc_html($label); ?>
		<?php if ($required): ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
</div>