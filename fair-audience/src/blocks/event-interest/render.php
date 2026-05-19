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

use FairAudience\Database\ParticipantRepository;
use FairAudience\Services\AudienceSession;
use FairAudience\Services\ParticipantToken;
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

// Resolve the visitor's identity in the same priority order as event-signup
// and audience-signup: signed URL token > logged-in WP user > session cookie.
// The first two are strong identities (we trust them to belong to the
// visitor); the cookie is a softer pre-fill that lets the visitor edit
// before submitting.
$participant_token_value = get_query_var( 'participant_token', '' );
$existing_name           = '';
$existing_email          = '';
$linked_participant_id   = 0;
$has_session_prefill     = false;

if ( $is_valid_post_type ) {
	$participant_repo = new ParticipantRepository();
	$participant      = null;

	if ( ! empty( $participant_token_value ) ) {
		$token_data = ParticipantToken::verify( $participant_token_value );
		if ( $token_data ) {
			$participant = $participant_repo->get_by_id( $token_data['participant_id'] );
		}
	}

	if ( null === $participant ) {
		$wp_user_id = get_current_user_id();
		if ( $wp_user_id ) {
			$participant = $participant_repo->get_by_user_id( $wp_user_id );
		}
	}

	if ( $participant ) {
		$existing_name         = (string) $participant->name;
		$existing_email        = (string) $participant->email;
		$linked_participant_id = (int) $participant->id;
	} else {
		// Anonymous viewer with a known browser session — pre-fill but don't
		// claim identity. The form still submits through the regular flow.
		$session_participant_id = AudienceSession::get_participant_id();
		if ( $session_participant_id ) {
			$session_participant = $participant_repo->get_by_id( $session_participant_id );
			if ( $session_participant ) {
				$existing_name       = (string) $session_participant->name;
				$existing_email      = (string) $session_participant->email;
				$has_session_prefill = true;
			}
		}
	}
}

$form_id = 'fair-audience-event-interest-' . wp_unique_id();

$wrapper_data = array(
	'class'                => 'fair-audience-event-interest',
	'data-event-id'        => (string) $event_id,
	'data-success-message' => esc_attr( $success_message ),
);

if ( $linked_participant_id ) {
	$wrapper_data['data-participant-id'] = (string) $linked_participant_id;
}

$wrapper_attributes = get_block_wrapper_attributes( $wrapper_data );
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
				value="<?php echo esc_attr( $existing_email ); ?>"
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
				value="<?php echo esc_attr( $existing_name ); ?>"
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

		<?php if ( $has_session_prefill ) : ?>
		<button type="button" class="fair-audience-not-you">
			<?php echo esc_html__( 'Not you? Start fresh', 'fair-audience' ); ?>
		</button>
		<?php endif; ?>

		<div class="wp-block-button">
			<button type="submit" class="wp-block-button__link wp-element-button fair-audience-event-interest-submit-button">
				<?php echo esc_html( $submit_text ); ?>
			</button>
		</div>

		<div class="fair-audience-signup-message fair-audience-event-interest-message" style="display: none;"></div>
	</form>
</div>
<?php endif; ?>
