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
use FairAudience\Services\ParticipantToken;
use FairEvents\Models\EventDates;

// Get block attributes — translate defaults so stored English values get localized.
$signup_button_text       = __( $attributes['signupButtonText'] ?? 'Sign Up', 'fair-audience' );
$register_button_text     = __( $attributes['registerButtonText'] ?? 'Register & Sign Up', 'fair-audience' );
$request_link_button_text = __( $attributes['requestLinkButtonText'] ?? 'Send Signup Link', 'fair-audience' );
$success_message          = __( $attributes['successMessage'] ?? 'You have successfully signed up for the event!', 'fair-audience' );

// Get event ID from current post.
$event_id = get_the_ID();

// Check if this is an event post type.
$is_valid_post_type = \FairEvents\Database\EventRepository::is_event( $event_id );

// Generate unique ID for this form instance.
$form_id = 'fair-audience-signup-' . wp_unique_id();

// Determine user state.
$participant_token = get_query_var( 'participant_token', '' );
$user_id           = get_current_user_id();

$state            = 'anonymous';
$participant      = null;
$participant_data = array();
$is_signed_up     = false;

if ( $is_valid_post_type ) {
	$participant_repository       = new ParticipantRepository();
	$event_participant_repository = new EventParticipantRepository();

	if ( ! empty( $participant_token ) ) {
		// Token-based access via HMAC participant token.
		$token_data = ParticipantToken::verify( $participant_token );
		if ( $token_data ) {
			$state       = 'with_token';
			$participant = $participant_repository->get_by_id( $token_data['participant_id'] );
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

	// Check if already signed up (prefer event_date_id if available).
	if ( $participant ) {
		$event_participant = null;
		if ( ! empty( $event_date_id ) ) {
			$event_participant = $event_participant_repository->get_by_event_date_and_participant(
				(int) $event_date_id,
				$participant->id
			);
		} else {
			$event_participant = $event_participant_repository->get_by_event_and_participant(
				$event_id,
				$participant->id
			);
		}
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

// Resolve event_date_id from fair_event_dates table.
$event_date_id = '';
if ( class_exists( EventDates::class ) ) {
	$event_dates_obj = EventDates::get_by_event_id( $event_id );
	if ( $event_dates_obj ) {
		$event_date_id = (string) $event_dates_obj->id;
	}
}

// Resolve ticket types for this event date, if any. When present, the
// signup form switches from a single-price button to a radio picker of
// ticket types, each with its own price and seat count.
$ticket_types_for_display = array();
if ( $event_date_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
	$raw_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( (int) $event_date_id );
	foreach ( $raw_types as $tt ) {
		$tt_price = null;
		if ( class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			$tt_price = \FairEvents\Services\EventSignupPricing::resolve_price_for_ticket_type(
				$tt->id,
				$participant ? (int) $participant->id : null
			);
		}
		$ticket_types_for_display[] = array(
			'id'               => (int) $tt->id,
			'name'             => $tt->name,
			'price'            => $tt_price,
			'seats_per_ticket' => (int) $tt->seats_per_ticket,
		);
	}
}
$has_ticket_types = ! empty( $ticket_types_for_display );

// Resolve ticket options for this event date, if any. Options are displayed
// as checkboxes — participants can select zero or more at signup.
$ticket_options_for_display = array();
if ( $event_date_id && class_exists( \FairEvents\Models\TicketOption::class ) ) {
	$raw_options = \FairEvents\Models\TicketOption::get_all_by_event_date_id( (int) $event_date_id );
	foreach ( $raw_options as $opt ) {
		$ticket_options_for_display[] = array(
			'id'    => (int) $opt->id,
			'name'  => $opt->name,
			'price' => (float) $opt->price,
		);
	}
}
$has_ticket_options = ! empty( $ticket_options_for_display );

// Read block attribute to control whether option prices are displayed.
$show_option_prices = $attributes['showOptionPrices'] ?? true;

// Resolve effective signup price for the current viewer so we can reflect it
// in the button label.
// null = no price configured at all → keep the default button text
// > 0  = paid → append "— €X.XX"
// 0    = a price exists but the viewer gets it for free (e.g. 100% group
// discount, or base price explicitly set to 0) → show "… for free"
$signup_price = null;
if ( ! $has_ticket_types && $event_date_id && class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
	$signup_price = \FairEvents\Services\EventSignupPricing::resolve_price(
		(int) $event_date_id,
		$participant ? (int) $participant->id : null
	);
}

if ( null !== $signup_price ) {
	if ( $signup_price > 0 ) {
		$signup_button_text = sprintf(
			/* translators: 1: base button label, 2: formatted price */
			__( '%1$s — €%2$s', 'fair-audience' ),
			$signup_button_text,
			number_format_i18n( $signup_price, 2 )
		);
		$register_button_text = sprintf(
			/* translators: 1: base button label, 2: formatted price */
			__( '%1$s — €%2$s', 'fair-audience' ),
			$register_button_text,
			number_format_i18n( $signup_price, 2 )
		);
	} else {
		$signup_button_text   = __( 'Sign up for free', 'fair-audience' );
		$register_button_text = __( 'Register for free', 'fair-audience' );
	}
}

/**
 * Render the ticket-type radio fieldset. No-op when the event date has no
 * ticket types configured. First enabled option is pre-selected.
 */
$render_ticket_types = static function () use ( $ticket_types_for_display, $has_ticket_types, $form_id ) {
	if ( ! $has_ticket_types ) {
		return;
	}
	echo '<fieldset class="fair-audience-ticket-types">';
	echo '<legend>' . esc_html__( 'Choose ticket type', 'fair-audience' ) . '</legend>';
	$first = true;
	foreach ( $ticket_types_for_display as $tt ) {
		$tt_label = $tt['name'];
		if ( null !== $tt['price'] ) {
			if ( $tt['price'] > 0 ) {
				$tt_label .= ' — €' . number_format_i18n( (float) $tt['price'], 2 );
			} else {
				$tt_label .= ' — ' . __( 'free', 'fair-audience' );
			}
		}
		if ( $tt['seats_per_ticket'] > 1 ) {
			$tt_label .= ' ' . sprintf(
				/* translators: %d: number of seats this ticket consumes */
				_n( '(%d seat)', '(%d seats)', $tt['seats_per_ticket'], 'fair-audience' ),
				$tt['seats_per_ticket']
			);
		}
		$radio_id = esc_attr( $form_id ) . '-tt-' . (int) $tt['id'];
		echo '<label class="fair-audience-ticket-type-option" for="' . $radio_id . '">';
		echo '<input type="radio" name="ticket_type_id" id="' . $radio_id . '" value="' . (int) $tt['id'] . '"';
		if ( $first ) {
			echo ' checked';
			$first = false;
		}
		echo ' /> ';
		echo esc_html( $tt_label );
		echo '</label>';
	}
	echo '</fieldset>';
};

/**
 * Render the ticket options checkbox fieldset. No-op when no options configured.
 */
$render_ticket_options = static function () use ( $ticket_options_for_display, $has_ticket_options, $form_id, $show_option_prices ) {
	if ( ! $has_ticket_options ) {
		return;
	}
	echo '<fieldset class="fair-audience-ticket-options">';
	echo '<legend>' . esc_html__( 'Select activities', 'fair-audience' ) . '</legend>';
	foreach ( $ticket_options_for_display as $opt ) {
		$opt_label = $opt['name'];
		if ( $show_option_prices ) {
			if ( $opt['price'] > 0 ) {
				$opt_label .= ' — €' . number_format_i18n( $opt['price'], 2 );
			} else {
				$opt_label .= ' — ' . __( 'free', 'fair-audience' );
			}
		}
		$checkbox_id = esc_attr( $form_id ) . '-opt-' . (int) $opt['id'];
		echo '<label class="fair-audience-ticket-option-item" for="' . $checkbox_id . '">';
		echo '<input type="checkbox" name="ticket_option_ids[]" id="' . $checkbox_id . '" value="' . (int) $opt['id'] . '" data-option-price="' . esc_attr( number_format( $opt['price'], 2, '.', '' ) ) . '" /> ';
		echo esc_html( $opt_label );
		echo '</label>';
	}
	echo '</fieldset>';
};

// Base button labels (without price suffix) for dynamic JS price updates.
$base_signup_button_text   = __( $attributes['signupButtonText'] ?? 'Sign Up', 'fair-audience' );
$base_register_button_text = __( $attributes['registerButtonText'] ?? 'Register & Sign Up', 'fair-audience' );

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                   => 'fair-audience-event-signup',
		'data-event-id'           => esc_attr( (string) $event_id ),
		'data-event-date-id'      => esc_attr( $event_date_id ),
		'data-state'              => esc_attr( $state ),
		'data-is-signed-up'       => $is_signed_up ? 'true' : 'false',
		'data-participant-token'  => esc_attr( $participant_token ),
		'data-success-message'    => esc_attr( $success_message ),
		'data-base-price'         => null !== $signup_price ? esc_attr( (string) $signup_price ) : '',
		'data-signup-base-text'   => esc_attr( $base_signup_button_text ),
		'data-register-base-text' => esc_attr( $base_register_button_text ),
	)
);
?>

<?php if ( ! $is_valid_post_type ) : ?>
<p class="fair-audience-event-signup-error">
	<?php echo esc_html__( 'This block can only be used on event pages.', 'fair-audience' ); ?>
</p>
<?php else : ?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( $is_signed_up && ( 'with_token' === $state || 'linked' === $state ) ) : ?>
		<!-- Signed up: authenticated user can cancel -->
		<div class="fair-audience-signup-signed-up">
			<div class="fair-audience-signup-status fair-audience-signup-status-success">
				<p><?php echo esc_html__( 'You are signed up for this event!', 'fair-audience' ); ?></p>
			</div>
			<div class="wp-block-button fair-audience-unsignup-button-wrap">
				<button type="button" class="wp-block-button__link wp-element-button fair-audience-unsignup-button is-style-outline">
					<?php echo esc_html__( 'Cancel signup', 'fair-audience' ); ?>
				</button>
			</div>
			<div class="fair-audience-signup-message" style="display: none;"></div>
		</div>

	<?php elseif ( $is_signed_up ) : ?>
		<!-- Signed up: anonymous user (no cancel option) -->
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
			<?php $render_ticket_types(); ?>
			<?php $render_ticket_options(); ?>
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
			<?php $render_ticket_types(); ?>
			<?php $render_ticket_options(); ?>
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
				<?php $render_ticket_types(); ?>
				<?php $render_ticket_options(); ?>
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
