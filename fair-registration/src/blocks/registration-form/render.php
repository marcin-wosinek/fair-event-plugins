<?php
/**
 * Server-side rendering for Registration Form block
 *
 * @package FairRegistration
 */

$form_name = $attributes['name'] ?? '';
$form_id = $attributes['id'] ?? '';
$inner_blocks = $content ?? '';

$form_classes = 'wp-block-group fair-registration-form';
if (!empty($form_id)) {
	$form_classes .= ' fair-registration-form-' . esc_attr($form_id);
}
?>

<div class="<?php echo esc_attr($form_classes); ?>">
	<form 
		id="<?php echo esc_attr($form_id ?: 'fair-registration-form-' . uniqid()); ?>" 
		class="wp-block-group fair-registration-form-element"
		method="post"
		action=""
	>
		<div class="wp-block-columns fair-registration-form-fields">
			<?php echo $inner_blocks; ?>
		</div>
		
		<div class="wp-block-buttons fair-registration-form-actions">
			<div class="wp-block-button">
				<button type="submit" class="wp-block-button__link fair-registration-submit-btn">
					<?php _e('Submit Registration', 'fair-registration'); ?>
				</button>
			</div>
		</div>
		
		<?php wp_nonce_field('fair_registration_submit', 'fair_registration_nonce'); ?>
	</form>
</div>