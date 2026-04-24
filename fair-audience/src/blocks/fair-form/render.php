<?php
/**
 * Render callback for the Fair Form block
 *
 * @package FairAudience
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
$show_keep_informed = ! empty( $attributes['showKeepInformed'] );
$event_date_id      = (int) ( $attributes['eventDateId'] ?? 0 );
$notification_email = ! empty( $attributes['notificationEmail'] ) ? sanitize_email( $attributes['notificationEmail'] ) : '';

// Generate unique ID for this form instance.
$form_id = 'fair-form-' . wp_unique_id();

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-form',
		'data-success-message'    => esc_attr( $success_message ),
		'data-event-date-id'      => esc_attr( $event_date_id ),
		'data-post-id'            => esc_attr( get_the_ID() ),
		'data-notification-email' => esc_attr( $notification_email ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-form-form" novalidate>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="fair_form_name"
				required
				placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-surname">
				<?php echo esc_html__( 'Last Name', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-surname"
				name="fair_form_surname"
				placeholder="<?php echo esc_attr__( 'Enter your last name', 'fair-audience' ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-email">
				<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="fair_form_email"
				required
				placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
			/>
		</p>

		<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>

		<?php if ( $show_keep_informed ) : ?>
		<p class="fair-form-keep-informed">
			<label>
				<input type="checkbox" name="fair_form_keep_informed" value="1" />
				<?php echo esc_html__( 'Keep me informed about future events and updates', 'fair-audience' ); ?>
			</label>
		</p>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-form-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-form-message" style="display: none;"></div>
	</form>
</div>
