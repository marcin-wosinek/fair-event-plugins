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

// Get the current post ID (may be a direct event post or a linked page).
$post_id = get_the_ID();

// Resolve the event date first. EventDates::get_by_event_id() checks both the
// direct event_id column and the fair_event_date_posts junction table, so it
// returns an event date for pages that are linked to an event but are not
// themselves of an event post type (e.g. "entry type" pages).
$event_date_id   = '';
$event_dates_obj = null;
if ( class_exists( EventDates::class ) ) {
	$event_dates_obj = EventDates::get_by_event_id( $post_id );
	if ( $event_dates_obj ) {
		$event_date_id = (string) $event_dates_obj->id;
	}
}

// For generated occurrences, ticket types, ticket options, and signup_price
// are stored on the master event date.  Use $pricing_event_date_id for all
// pricing/option lookups so they resolve correctly.
$pricing_event_date_id = $event_date_id;
if ( $event_dates_obj
	&& 'generated' === ( $event_dates_obj->occurrence_type ?? null )
	&& ! empty( $event_dates_obj->master_id )
) {
	$pricing_event_date_id = (string) $event_dates_obj->master_id;
}

// Determine the effective event ID for participant lookups and API calls.
// For direct event posts: the current post IS the event.
// For junction-linked pages: use event_date->event_id (the primary event post)
// so that the API's EventRepository::is_event() check passes.
$event_id = $post_id;
if ( $event_dates_obj && $event_dates_obj->event_id && $event_dates_obj->event_id !== $post_id ) {
	$event_id = $event_dates_obj->event_id;
}

// The block is valid if the current post is a known event post type, OR it is
// linked to an event via the junction table (event date was found).
$is_valid_post_type = \FairEvents\Database\EventRepository::is_event( $post_id )
	|| null !== $event_dates_obj;

// Generate unique ID for this form instance.
$form_id = 'fair-audience-signup-' . wp_unique_id();

// Determine user state.
$participant_token = get_query_var( 'participant_token', '' );
$invitation_token  = get_query_var( 'invitation', '' );
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

// Validate invitation token if present.
$valid_invitation_token = null;
if ( ! empty( $invitation_token ) && class_exists( \FairEvents\Models\InvitationToken::class ) ) {
	$invitation_obj = \FairEvents\Models\InvitationToken::get_by_token( $invitation_token );
	if ( $invitation_obj && $invitation_obj->is_valid() ) {
		$valid_invitation_token = $invitation_obj;
	}
}

// Resolve inviter name for display when invitation is valid.
$inviter_name = '';
$show_inviter = $attributes['showInviterName'] ?? false;
if ( $valid_invitation_token && $show_inviter ) {
	if ( class_exists( \FairAudience\Database\ParticipantRepository::class ) ) {
		$inviter_repo = new \FairAudience\Database\ParticipantRepository();
		$inviter      = $inviter_repo->get_by_id( $valid_invitation_token->inviter_participant_id );
		if ( $inviter ) {
			$inviter_name = trim( $inviter->name . ' ' . ( $inviter->surname ?? '' ) );
		}
	}
}

