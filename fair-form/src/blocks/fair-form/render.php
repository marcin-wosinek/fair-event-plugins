<?php
/**
 * Render callback for the Fair Form block
 *
 * @package FairForm
 * @param array    $attributes Block attributes.
 * @param string   $content    Rendered inner blocks HTML.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

$submit_text        = ! empty( $attributes['submitButtonText'] ) ? $attributes['submitButtonText'] : __( 'Submit', 'fair-audience' );
$success_message    = ! empty( $attributes['successMessage'] ) ? $attributes['successMessage'] : __( 'Thank you for your submission!', 'fair-audience' );
$event_date_id      = (int) ( $attributes['eventDateId'] ?? 0 );
$notification_email = ! empty( $attributes['notificationEmail'] ) ? sanitize_email( $attributes['notificationEmail'] ) : '';
$block_form_id      = ! empty( $attributes['formId'] ) ? sanitize_text_field( $attributes['formId'] ) : '';
$block_form_title   = ! empty( $attributes['formTitle'] ) ? sanitize_text_field( $attributes['formTitle'] ) : '';

// Get wrapper attributes.
$wrapper_data = array(
	'class'                   => 'fair-form',
	'data-success-message'    => esc_attr( $success_message ),
	'data-event-date-id'      => esc_attr( $event_date_id ),
	'data-post-id'            => esc_attr( get_the_ID() ),
	'data-notification-email' => esc_attr( $notification_email ),
);

if ( '' !== $block_form_id ) {
	$wrapper_data['data-form-id'] = esc_attr( $block_form_id );
}

if ( '' !== $block_form_title ) {
	$wrapper_data['data-form-title'] = esc_attr( $block_form_title );
}

$wrapper_attributes = get_block_wrapper_attributes( $wrapper_data );
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-form-form" novalidate>
		<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-form-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-form-message" style="display: none;"></div>
	</form>
	<?php if ( class_exists( '\FairAudience\Services\Branding' ) ) : ?>
		<?php echo wp_kses_post( \FairAudience\Services\Branding::block_html() ); ?>
	<?php endif; ?>
</div>
