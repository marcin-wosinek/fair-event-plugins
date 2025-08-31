<?php
/**
 * Server-side rendering for Select Field block
 *
 * @package FairRegistration
 */

$label       = $attributes['label'] ?? 'Select Option';
$required    = $attributes['required'] ?? false;
$field_id    = $attributes['fieldId'] ?? 'select_' . uniqid();
$options     = $attributes['options'] ?? array(
	array(
		'label' => 'Option 1',
		'value' => 'option1',
	),
	array(
		'label' => 'Option 2',
		'value' => 'option2',
	),
);
$placeholder = $attributes['placeholder'] ?? 'Choose an option';
$form_id     = $block->context['fair-registration/formId'] ?? '';

$field_name = $form_id ? $form_id . '_' . $field_id : $field_id;
?>

<div class="wp-block-column fair-registration-field fair-registration-select-field">
	<label for="<?php echo esc_attr( $field_name ); ?>" class="wp-block-label fair-registration-field-label">
		<?php echo esc_html( $label ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	
	<select
		id="<?php echo esc_attr( $field_name ); ?>"
		name="<?php echo esc_attr( $field_name ); ?>"
		class="wp-block-input fair-registration-field-input"
		<?php
		if ( $required ) :
			?>
			required<?php endif; ?>
	>
		<option value=""><?php echo esc_html( $placeholder ); ?></option>
		<?php foreach ( $options as $option ) : ?>
			<option value="<?php echo esc_attr( $option['value'] ); ?>">
				<?php echo esc_html( $option['label'] ); ?>
			</option>
		<?php endforeach; ?>
	</select>
</div>