// Resolve ticket types for this event date, if any. When present, the
// signup form switches from a single-price button to a radio picker of
// ticket types, each with its own price and seat count.
$ticket_types_for_display = array();
if ( $pricing_event_date_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
	$raw_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( (int) $pricing_event_date_id );

	// Load group restrictions and participant's groups for filtering.
	$tt_group_restrictions = array();
	$participant_group_ids = array();
	if ( class_exists( \FairEvents\Models\TicketTypeGroupRestriction::class ) ) {
		$tt_group_restrictions = \FairEvents\Models\TicketTypeGroupRestriction::get_all_by_event_date_id( (int) $pricing_event_date_id );
	}
	if ( $participant && ! empty( $tt_group_restrictions ) ) {
		$group_participant_repo = new \FairAudience\Database\GroupParticipantRepository();
		$memberships            = $group_participant_repo->get_by_participant( $participant->id );
		$participant_group_ids  = array_map( fn( $m ) => (int) $m->group_id, $memberships );
	}

	foreach ( $raw_types as $tt ) {
		// Invitation-only ticket types: only show when a valid invitation token is present.
		if ( $tt->invitation_only && ! $valid_invitation_token ) {
			continue;
		}

		// Skip ticket types restricted to groups the participant doesn't belong to
		// (but skip this check for invitation-only types unlocked by a valid token).
		$allowed_groups = $tt_group_restrictions[ $tt->id ] ?? array();
		if ( ! empty( $allowed_groups ) && ! $tt->invitation_only ) {
			if ( empty( $participant_group_ids ) || empty( array_intersect( $allowed_groups, $participant_group_ids ) ) ) {
				continue;
			}
		}

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
			'invitation_only'  => (bool) $tt->invitation_only,
		);
	}
}
$has_ticket_types = ! empty( $ticket_types_for_display );

// Resolve ticket options for this event date, if any. Options are displayed
// as checkboxes — participants can select zero or more at signup.
$ticket_options_for_display = array();
if ( $pricing_event_date_id && class_exists( \FairEvents\Models\TicketOption::class ) ) {
	$raw_options = \FairEvents\Models\TicketOption::get_all_by_event_date_id( (int) $pricing_event_date_id );
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

// Detect whether any ticket option carries a non-zero price.  Used below to
// decide whether data-base-price should be "0" (options-only pricing) vs ""
// (truly free, no JS total updates needed).
$has_priced_options = ! empty(
	array_filter(
		$ticket_options_for_display,
		static function ( $opt ) {
			return $opt['price'] > 0;
		}
	)
);

// Resolve effective signup price for the current viewer so we can reflect it
// in the button label.
// null = no price configured at all → keep the default button text
// > 0  = paid → append "— €X.XX"
// 0    = a price exists but the viewer gets it for free (e.g. 100% group
// discount, or base price explicitly set to 0) → show "… for free"
$signup_price = null;
if ( ! $has_ticket_types && $pricing_event_date_id && class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
	$signup_price = \FairEvents\Services\EventSignupPricing::resolve_price(
		(int) $pricing_event_date_id,
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
$render_ticket_types = static function () use ( $ticket_types_for_display, $has_ticket_types, $form_id, $valid_invitation_token, $inviter_name ) {
	if ( ! $has_ticket_types ) {
		return;
	}

	// Show invitation notice above ticket types when arriving via invitation link.
	if ( $valid_invitation_token ) {
		echo '<div class="fair-audience-invitation-notice">';
		if ( $inviter_name ) {
			printf(
				'<p>%s</p>',
				sprintf(
					/* translators: %s: inviter's name */
					esc_html__( 'You have been invited by %s.', 'fair-audience' ),
					'<strong>' . esc_html( $inviter_name ) . '</strong>'
				)
			);
		} else {
			echo '<p>' . esc_html__( 'You have been invited to this event.', 'fair-audience' ) . '</p>';
		}
		echo '</div>';
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
		if ( $tt['invitation_only'] ) {
			$tt_label .= ' — ' . __( 'invitation', 'fair-audience' );
		}
		$radio_id = esc_attr( $form_id ) . '-tt-' . (int) $tt['id'];
		$classes  = 'fair-audience-ticket-type-option';
		if ( $tt['invitation_only'] ) {
			$classes .= ' fair-audience-ticket-type-invited';
		}
		echo '<label class="' . esc_attr( $classes ) . '" for="' . $radio_id . '">';
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
		'data-invitation-token'   => esc_attr( $valid_invitation_token ? $invitation_token : '' ),
		'data-base-price'         => null !== $signup_price ? esc_attr( (string) $signup_price ) : ( $has_priced_options ? '0' : '' ),
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
