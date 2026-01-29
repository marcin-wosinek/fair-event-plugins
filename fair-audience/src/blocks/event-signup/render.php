<?php
/**
 * Render callback for the Event Signup block
 *
 * @package FairAudience
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\EventSignupAccessKeyRepository;

// Get block attributes.
$signup_button_text       = $attributes['signupButtonText'] ?? __( 'Sign Up', 'fair-audience' );
$register_button_text     = $attributes['registerButtonText'] ?? __( 'Register & Sign Up', 'fair-audience' );
$request_link_button_text = $attributes['requestLinkButtonText'] ?? __( 'Send Signup Link', 'fair-audience' );
$success_message          = $attributes['successMessage'] ?? __( 'You have successfully signed up for the event!', 'fair-audience' );

// Get event ID from current post.
$event_id = get_the_ID();

// Check if this is a fair_event post type.
$is_valid_post_type = ( 'fair_event' === get_post_type( $event_id ) );

// Generate unique ID for this form instance.
$form_id = 'fair-audience-signup-' . wp_unique_id();

// Determine user state.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Token is validated server-side.
$token   = isset( $_GET['signup_token'] ) ? sanitize_text_field( wp_unslash( $_GET['signup_token'] ) ) : '';
$user_id = get_current_user_id();

$state            = 'anonymous';
$participant      = null;
$participant_data = array();
$is_signed_up     = false;

if ( $is_valid_post_type ) {
	$participant_repository       = new ParticipantRepository();
	$event_participant_repository = new EventParticipantRepository();
	$access_key_repository        = new EventSignupAccessKeyRepository();

	if ( ! empty( $token ) ) {
		// Token-based access.
		$access_key = $access_key_repository->get_by_token( $token );
		if ( $access_key && (int) $access_key->event_id === (int) $event_id ) {
			$state       = 'with_token';
			$participant = $participant_repository->get_by_id( $access_key->participant_id );
		}
	} elseif ( $user_id ) {
		// Logged-in user.
		$participant = $participant_repository->get_by_user_id( $user_id );
		if ( $participant ) {
			$state = 'linked';
		} else {
			$state = 'not_linked';
		}
	}

	// Check if already signed up.
	if ( $participant ) {
		$event_participant = $event_participant_repository->get_by_event_and_participant(
			$event_id,
			$participant->id
		);
		if ( $event_participant && 'signed_up' === $event_participant->label ) {
			$is_signed_up = true;
		}

		$participant_data = array(
			'id'      => $participant->id,
			'name'    => $participant->name,
			'surname' => $participant->surname,
			'email'   => $participant->email,
		);
	}
}

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                => 'fair-audience-event-signup',
		'data-event-id'        => esc_attr( (string) $event_id ),
		'data-state'           => esc_attr( $state ),
		'data-is-signed-up'    => $is_signed_up ? 'true' : 'false',
		'data-token'           => esc_attr( $token ),
		'data-success-message' => esc_attr( $success_message ),
	)
);
?>

<?php if ( ! $is_valid_post_type ) : ?>
<p class="fair-audience-event-signup-error">
	<?php echo esc_html__( 'This block can only be used on event pages.', 'fair-audience' ); ?>
</p>
<?php else : ?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( $is_signed_up ) : ?>
		<!-- Already signed up -->
		<div class="fair-audience-signup-status fair-audience-signup-status-success">
			<p><?php echo esc_html__( 'You are signed up for this event!', 'fair-audience' ); ?></p>
		</div>

	<?php elseif ( 'with_token' === $state && $participant ) : ?>
		<!-- Token-based: show pre-filled info and signup button -->
		<div class="fair-audience-signup-token-form">
			<p class="fair-audience-signup-greeting">
				<?php
				printf(
					/* translators: %s: participant name */
					esc_html__( 'Hi %s! Click the button below to sign up for this event.', 'fair-audience' ),
					esc_html( $participant->name )
				);
				?>
			</p>
			<div class="wp-block-button">
				<button type="button" class="wp-block-button__link wp-element-button fair-audience-signup-button" data-action="signup">
					<?php echo esc_html( $signup_button_text ); ?>
				</button>
			</div>
			<div class="fair-audience-signup-message" style="display: none;"></div>
		</div>

	<?php elseif ( 'linked' === $state && $participant ) : ?>
		<!-- Logged in with linked participant: show signup button -->
		<div class="fair-audience-signup-linked-form">
			<p class="fair-audience-signup-greeting">
				<?php
				printf(
					/* translators: %s: participant name */
					esc_html__( 'Hi %s! You can sign up for this event.', 'fair-audience' ),
					esc_html( $participant->name )
				);
				?>
			</p>
			<div class="wp-block-button">
				<button type="button" class="wp-block-button__link wp-element-button fair-audience-signup-button" data-action="signup">
					<?php echo esc_html( $signup_button_text ); ?>
				</button>
			</div>
			<div class="fair-audience-signup-message" style="display: none;"></div>
		</div>

	<?php elseif ( 'not_linked' === $state ) : ?>
		<!-- Logged in but no linked participant -->
		<div class="fair-audience-signup-not-linked">
			<p><?php echo esc_html__( 'Your WordPress account is not linked to a participant profile. Please contact the site administrator.', 'fair-audience' ); ?></p>
		</div>

	<?php else : ?>
		<!-- Anonymous: show tabs with forms -->
		<div class="fair-audience-signup-anonymous">
			<div class="fair-audience-signup-tabs">
				<button type="button" class="fair-audience-signup-tab active" data-tab="register">
					<?php echo esc_html__( "I'm new", 'fair-audience' ); ?>
				</button>
				<button type="button" class="fair-audience-signup-tab" data-tab="request-link">
					<?php echo esc_html__( 'I have an account', 'fair-audience' ); ?>
				</button>
			</div>

			<!-- Registration form (new participant) -->
			<form class="fair-audience-signup-form fair-audience-signup-register" data-tab-content="register">
				<p>
					<label for="<?php echo esc_attr( $form_id ); ?>-name">
						<?php echo esc_html__( 'First Name', 'fair-audience' ); ?> <span class="required">*</span>
					</label>
					<input
						type="text"
						id="<?php echo esc_attr( $form_id ); ?>-name"
						name="signup_name"
						required
						placeholder="<?php echo esc_attr__( 'Enter your first name', 'fair-audience' ); ?>"
					/>
				</p>
				<p>
					<label for="<?php echo esc_attr( $form_id ); ?>-surname">
						<?php echo esc_html__( 'Surname', 'fair-audience' ); ?>
					</label>
					<input
						type="text"
						id="<?php echo esc_attr( $form_id ); ?>-surname"
						name="signup_surname"
						placeholder="<?php echo esc_attr__( 'Enter your surname', 'fair-audience' ); ?>"
					/>
				</p>
				<p>
					<label for="<?php echo esc_attr( $form_id ); ?>-email">
						<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
					</label>
					<input
						type="email"
						id="<?php echo esc_attr( $form_id ); ?>-email"
						name="signup_email"
						required
						placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
					/>
				</p>
				<p class="fair-audience-signup-checkbox">
					<label>
						<input type="checkbox" name="signup_keep_informed" value="1" />
						<?php echo esc_html__( 'Keep me informed about future events', 'fair-audience' ); ?>
					</label>
				</p>

				<div class="wp-block-button">
					<button type="submit" class="wp-block-button__link wp-element-button fair-audience-signup-submit-button">
						<?php echo esc_html( $register_button_text ); ?>
					</button>
				</div>

				<div class="fair-audience-signup-message" style="display: none;"></div>
			</form>

			<!-- Request link form (existing participant) -->
			<form class="fair-audience-signup-form fair-audience-signup-request-link" data-tab-content="request-link" style="display: none;">
				<p class="fair-audience-signup-info">
					<?php echo esc_html__( 'Enter your email to receive a signup link.', 'fair-audience' ); ?>
				</p>
				<p>
					<label for="<?php echo esc_attr( $form_id ); ?>-link-email">
						<?php echo esc_html__( 'Email', 'fair-audience' ); ?> <span class="required">*</span>
					</label>
					<input
						type="email"
						id="<?php echo esc_attr( $form_id ); ?>-link-email"
						name="link_email"
						required
						placeholder="<?php echo esc_attr__( 'Enter your email', 'fair-audience' ); ?>"
					/>
				</p>

				<div class="wp-block-button">
					<button type="submit" class="wp-block-button__link wp-element-button fair-audience-signup-submit-button">
						<?php echo esc_html( $request_link_button_text ); ?>
					</button>
				</div>

				<div class="fair-audience-signup-message" style="display: none;"></div>
			</form>
		</div>
	<?php endif; ?>
</div>
<?php endif; ?>
