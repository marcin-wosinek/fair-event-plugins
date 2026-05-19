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

// Resolve the event from the current post — same approach as event-signup so
// the block works on event pages and on junction-linked pages.
$current_post_id    = get_the_ID();
$event_dates_obj    = null;
$is_valid_post_type = false;
$event_id           = 0;
$event_date_id      = 0;

if ( $current_post_id && class_exists( EventDates::class ) ) {
	$event_dates_obj = EventDates::get_by_event_id( $current_post_id );
}

if ( $current_post_id && class_exists( EventRepository::class ) ) {
	$is_valid_post_type = EventRepository::is_event( $current_post_id ) || null !== $event_dates_obj;
}

if ( $is_valid_post_type ) {
	$event_id = $current_post_id;
	if ( $event_dates_obj && $event_dates_obj->event_id && $event_dates_obj->event_id !== $current_post_id ) {
		$event_id = (int) $event_dates_obj->event_id;
	}
	if ( $event_dates_obj ) {
		$event_date_id = (int) $event_dates_obj->id;
	}
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

<?php if ( ! $is_valid_post_type || $event_date_id <= 0 ) : ?>
<p class="fair-audience-event-signup-error">
	<?php echo esc_html__( 'This block can only be used on event pages.', 'fair-audience' ); ?>
</p>
<?php else : ?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<form class="fair-audience-signup-form fair-audience-event-interest-form">
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

		<div class="fair-audience-signup-message fair-audience-event-interest-message" style="display: none;"></div>
	</form>
</div>
<?php endif; ?>
