<?php
/**
 * Server-side rendering for Phone Number Field block
 *
 * @package FairRegistration
 */

$label       = $attributes['label'] ?? 'Phone Number';
$placeholder = $attributes['placeholder'] ?? 'Enter your phone number';
$required    = $attributes['required'] ?? false;
$field_id    = $attributes['fieldId'] ?? 'phone_' . uniqid();
$pattern     = $attributes['pattern'] ?? '';
$form_id     = $block->context['fair-registration/formId'] ?? '';

$field_name = $form_id ? $form_id . '_' . $field_id : $field_id;
?>

<div class="wp-block-column fair-registration-field fair-registration-phone-number-field">
	<label for="<?php echo esc_attr( $field_name ); ?>" class="wp-block-label fair-registration-field-label">
		<?php echo esc_html( $label ); ?>
		<?php if ( $required ) : ?>
			<span class="required">*</span>
		<?php endif; ?>
	</label>
	
	<input
		type="tel"
		id="<?php echo esc_attr( $field_name ); ?>"
		name="<?php echo esc_attr( $field_name ); ?>"
		class="wp-block-input fair-registration-field-input"
		placeholder="<?php echo esc_attr( $placeholder ); ?>"
		<?php
		if ( $pattern ) :
			?>
			pattern="<?php echo esc_attr( $pattern ); ?>"<?php endif; ?>
		<?php
		if ( $required ) :
			?>
			required<?php endif; ?>
	/>
</div>