<?php
/**
 * Server-side rendering for Registration Form block
 *
 * @package FairRegistration
 */

$form_name = $attributes['name'] ?? '';
$form_id = $attributes['id'] ?? '';
$inner_blocks = $content ?? '';

$form_classes = 'fair-registration-form';
if (!empty($form_id)) {
	$form_classes .= ' fair-registration-form-' . esc_attr($form_id);
}
?>

<div class="<?php echo esc_attr($form_classes); ?>">
	<form 
		id="<?php echo esc_attr($form_id ?: 'fair-registration-form-' . uniqid()); ?>" 
		class="fair-registration-form-element"
		method="post"
		action=""
	>
		<?php echo $inner_blocks; ?>
		
		<div class="fair-registration-form-actions">
			<button type="submit" class="fair-registration-submit-btn">
				<?php _e('Submit Registration', 'fair-registration'); ?>
			</button>
		</div>
		
		<?php wp_nonce_field('fair_registration_submit', 'fair_registration_nonce'); ?>
	</form>
</div>