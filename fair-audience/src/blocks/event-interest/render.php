<?php
/**
 * Render callback for the Event Interest block.
 *
 * @package FairAudience
 * @param array $attributes Block attributes.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 */

defined( 'WPINC' ) || die;

use FairEvents\Database\EventRepository;
use FairEvents\Models\EventDates;

$submit_text       = __( $attributes['submitButtonText'] ?? 'Register interest', 'fair-audience' );
$success_message   = __( $attributes['successMessage'] ?? 'Thanks! Check your inbox for confirmation.', 'fair-audience' );
$name_placeholder  = __( $attributes['namePlaceholder'] ?? 'Your name (optional)', 'fair-audience' );
$email_placeholder = __( $attributes['emailPlaceholder'] ?? 'Your email', 'fair-audience' );

// Resolve the event from the current post. The block only renders on event
// pages — anywhere else it is silently skipped.
$post_id  = get_the_ID();
$event_id = 0;
if ( $post_id && class_exists( EventRepository::class ) && EventRepository::is_event( $post_id ) ) {
	$event_id = $post_id;
}

if ( $event_id <= 0 || ! class_exists( EventDates::class ) ) {
	return '';
}

$event_dates_obj = EventDates::get_by_event_id( $event_id );
if ( ! $event_dates_obj ) {
	return '';
}

$form_id = 'fair-audience-event-interest-' . wp_unique_id();

$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-audience-event-interest',
		'data-event-id'        => (string) $event_id,
		'data-success-message' => esc_attr( $success_message ),
	)
);
?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-event-interest-form">
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-email">
				<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
			</label>
			<input
				type="email"
				id="<?php echo esc_attr( $form_id ); ?>-email"
				name="interest_email"
				required
				placeholder="<?php echo esc_attr( $email_placeholder ); ?>"
			/>
		</p>
		<p>
			<label for="<?php echo esc_attr( $form_id ); ?>-name">
				<?php echo esc_html__( 'Name', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-name"
				name="interest_name"
				placeholder="<?php echo esc_attr( $name_placeholder ); ?>"
			/>
		</p>

		<p class="fair-audience-event-interest-honeypot" aria-hidden="true">
			<label for="<?php echo esc_attr( $form_id ); ?>-website">
				<?php echo esc_html__( 'Website', 'fair-audience' ); ?>
			</label>
			<input
				type="text"
				id="<?php echo esc_attr( $form_id ); ?>-website"
				name="interest_website"
				tabindex="-1"
				autocomplete="off"
			/>
		</p>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-event-interest-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-event-interest-message" style="display: none;"></div>
	</form>
</div>
