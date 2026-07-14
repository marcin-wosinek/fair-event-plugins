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
use FairAudience\Services\AudienceSession;
use FairAudience\Services\ParticipantToken;
use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;

// Detect a return-from-Mollie callback. When a fair_signup_tx is present we
// short-circuit the regular signup UI and render a transaction-scoped state
// (retry / success / processing) so the visitor sees an actionable message
// instead of a blank signup form. See issue #554.
$callback_tx_id        = 0;
$callback_tx           = null;
$callback_tx_status    = '';
$callback_tx_signature = '';
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
if ( isset( $_GET['fair_payment_callback'] ) && 'true' === $_GET['fair_payment_callback'] ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_tx_id = isset( $_GET['fair_signup_tx'] ) ? absint( wp_unslash( $_GET['fair_signup_tx'] ) ) : 0;
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_tx_signature = isset( $_GET['fst_sig'] ) ? sanitize_text_field( wp_unslash( $_GET['fst_sig'] ) ) : '';
	if ( $callback_tx_id > 0 && class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
		// Proactively pull the latest status from Mollie so the page reflects
		// reality when the webhook hasn't landed yet. This is the same trick
		// the fee-payment template uses to avoid the "is it paid or not?"
		// confusion on the redirect race window.
		if ( function_exists( 'fair_payment_sync_transaction_status' ) ) {
			fair_payment_sync_transaction_status( $callback_tx_id );
		}

		$callback_tx = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $callback_tx_id );
		if ( $callback_tx ) {
			$callback_tx_status = (string) $callback_tx->status;
		}
	}
}
// Flag computation lives further down — after participant resolution — so
// that when there's no URL-borne callback we can still surface a payment
// already in progress for this visitor based on their session / login.

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

// For recurring posts, the resolved event date is the master row.  Load all
// upcoming occurrences (master + generated children) so the user can pick a
// specific date to sign up for.  Each entry carries its own id, formatted
// label and (for logged-in viewers) signup status, populated below once the
// participant is known.
$occurrences_for_picker = array();
if ( $event_dates_obj
	&& 'master' === ( $event_dates_obj->occurrence_type ?? null )
	&& class_exists( EventDates::class )
) {
	$upcoming = EventDates::get_upcoming_by_master_id( (int) $event_dates_obj->id );
	foreach ( $upcoming as $occ ) {
		$occurrences_for_picker[] = array(
			'id'             => (int) $occ->id,
			'date'           => \FairEvents\Helpers\OccurrenceDateParam::format( $occ ),
			'start_datetime' => $occ->start_datetime,
			'end_datetime'   => $occ->end_datetime,
			'all_day'        => (bool) $occ->all_day,
			'is_master'      => (int) $occ->id === (int) $event_dates_obj->id,
			'signed_up'      => false,
		);
	}
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
$resume_token      = get_query_var( 'resume', '' );
$invitation_token  = get_query_var( 'invitation', '' );
$user_id           = get_current_user_id();

$state            = 'anonymous';
$participant      = null;
$participant_data = array();
$is_signed_up     = false;

// Cookie-based pre-fill values for the anonymous registration form. Only
// populated when the visitor has a valid fair_audience_session cookie *and*
// no stronger identity (URL token / logged-in user) applies. The cookie is
// NOT treated as authentication — fields are still editable, the form still
// goes through register_and_signup, and the visitor can hit "Not you?".
$session_prefill_name    = '';
$session_prefill_surname = '';
$session_prefill_email   = '';
$has_session_prefill     = false;

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
		}
		// Else: leave $state as 'anonymous' so the visitor falls through to
		// the self-service registration form. The new participant is linked
		// to the WP account in EventSignupController::register_and_signup,
		// so the next page load resolves to 'linked'.
	}

	// Pre-fill the register form from the WP account when the visitor is
	// logged in but has no participant yet. Fields remain editable. We
	// deliberately don't set $has_session_prefill — the "Not you? Start
	// fresh" button is for cookie-based identity, not WP auth.
	if ( $user_id && null === $participant ) {
		$wp_user                 = wp_get_current_user();
		$session_prefill_name    = $wp_user->first_name
			? (string) $wp_user->first_name
			: (string) $wp_user->display_name;
		$session_prefill_surname = (string) $wp_user->last_name;
		$session_prefill_email   = (string) $wp_user->user_email;
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

		// Resolve a whole-series pass on the master once so we can apply it
		// to the occurrence picker loop without a per-occurrence DB query.
		$series_pass_row = null;
		if ( $event_dates_obj && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$master_id_for_pass = null;
			if ( 'master' === ( $event_dates_obj->occurrence_type ?? null ) ) {
				$master_id_for_pass = (int) $event_dates_obj->id;
			} elseif ( 'generated' === ( $event_dates_obj->occurrence_type ?? null ) && $event_dates_obj->master_id ) {
				$master_id_for_pass = (int) $event_dates_obj->master_id;
			}
			if ( $master_id_for_pass ) {
				$candidate_pass = $event_participant_repository->get_series_pass_for_participant( $master_id_for_pass, $participant->id );
				if ( $candidate_pass && $candidate_pass->ticket_type_id ) {
					$pass_tt = \FairEvents\Models\TicketType::get_by_id( (int) $candidate_pass->ticket_type_id );
					if ( $pass_tt && $pass_tt->is_whole_series() ) {
						$series_pass_row = $candidate_pass;
					}
				}
			}
		}

		// Populate per-occurrence signup state for the picker.
		foreach ( $occurrences_for_picker as $idx => $occ_row ) {
			$rel           = $event_participant_repository->get_by_event_date_and_participant(
				$occ_row['id'],
				$participant->id
			);
			$occ_signed_up = ( $rel && 'signed_up' === $rel->label );

			// Also check whether the series pass (stored on master) covers this
			// occurrence. A pass covers occurrences starting on or after its
			// purchase date (mid-series semantics).
			if ( ! $occ_signed_up && $series_pass_row && $occ_row['start_datetime'] ) {
				$occ_signed_up = strtotime( $occ_row['start_datetime'] ) >= strtotime( $series_pass_row->created_at );
			}

			$occurrences_for_picker[ $idx ]['signed_up'] = $occ_signed_up;
		}

		$participant_data = array(
			'id'      => $participant->id,
			'name'    => $participant->name,
			'surname' => $participant->surname,
			'email'   => $participant->email,
		);
	}

	// Anonymous viewer: fall back to the audience session cookie for pre-fill.
	// Only applies when no URL token or logged-in user produced a participant.
	if ( null === $participant ) {
		$session_participant_id = AudienceSession::get_participant_id();
		if ( $session_participant_id ) {
			$session_participant = $participant_repository->get_by_id( $session_participant_id );
			if ( $session_participant ) {
				$session_prefill_name    = (string) $session_participant->name;
				$session_prefill_surname = (string) ( $session_participant->surname ?? '' );
				$session_prefill_email   = (string) $session_participant->email;
				$has_session_prefill     = true;
			}
		}
	}

	// No URL callback? Look up whether this visitor already has a payment in
	// progress for this event date and synthesise a callback state from it,
	// so the same retry / resume / pending UI shows for someone who navigated
	// directly back to the event page instead of returning via Mollie's
	// redirect. Skipped when a resume_token is present: someone following the
	// "continue where you left off" email link should always land on the
	// friendly resume form, not a stale retry/failed-payment card from an
	// earlier attempt.
	if ( null === $callback_tx && empty( $resume_token ) && class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
		$owner_participant_id = 0;
		if ( $participant ) {
			$owner_participant_id = (int) $participant->id;
		} elseif ( ! empty( $session_participant_id ) ) {
			$owner_participant_id = (int) $session_participant_id;
		}

		if ( $owner_participant_id ) {
			$pending_row = null;
			if ( ! empty( $event_date_id ) ) {
				$pending_row = $event_participant_repository->get_by_event_date_and_participant(
					(int) $event_date_id,
					$owner_participant_id
				);
			} else {
				$pending_row = $event_participant_repository->get_by_event_and_participant(
					$event_id,
					$owner_participant_id
				);
			}

			$within_hold = $pending_row
				&& $pending_row->payment_expires_at
				&& strtotime( $pending_row->payment_expires_at ) > time();

			if ( $pending_row
				&& 'pending_payment' === $pending_row->label
				&& $pending_row->transaction_id
				&& $within_hold
			) {
				$candidate_tx_id = (int) $pending_row->transaction_id;
				if ( function_exists( 'fair_payment_sync_transaction_status' ) ) {
					fair_payment_sync_transaction_status( $candidate_tx_id );
				}
				$candidate_tx = \FairPaymentsConnector\API\TransactionAPI::get_transaction( $candidate_tx_id );
				if ( $candidate_tx ) {
					$callback_tx_id     = $candidate_tx_id;
					$callback_tx        = $candidate_tx;
					$callback_tx_status = (string) $candidate_tx->status;
				}
			}
		}
	}
}

$has_callback_state    = null !== $callback_tx;
$callback_is_retriable = $has_callback_state && in_array( $callback_tx_status, array( 'failed', 'canceled', 'expired', 'draft' ), true );
$callback_is_paid      = $has_callback_state && 'paid' === $callback_tx_status;
$callback_is_pending   = $has_callback_state && 'pending' === $callback_tx_status;
// Mollie "open" means the payment was created but the buyer never finished
// it. The existing checkout_url is still valid — surface a button so they
// can pick it up.
$callback_is_open = $has_callback_state
	&& 'open' === $callback_tx_status
	&& ! empty( $callback_tx->checkout_url );

// When the picker is shown, re-pivot the wrapper-level event_date_id and
// is_signed_up to the occurrence the user is most likely to act on next:
// the URL-selected occurrence (?event_date=<Y-m-d>, with a legacy numeric
// id still resolving for old links) when it matches one of the upcoming
// rows, otherwise the first not-yet-signed-up upcoming occurrence, or the
// first one if they're already signed up for everything.
$has_occurrence_picker = count( $occurrences_for_picker ) > 1;
if ( $has_occurrence_picker ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$raw_event_date_param = isset( $_GET['event_date'] ) ? sanitize_text_field( wp_unslash( $_GET['event_date'] ) ) : '';

	$default_idx = null;
	if ( '' !== $raw_event_date_param ) {
		if ( \FairEvents\Helpers\OccurrenceDateParam::is_legacy_id( $raw_event_date_param ) ) {
			$url_selected_id = absint( $raw_event_date_param );
			foreach ( $occurrences_for_picker as $idx => $occ_row ) {
				if ( (int) $occ_row['id'] === $url_selected_id ) {
					$default_idx = $idx;
					break;
				}
			}
		} else {
			$url_selected_date = \FairEvents\Helpers\OccurrenceDateParam::parse( $raw_event_date_param );
			if ( null !== $url_selected_date ) {
				foreach ( $occurrences_for_picker as $idx => $occ_row ) {
					if ( $occ_row['date'] === $url_selected_date ) {
						$default_idx = $idx;
						break;
					}
				}
			}
		}
	}
	if ( null === $default_idx ) {
		$default_idx = 0;
		foreach ( $occurrences_for_picker as $idx => $occ_row ) {
			if ( ! $occ_row['signed_up'] ) {
				$default_idx = $idx;
				break;
			}
		}
	}
	$default_occ                            = $occurrences_for_picker[ $default_idx ];
	$event_date_id                          = (string) $default_occ['id'];
	$is_signed_up                           = (bool) $default_occ['signed_up'];
	$occurrences_for_picker[ $default_idx ] = array_merge( $default_occ, array( 'is_default' => true ) );
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
	if ( class_exists( \FairEventsExperimental\Models\TicketTypeGroupRestriction::class ) ) {
		$tt_group_restrictions = \FairEventsExperimental\Models\TicketTypeGroupRestriction::get_all_by_event_date_id( (int) $pricing_event_date_id );
	}
	if ( $participant && ! empty( $tt_group_restrictions ) && class_exists( \FairAudienceExperimental\Database\GroupParticipantRepository::class ) ) {
		$group_participant_repo = new \FairAudienceExperimental\Database\GroupParticipantRepository();
		$memberships            = $group_participant_repo->get_by_participant( $participant->id );
		$participant_group_ids  = array_map( fn( $m ) => (int) $m->group_id, $memberships );
	}

	foreach ( $raw_types as $tt ) {
		// Invitation-only ticket types: only show when a valid invitation token is present.
		if ( $tt->invitation_only && ! $valid_invitation_token ) {
			continue;
		}

		// Hide ticket types whose end date has passed or that have been manually disabled.
		if ( $tt->disabled || ( $tt->disable_at && strtotime( $tt->disable_at ) <= time() ) ) {
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
		if ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			$tt_price = \FairEventsExperimental\Services\EventSignupPricing::resolve_price_for_ticket_type(
				$tt->id,
				$participant ? (int) $participant->id : null
			);
		}
		if ( null === $tt_price ) {
			continue;
		}

		// Capacity check: limited-quantity tiers (e.g. "Early Bird – first
		// 10") disappear once capacity is reached. We render them as a
		// disabled "sold out" row instead of hiding so visitors understand
		// why prices changed compared to what they saw earlier.
		$tt_is_full = false;
		if ( null !== $tt->capacity ) {
			$tt_reserved = $event_participant_repository->count_signups_for_ticket_type( (int) $tt->id );
			if ( $tt_reserved >= (int) $tt->capacity ) {
				$tt_is_full = true;
			}
		}

		$ticket_types_for_display[] = array(
			'id'                 => (int) $tt->id,
			'name'               => $tt->name,
			'price'              => $tt_price,
			'invitation_only'    => (bool) $tt->invitation_only,
			'minimum_activities' => (int) $tt->minimum_activities,
			'recurrence_scope'   => $tt->recurrence_scope,
			'minimum_instances'  => (int) $tt->minimum_instances,
			'is_full'            => $tt_is_full,
		);
	}
}
$has_ticket_types = ! empty( $ticket_types_for_display );

// Resolve best group discount rule; used for both option pricing and the discount note.
$best_discount_rule = null;
if ( $pricing_event_date_id && $participant && class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
	$best_discount_rule = \FairEventsExperimental\Services\EventSignupPricing::resolve_best_discount_rule(
		(int) $pricing_event_date_id,
		(int) $participant->id
	);
}

// Resolve ticket options for this event date, if any. Options are displayed
// as checkboxes — participants can select zero or more at signup.
$ticket_options_for_display = array();
if ( $pricing_event_date_id && class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
	$raw_options = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( (int) $pricing_event_date_id );

	$invitation_inviter_id = $valid_invitation_token ? (int) $valid_invitation_token->inviter_participant_id : null;

	foreach ( $raw_options as $opt ) {
		$resolved_base = class_exists( \FairEventsExperimental\Services\ActivityOptionPriceResolver::class )
			? \FairEventsExperimental\Services\ActivityOptionPriceResolver::resolve( $opt )
			: (float) $opt->price;
		if ( null === $resolved_base ) {
			// Derived mode with no active period / no row → option not purchasable; skip.
			continue;
		}
		$opt_price        = (float) $resolved_base;
		$invitation_price = null;
		if ( $invitation_inviter_id && class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			$invitation_price = \FairEventsExperimental\Services\EventSignupPricing::resolve_option_invitation_price(
				$opt,
				(int) $pricing_event_date_id,
				$invitation_inviter_id
			);
		}
		if ( null !== $invitation_price ) {
			$opt_price = (float) $invitation_price;
		} elseif ( $best_discount_rule && $opt_price > 0 ) {
			$opt_price = \FairEventsExperimental\Services\EventSignupPricing::apply_discount(
				$opt_price,
				$best_discount_rule->discount_type,
				(float) $best_discount_rule->discount_value
			);
		}

		$is_full = false;
		if ( null !== $opt->capacity ) {
			$reserved = $event_participant_repository->count_signups_for_ticket_option( (int) $opt->id );
			if ( $reserved >= (int) $opt->capacity ) {
				$is_full = true;
			}
		}

		$ticket_options_for_display[] = array(
			'id'         => (int) $opt->id,
			'name'       => $opt->name,
			'short_name' => $opt->short_name ?? null,
			'price'      => $opt_price,
			'is_full'    => $is_full,
		);
	}
}
$has_ticket_options = ! empty( $ticket_options_for_display );

// Minimum number of activities the participant must select.  Capped at the
// number of options actually available so the requirement is never impossible
// to satisfy, and only meaningful when at least one option exists.
$minimum_activities = 0;
if ( $has_ticket_options && $pricing_event_date_id && class_exists( EventDateSetting::class ) ) {
	$minimum_activities = (int) EventDateSetting::get( (int) $pricing_event_date_id, 'minimum_activities' );
	$minimum_activities = max( 0, min( $minimum_activities, count( $ticket_options_for_display ) ) );
}

// A ticket type can raise the minimum above the event-date global (issue #625).
// Determine whether any selectable type carries a higher requirement, and the
// effective minimum for the type that's pre-selected on first paint (the first
// not-sold-out type, mirroring the button price selection below). The frontend
// recomputes this live as the buyer switches ticket type.
$option_count            = count( $ticket_options_for_display );
$any_ticket_type_min     = 0;
$preselected_type_min    = 0;
$preselected_type_chosen = false;
if ( $has_ticket_options && $has_ticket_types ) {
	foreach ( $ticket_types_for_display as $tt_for_min ) {
		$tt_min              = (int) ( $tt_for_min['minimum_activities'] ?? 0 );
		$any_ticket_type_min = max( $any_ticket_type_min, $tt_min );
		if ( ! $preselected_type_chosen && empty( $tt_for_min['is_full'] ) ) {
			$preselected_type_min    = $tt_min;
			$preselected_type_chosen = true;
		}
	}
}
$initial_minimum_activities = min( $option_count, max( $minimum_activities, $preselected_type_min ) );

// Read block attribute to control whether option prices are displayed.
$show_option_prices = $attributes['showOptionPrices'] ?? true;

// Detect whether any ticket option carries a non-zero price.  Used below to
// decide whether data-base-price should be "0" (options-only pricing) vs ""
// (truly free, no JS total updates needed).
$has_priced_options = ! empty(
	array_filter(
		$ticket_options_for_display,
		static function ( $opt ) {
			return 0 != $opt['price'];
		}
	)
);

// For a signed-up viewer, summarise their current registration (ticket type +
// chosen activities) and compute which activities they can still add — every
// non-full option for this event date that isn't already on their
// subscription (issue #611).
$addable_options        = array();
$current_activity_names = array();
$current_ticket_label   = '';
if ( $is_signed_up && $participant && ! empty( $event_date_id ) && isset( $event_participant_repository ) ) {
	$signed_row = $event_participant_repository->get_by_event_date_and_participant( (int) $event_date_id, (int) $participant->id );
	if ( $signed_row ) {
		if ( ! empty( $signed_row->ticket_type_id ) && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$current_ticket_type = \FairEvents\Models\TicketType::get_by_id( (int) $signed_row->ticket_type_id );
			if ( $current_ticket_type ) {
				$current_ticket_label = (string) $current_ticket_type->name;
			}
		}

		$selected_option_ids = $event_participant_repository->get_option_ids_for_event_participant( (int) $signed_row->id );
		foreach ( $ticket_options_for_display as $opt ) {
			if ( in_array( (int) $opt['id'], $selected_option_ids, true ) ) {
				$current_activity_names[] = $opt['name'];
				continue;
			}
			// Full options are kept in the list but rendered disabled, so the
			// section stays discoverable and explains why they can't be added.
			$addable_options[] = $opt;
		}
	}
}
$has_addable_options = ! empty( $addable_options );

// Resolve effective signup price for the current viewer so we can reflect it
// in the button label.
// null = no price configured at all → keep the default button text
// > 0  = paid → append "— €X.XX"
// 0    = a price exists but the viewer gets it for free (e.g. 100% group
// discount, or base price explicitly set to 0) → show "… for free"
$signup_price = null;
if ( $has_ticket_types ) {
	// Use the first not-sold-out tier so the button label matches the
	// pre-selected radio rather than the (sold out) cheapest tier.
	foreach ( $ticket_types_for_display as $tt_for_button ) {
		if ( empty( $tt_for_button['is_full'] ) ) {
			$signup_price = $tt_for_button['price'];
			break;
		}
	}
	if ( null === $signup_price ) {
		$signup_price = $ticket_types_for_display[0]['price'];
	}
} elseif ( $pricing_event_date_id && class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
	$signup_price = \FairEventsExperimental\Services\EventSignupPricing::resolve_price(
		(int) $pricing_event_date_id,
		$participant ? (int) $participant->id : null
	);
}

// Sliding scale (pay-what-you-can) replaces the fixed base price with a
// buyer-chosen amount in [min, max], defaulting to the suggested price.
// Only offered in the non-ticket-types (Simple) pricing mode; group
// discounts do not stack on a buyer-chosen amount.
$sliding_scale = null;
if ( ! $has_ticket_types && $pricing_event_date_id && class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
	$sliding_scale = \FairEventsExperimental\Services\EventSignupPricing::resolve_sliding_scale(
		(int) $pricing_event_date_id
	);
	if ( $sliding_scale ) {
		$signup_price = $sliding_scale['suggested'];
	}
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

// Detect when payment is configured but the connector is not ready.
// Covers both: plugin missing (class_exists false) and plugin active but
// unconfigured (no Mollie API key / OAuth). When true, signup buttons are
// disabled and a notice replaces the "Sign up for free" label so a paid
// event is never presented as free to the visitor.
$payment_unavailable = false;
if ( null !== $signup_price ) {
	$connector_ready = class_exists( \FairPaymentsConnector\API\TransactionAPI::class )
		&& \FairPaymentsConnector\API\TransactionAPI::is_configured();
	if ( ! $connector_ready ) {
		if ( $signup_price > 0 ) {
			// Resolved price is positive — connector required.
			$payment_unavailable = true;
		} elseif ( class_exists( \FairEventsExperimental\Services\EventSignupPricing::class ) ) {
			// Resolved price is zero but event may carry a paid base price
			// (e.g. 100%-discounted or pricing-service glitch).
			$payment_unavailable = \FairEventsExperimental\Services\EventSignupPricing::has_paid_price_configured(
				(int) $pricing_event_date_id
			);
		}
	}
}

// Build a group discount note to render near the signup button.
$discount_note_html = '';
if ( $best_discount_rule ) {
	$group_name = '';
	if ( class_exists( \FairAudienceExperimental\Database\GroupRepository::class ) ) {
		$group_repo = new \FairAudienceExperimental\Database\GroupRepository();
		$group      = $group_repo->get_by_id( (int) $best_discount_rule->group_id );
		if ( $group ) {
			$group_name = $group->name;
		}
	}

	if ( 'percentage' === $best_discount_rule->discount_type ) {
		$discount_label = sprintf(
			/* translators: 1: discount percentage, 2: group name */
			__( '%1$s%% discount applied (%2$s)', 'fair-audience' ),
			number_format_i18n( (float) $best_discount_rule->discount_value ),
			$group_name
		);
	} else {
		$discount_label = sprintf(
			/* translators: 1: discount amount in euros, 2: group name */
			__( '€%1$s discount applied (%2$s)', 'fair-audience' ),
			number_format_i18n( (float) $best_discount_rule->discount_value, 2 ),
			$group_name
		);
	}

	$discount_note_html = '<p class="fair-audience-signup-discount-note">'
		. esc_html( $discount_label )
		. '</p>';
}

/**
 * Render the ticket-type radio fieldset. No-op when the event date has no
 * ticket types configured. First enabled option is pre-selected.
 */
// Read block attribute to control whether ticket type prices are displayed.
$show_ticket_type_prices = $attributes['showTicketTypePrices'] ?? true;

$render_ticket_types = static function () use ( $ticket_types_for_display, $has_ticket_types, $form_id, $valid_invitation_token, $inviter_name, $show_ticket_type_prices ) {
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
	$default_selected = false;
	foreach ( $ticket_types_for_display as $tt ) {
		$tt_is_full = ! empty( $tt['is_full'] );
		$tt_label   = $tt['name'];
		if ( $show_ticket_type_prices && null !== $tt['price'] ) {
			if ( $tt['price'] > 0 ) {
				$tt_label .= ' — €' . number_format_i18n( (float) $tt['price'], 2 );
			} elseif ( $tt['price'] < 0 ) {
				$tt_label .= ' — -€' . number_format_i18n( abs( (float) $tt['price'] ), 2 );
			} else {
				$tt_label .= ' — ' . __( 'free', 'fair-audience' );
			}
		}
		if ( $tt['invitation_only'] ) {
			$tt_label .= ' — ' . __( 'invitation', 'fair-audience' );
		}
		if ( $tt_is_full ) {
			$tt_label .= ' — ' . __( 'sold out', 'fair-audience' );
		}
		$radio_id = esc_attr( $form_id ) . '-tt-' . (int) $tt['id'];
		$classes  = 'fair-audience-ticket-type-option';
		if ( $tt['invitation_only'] ) {
			$classes .= ' fair-audience-ticket-type-invited';
		}
		if ( $tt_is_full ) {
			$classes .= ' fair-audience-ticket-type-full';
		}
		echo '<label class="' . esc_attr( $classes ) . '" for="' . $radio_id . '">';
		echo '<input type="radio" name="ticket_type_id" id="' . $radio_id . '" value="' . (int) $tt['id'] . '" data-ticket-price="' . ( null !== $tt['price'] ? esc_attr( number_format( (float) $tt['price'], 2, '.', '' ) ) : '' ) . '" data-min-activities="' . esc_attr( (string) ( $tt['minimum_activities'] ?? 0 ) ) . '" data-recurrence-scope="' . esc_attr( $tt['recurrence_scope'] ?? 'single_instance' ) . '" data-min-instances="' . esc_attr( (string) ( $tt['minimum_instances'] ?? 0 ) ) . '"';
		if ( $tt_is_full ) {
			echo ' disabled';
		} elseif ( ! $default_selected ) {
			echo ' checked';
			$default_selected = true;
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
$render_ticket_options = static function () use ( $ticket_options_for_display, $has_ticket_options, $form_id, $show_option_prices, $minimum_activities, $any_ticket_type_min, $initial_minimum_activities ) {
	if ( ! $has_ticket_options ) {
		return;
	}
	// When a minimum-activities requirement is in play (globally or because a
	// ticket type can raise it), option prices are shown only past the minimum
	// as a per-option "(+€X.XX)" add-on tag toggled by the frontend JS, instead
	// of the always-on inline price. Feature-inactive events keep the inline
	// price (today's behavior). See issue #644.
	$feature_active = ( $minimum_activities > 0 || $any_ticket_type_min > 0 );

	echo '<fieldset class="fair-audience-ticket-options">';
	echo '<legend>' . esc_html__( 'Select activities', 'fair-audience' ) . '</legend>';
	// Render the hint whenever a minimum is possible — either the event-date
	// global requires one, or a ticket type can raise it (issue #625). The
	// element is always present so the frontend JS can rewrite/toggle it as the
	// buyer switches ticket type; it starts hidden when the pre-selected type's
	// effective minimum is 0.
	if ( $minimum_activities > 0 || $any_ticket_type_min > 0 ) {
		$hint_text = $initial_minimum_activities > 0
			? sprintf(
				/* translators: %d: minimum number of activities required */
				_n(
					'Please select at least %d activity to sign up.',
					'Please select at least %d activities to sign up.',
					$initial_minimum_activities,
					'fair-audience'
				),
				$initial_minimum_activities
			)
			: '';
		$hint_style = $initial_minimum_activities > 0 ? '' : ' style="display: none;"';
		printf(
			'<p class="fair-audience-ticket-options-min-hint"%s>%s</p>',
			$hint_style, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static literal.
			esc_html( $hint_text )
		);
	}
	foreach ( $ticket_options_for_display as $opt ) {
		$opt_label = $opt['name'];
		// Inline price only when the minimum-activities feature is inactive; the
		// feature-active case uses the toggled "(+price)" tag emitted below.
		if ( ! $feature_active && $show_option_prices ) {
			if ( $opt['price'] > 0 ) {
				$opt_label .= ' — €' . number_format_i18n( $opt['price'], 2 );
			} elseif ( $opt['price'] < 0 ) {
				$opt_label .= ' — -€' . number_format_i18n( abs( $opt['price'] ), 2 );
			} else {
				$opt_label .= ' — ' . __( 'free', 'fair-audience' );
			}
		}
		$is_full = ! empty( $opt['is_full'] );
		if ( $is_full ) {
			$opt_label .= ' — ' . __( 'full', 'fair-audience' );
		}
		$checkbox_id = esc_attr( $form_id ) . '-opt-' . (int) $opt['id'];
		$classes     = 'fair-audience-ticket-option-item';
		if ( $is_full ) {
			$classes .= ' fair-audience-ticket-option-full';
		}
		echo '<label class="' . esc_attr( $classes ) . '" for="' . $checkbox_id . '">';
		echo '<input type="checkbox" name="ticket_option_ids[]" id="' . $checkbox_id . '" value="' . (int) $opt['id'] . '" data-option-price="' . esc_attr( number_format( $opt['price'], 2, '.', '' ) ) . '" data-option-short-name="' . esc_attr( $opt['short_name'] ?? '' ) . '"';
		if ( $is_full ) {
			echo ' disabled';
		}
		echo ' /> ';
		// Name + add-on tag share one inline span so the "(+price)" flows with
		// the (potentially wrapping) activity name instead of being stranded on
		// its own line by the flex layout.
		echo '<span class="fair-audience-ticket-option-text">';
		echo esc_html( $opt_label );
		// Hidden add-on tag, revealed by frontend.js on unchecked options once
		// the minimum is reached. Positive prices only (no "(+€0.00)").
		if ( $feature_active && $show_option_prices && $opt['price'] > 0 ) {
			printf(
				'<span class="fair-audience-ticket-option-addon" style="display: none;"> %s</span>',
				esc_html(
					sprintf(
						/* translators: %s: formatted add-on price */
						__( '(+€%s)', 'fair-audience' ),
						number_format_i18n( $opt['price'], 2 )
					)
				)
			);
		}
		echo '</span>';
		echo '</label>';
	}
	echo '</fieldset>';
};

/**
 * Render the "add activities" checkbox fieldset shown to a signed-up viewer,
 * listing only the activities they don't yet have (issue #611). No-op when
 * there's nothing left to add. The Add button total is kept in sync by the
 * frontend JS from the checked options' data-option-price.
 */
$render_add_activities = static function () use ( $addable_options, $has_addable_options, $form_id, $show_option_prices ) {
	if ( ! $has_addable_options ) {
		return;
	}
	echo '<fieldset class="fair-audience-add-activities">';
	echo '<legend>' . esc_html__( 'Add activities', 'fair-audience' ) . '</legend>';
	foreach ( $addable_options as $opt ) {
		$opt_label = $opt['name'];
		if ( $show_option_prices ) {
			if ( $opt['price'] > 0 ) {
				$opt_label .= ' — €' . number_format_i18n( $opt['price'], 2 );
			} elseif ( $opt['price'] < 0 ) {
				$opt_label .= ' — -€' . number_format_i18n( abs( $opt['price'] ), 2 );
			} else {
				$opt_label .= ' — ' . __( 'free', 'fair-audience' );
			}
		}
		$is_full = ! empty( $opt['is_full'] );
		if ( $is_full ) {
			$opt_label .= ' — ' . __( 'full', 'fair-audience' );
		}
		$checkbox_id = esc_attr( $form_id ) . '-add-opt-' . (int) $opt['id'];
		$classes     = 'fair-audience-ticket-option-item';
		if ( $is_full ) {
			$classes .= ' fair-audience-ticket-option-full';
		}
		echo '<label class="' . esc_attr( $classes ) . '" for="' . $checkbox_id . '">';
		echo '<input type="checkbox" name="add_option_ids[]" id="' . $checkbox_id . '" value="' . (int) $opt['id'] . '" data-option-price="' . esc_attr( number_format( $opt['price'], 2, '.', '' ) ) . '" data-option-short-name="' . esc_attr( $opt['short_name'] ?? '' ) . '"';
		if ( $is_full ) {
			echo ' disabled';
		}
		echo ' /> ';
		echo esc_html( $opt_label );
		echo '</label>';
	}
	echo '<div class="wp-block-button">';
	echo '<button type="button" class="wp-block-button__link wp-element-button fair-audience-add-activities-button" disabled>';
	echo esc_html__( 'Add activities', 'fair-audience' );
	echo '</button>';
	echo '</div>';
	echo '</fieldset>';
};

/**
 * Render the upcoming-occurrence picker for recurring events.
 *
 * The picker is a no-op when fewer than two upcoming occurrences exist.
 * Renders a <select> dropdown. Each option carries data-event-date-id,
 * data-event-date (the public Y-m-d param) and data-signed-up so the
 * frontend JS can re-target the submit, toggle between "Sign up" /
 * "Cancel signup" as the user changes the selection, and sync the
 * selection into the page URL as a readable date.
 */
$render_occurrence_picker = static function () use ( $occurrences_for_picker, $has_occurrence_picker, $form_id, $state ) {
	if ( ! $has_occurrence_picker ) {
		return;
	}
	$can_cancel = ( 'linked' === $state || 'with_token' === $state );
	$select_id  = esc_attr( $form_id ) . '-occ';
	echo '<div class="fair-audience-occurrence-picker">';
	echo '<label for="' . $select_id . '" class="fair-audience-occurrence-picker-label">' . esc_html__( 'Choose a date', 'fair-audience' ) . '</label>';
	echo '<select id="' . $select_id . '" name="event_date_id" class="fair-audience-occurrence-select">';
	foreach ( $occurrences_for_picker as $occ_row ) {
		$label = \FairEvents\Helpers\DateRangeFormatter::format(
			$occ_row['start_datetime'],
			$occ_row['end_datetime'],
			$occ_row['all_day']
		);
		if ( $occ_row['signed_up'] ) {
			if ( $can_cancel ) {
				/* translators: appended to a date label when the viewer is signed up — they can cancel from this row */
				$label .= ' — ' . __( 'signed up (manage)', 'fair-audience' );
			} else {
				$label .= ' — ' . __( 'signed up', 'fair-audience' );
			}
		}
		echo '<option value="' . (int) $occ_row['id'] . '" data-event-date-id="' . (int) $occ_row['id'] . '" data-event-date="' . esc_attr( $occ_row['date'] ) . '" data-signed-up="' . ( $occ_row['signed_up'] ? 'true' : 'false' ) . '"';
		if ( ! empty( $occ_row['is_default'] ) ) {
			echo ' selected';
		}
		echo '>' . esc_html( $label ) . '</option>';
	}
	echo '</select>';
	echo '</div>';
};

/**
 * Render the pay-what-you-can slider (+ accessible number input) when
 * sliding scale is configured for this event date. Frontend.js reads the
 * number input's value to seed the live total and the signup request's
 * chosen_amount; the two inputs stay in sync client-side.
 */
$render_sliding_scale_picker = static function () use ( $sliding_scale, $form_id ) {
	if ( ! $sliding_scale ) {
		return;
	}
	$input_id = esc_attr( $form_id ) . '-sliding-scale';
	?>
	<div class="fair-audience-sliding-scale-picker">
		<label for="<?php echo esc_attr( $input_id ); ?>">
			<?php esc_html_e( 'Choose what you pay', 'fair-audience' ); ?>
		</label>
		<input
			type="range"
			class="fair-audience-sliding-scale-range"
			min="<?php echo esc_attr( (string) $sliding_scale['min'] ); ?>"
			max="<?php echo esc_attr( (string) $sliding_scale['max'] ); ?>"
			step="0.01"
			value="<?php echo esc_attr( (string) $sliding_scale['suggested'] ); ?>"
			aria-describedby="<?php echo esc_attr( $input_id ); ?>-value"
		/>
		<input
			type="number"
			id="<?php echo esc_attr( $input_id ); ?>"
			name="chosen_amount"
			class="fair-audience-sliding-scale-number"
			min="<?php echo esc_attr( (string) $sliding_scale['min'] ); ?>"
			max="<?php echo esc_attr( (string) $sliding_scale['max'] ); ?>"
			step="0.01"
			value="<?php echo esc_attr( (string) $sliding_scale['suggested'] ); ?>"
		/>
	</div>
	<?php
};

/**
 * Render the multi-occurrence checkbox picker for 'multiple_instances' ticket
 * types. Hidden by default; frontend.js reveals it when the buyer selects a
 * ticket type whose data-recurrence-scope is 'multiple_instances', and hides
 * the single-occurrence <select> in that case since the two pickers are
 * mutually exclusive. Sold-out / already-signed-up occurrences are rendered
 * disabled rather than omitted, so the picker stays a stable/complete list.
 */
$render_instance_picker = static function () use ( $occurrences_for_picker, $has_occurrence_picker, $form_id, $ticket_types_for_display ) {
	if ( ! $has_occurrence_picker ) {
		return;
	}

	$has_multi_instance_type = false;
	foreach ( $ticket_types_for_display as $tt ) {
		if ( 'multiple_instances' === ( $tt['recurrence_scope'] ?? '' ) ) {
			$has_multi_instance_type = true;
			break;
		}
	}
	if ( ! $has_multi_instance_type ) {
		return;
	}

	echo '<fieldset class="fair-audience-instance-picker" style="display: none;">';
	echo '<legend>' . esc_html__( 'Choose occurrences', 'fair-audience' ) . '</legend>';
	foreach ( $occurrences_for_picker as $occ_row ) {
		$label       = \FairEvents\Helpers\DateRangeFormatter::format(
			$occ_row['start_datetime'],
			$occ_row['end_datetime'],
			$occ_row['all_day']
		);
		$is_disabled = ! empty( $occ_row['signed_up'] );
		$checkbox_id = esc_attr( $form_id ) . '-inst-' . (int) $occ_row['id'];
		$classes     = 'fair-audience-instance-option';
		if ( $is_disabled ) {
			$classes .= ' fair-audience-instance-option-disabled';
		}
		echo '<label class="' . esc_attr( $classes ) . '" for="' . $checkbox_id . '">';
		echo '<input type="checkbox" name="event_date_ids[]" id="' . $checkbox_id . '" value="' . (int) $occ_row['id'] . '"';
		if ( $is_disabled ) {
			echo ' disabled';
		}
		echo ' /> ';
		echo esc_html( $label );
		if ( $is_disabled ) {
			echo ' — ' . esc_html__( 'already signed up', 'fair-audience' );
		}
		echo '</label>';
	}
	echo '<p class="fair-audience-instance-picker-hint"></p>';
	echo '<p class="fair-audience-instance-picker-total"></p>';
	echo '</fieldset>';
};

// Base button labels (without price suffix) for dynamic JS price updates.
$base_signup_button_text   = __( $attributes['signupButtonText'] ?? 'Sign Up', 'fair-audience' );
$base_register_button_text = __( $attributes['registerButtonText'] ?? 'Register & Sign Up', 'fair-audience' );

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'                      => 'fair-audience-event-signup',
		'data-event-id'              => esc_attr( (string) $event_id ),
		'data-event-date-id'         => esc_attr( $event_date_id ),
		'data-state'                 => esc_attr( $state ),
		'data-is-signed-up'          => $is_signed_up ? 'true' : 'false',
		'data-participant-token'     => esc_attr( $participant_token ),
		'data-resume-token'          => esc_attr( 'with_token' === $state ? $resume_token : '' ),
		'data-success-message'       => esc_attr( $success_message ),
		'data-invitation-token'      => esc_attr( $valid_invitation_token ? $invitation_token : '' ),
		'data-base-price'            => null !== $signup_price ? esc_attr( (string) $signup_price ) : ( $has_priced_options ? '0' : '' ),
		'data-signup-base-text'      => esc_attr( $base_signup_button_text ),
		'data-register-base-text'    => esc_attr( $base_register_button_text ),
		'data-min-activities'        => esc_attr( (string) $minimum_activities ),
		'data-has-occurrence-picker' => $has_occurrence_picker ? 'true' : 'false',
		'data-sliding-scale'         => $sliding_scale ? 'true' : 'false',
		'data-sliding-min'           => $sliding_scale ? esc_attr( (string) $sliding_scale['min'] ) : '',
		'data-sliding-max'           => $sliding_scale ? esc_attr( (string) $sliding_scale['max'] ) : '',
		'data-sliding-suggested'     => $sliding_scale ? esc_attr( (string) $sliding_scale['suggested'] ) : '',
	)
);
?>

<?php
if ( ! $is_valid_post_type ) :
	?>
<p class="fair-audience-event-signup-error">
	<?php echo esc_html__( 'This block can only be used on event pages.', 'fair-audience' ); ?>
</p>
<?php else : ?>
<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( $has_callback_state ) : ?>
		<?php
		$amount_display = sprintf( '%s %s', number_format_i18n( (float) $callback_tx->amount, 2 ), esc_html( $callback_tx->currency ) );
		?>
		<?php if ( $callback_is_paid ) : ?>
			<div class="fair-audience-signup-callback fair-audience-signup-paid" data-transaction-id="<?php echo esc_attr( (string) $callback_tx_id ); ?>">
				<div class="fair-audience-signup-paid-icon" aria-hidden="true">✓</div>
				<h2 class="fair-audience-signup-paid-heading">
					<?php esc_html_e( 'Payment confirmed', 'fair-audience' ); ?>
				</h2>
				<p class="fair-audience-signup-paid-event">
					<?php
					printf(
						/* translators: %s: event title */
						esc_html__( "You're signed up for %s.", 'fair-audience' ),
						'<strong>' . esc_html( get_the_title( $event_id ) ) . '</strong>'
					);
					?>
				</p>
				<p class="fair-audience-signup-paid-amount">
					<?php
					printf(
						/* translators: %s: formatted amount with currency */
						esc_html__( 'Amount paid: %s', 'fair-audience' ),
						esc_html( $amount_display )
					);
					?>
				</p>
				<p class="fair-audience-signup-paid-email">
					<?php esc_html_e( 'A confirmation email is on its way. You can close this page.', 'fair-audience' ); ?>
				</p>
			</div>
		<?php elseif ( $callback_is_pending ) : ?>
			<div class="fair-audience-signup-callback fair-audience-signup-pending" data-transaction-id="<?php echo esc_attr( (string) $callback_tx_id ); ?>">
				<div class="fair-audience-signup-pending-spinner" aria-hidden="true"></div>
				<h2 class="fair-audience-signup-pending-heading">
					<?php esc_html_e( 'Thank you for your payment!', 'fair-audience' ); ?>
				</h2>
				<p class="fair-audience-signup-pending-status">
					<?php esc_html_e( "We're confirming with your bank. This usually takes a few seconds — the page will update as soon as it's done.", 'fair-audience' ); ?>
				</p>
				<p class="fair-audience-signup-pending-amount">
					<?php
					printf(
						/* translators: %s: formatted amount with currency */
						esc_html__( 'Amount: %s', 'fair-audience' ),
						esc_html( $amount_display )
					);
					?>
				</p>
			</div>
		<?php elseif ( $callback_is_open ) : ?>
			<div class="fair-audience-signup-callback fair-audience-signup-resume">
				<p class="fair-audience-signup-resume-heading">
					<strong><?php esc_html_e( 'Your payment is waiting.', 'fair-audience' ); ?></strong>
				</p>
				<p class="fair-audience-signup-resume-status">
					<?php esc_html_e( 'You can pick up where you left off on the secure payment page.', 'fair-audience' ); ?>
				</p>
				<p class="fair-audience-signup-resume-amount">
					<?php
					printf(
						/* translators: %s: formatted amount with currency */
						esc_html__( 'Amount due: %s', 'fair-audience' ),
						esc_html( $amount_display )
					);
					?>
				</p>
				<div class="wp-block-button">
					<a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( $callback_tx->checkout_url ); ?>">
						<?php esc_html_e( 'Continue payment', 'fair-audience' ); ?>
					</a>
				</div>
				<p class="fair-audience-signup-resume-cancel">
					<a href="<?php echo esc_url( remove_query_arg( array( 'fair_payment_callback', 'fair_signup_tx' ) ) ); ?>">
						<?php esc_html_e( 'Cancel and start over', 'fair-audience' ); ?>
					</a>
				</p>
			</div>
		<?php elseif ( $callback_is_retriable ) : ?>
			<div class="fair-audience-signup-callback fair-audience-signup-retry"
				data-transaction-id="<?php echo esc_attr( (string) $callback_tx_id ); ?>"
				data-signature="<?php echo esc_attr( $callback_tx_signature ); ?>">
				<p class="fair-audience-signup-retry-heading">
					<strong><?php esc_html_e( "Your payment didn't go through.", 'fair-audience' ); ?></strong>
				</p>
				<p class="fair-audience-signup-retry-amount">
					<?php
					printf(
						/* translators: %s: formatted amount with currency */
						esc_html__( 'Amount due: %s', 'fair-audience' ),
						esc_html( $amount_display )
					);
					?>
				</p>
				<div class="wp-block-button">
					<button type="button" class="wp-block-button__link wp-element-button fair-audience-signup-retry-button">
						<?php esc_html_e( 'Retry payment', 'fair-audience' ); ?>
					</button>
				</div>
				<p class="fair-audience-signup-retry-cancel">
					<a href="<?php echo esc_url( remove_query_arg( array( 'fair_payment_callback', 'fair_signup_tx' ) ) ); ?>">
						<?php esc_html_e( 'Cancel and start over', 'fair-audience' ); ?>
					</a>
				</p>
				<div class="fair-audience-signup-message" style="display: none;"></div>
			</div>
		<?php else : ?>
			<div class="fair-audience-signup-status fair-audience-signup-callback">
				<p>
					<?php
					printf(
						/* translators: %s: transaction status */
						esc_html__( 'Payment status: %s', 'fair-audience' ),
						esc_html( $callback_tx_status )
					);
					?>
				</p>
			</div>
		<?php endif; ?>

	<?php elseif ( $is_signed_up && 'anonymous' === $state ) : ?>
		<!-- Signed up: anonymous user (no cancel option) -->
		<div class="fair-audience-signup-status fair-audience-signup-status-success">
			<p><?php echo esc_html__( 'You are signed up for this event!', 'fair-audience' ); ?></p>
		</div>

	<?php elseif ( ( 'with_token' === $state || 'linked' === $state ) && $participant ) : ?>
		<?php
		// Unified authenticated form: when a recurrence picker is present the
		// signup and cancel buttons live in the same container so the JS can
		// toggle which one is visible as the user selects a different date.
		$form_class            = 'with_token' === $state
			? 'fair-audience-signup-token-form'
			: 'fair-audience-signup-linked-form';
		$participant_name_html = '<strong class="fair-audience-signup-greeting-name">' . esc_html( $participant->name ) . '</strong>';
		if ( $is_signed_up ) {
			$greeting_html = sprintf(
				/* translators: %s: participant name */
				__( 'Hi %s! Here is your registration for this event.', 'fair-audience' ),
				$participant_name_html
			);
		} elseif ( 'with_token' === $state ) {
			$greeting_html = sprintf(
				/* translators: %s: participant name */
				__( 'Hi %s! Click the button below to sign up for this event.', 'fair-audience' ),
				$participant_name_html
			);
		} else {
			$greeting_html = sprintf(
				/* translators: %s: participant name */
				__( 'Hi %s! You can sign up for this event.', 'fair-audience' ),
				$participant_name_html
			);
		}
		?>
		<div class="<?php echo esc_attr( $form_class ); ?>">
			<p class="fair-audience-signup-greeting"><?php echo wp_kses( $greeting_html, array( 'strong' => array( 'class' => array() ) ) ); ?></p>
			<?php $render_occurrence_picker(); ?>
			<div class="fair-audience-signup-action-signup"<?php echo $is_signed_up ? ' style="display: none;"' : ''; ?>>
				<?php $render_ticket_types(); ?>
				<?php $render_instance_picker(); ?>
				<?php $render_ticket_options(); ?>
				<?php $render_sliding_scale_picker(); ?>
				<?php if ( '' !== trim( $content ) ) : ?>
					<div class="fair-audience-signup-questions">
						<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>
					</div>
				<?php endif; ?>
				<?php if ( '' !== $discount_note_html ) : ?>
					<?php echo wp_kses_post( $discount_note_html ); ?>
				<?php endif; ?>
				<?php if ( $payment_unavailable ) : ?>
					<p class="fair-audience-payment-unavailable-notice">
						<?php echo esc_html__( 'Online payment is not available for this event at the moment. Please contact the organiser.', 'fair-audience' ); ?>
					</p>
				<?php endif; ?>
				<div class="wp-block-button">
					<button type="button" class="wp-block-button__link wp-element-button fair-audience-signup-button" data-action="signup"<?php echo $payment_unavailable ? ' disabled' : ''; ?>>
						<?php echo esc_html( $signup_button_text ); ?>
					</button>
				</div>
			</div>
			<div class="fair-audience-signup-action-cancel"<?php echo $is_signed_up ? '' : ' style="display: none;"'; ?>>
				<div class="fair-audience-signup-status fair-audience-signup-status-success">
					<p><?php echo esc_html__( 'You are signed up for this date.', 'fair-audience' ); ?></p>
				</div>
				<?php if ( '' !== $current_ticket_label ) : ?>
					<p class="fair-audience-signup-current-ticket">
						<?php
						printf(
							/* translators: %s: ticket type name */
							esc_html__( 'Your ticket: %s', 'fair-audience' ),
							'<strong>' . esc_html( $current_ticket_label ) . '</strong>'
						);
						?>
					</p>
				<?php endif; ?>
				<?php if ( ! empty( $current_activity_names ) ) : ?>
					<div class="fair-audience-signup-current-activities">
						<p><?php echo esc_html__( 'Your activities:', 'fair-audience' ); ?></p>
						<ul>
							<?php foreach ( $current_activity_names as $current_activity_name ) : ?>
								<li><?php echo esc_html( $current_activity_name ); ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				<?php endif; ?>
				<?php $render_add_activities(); ?>
				<div class="wp-block-button fair-audience-unsignup-button-wrap">
					<button type="button" class="wp-block-button__link wp-element-button fair-audience-unsignup-button is-style-outline">
						<?php echo esc_html__( 'Cancel signup', 'fair-audience' ); ?>
					</button>
				</div>
			</div>
			<div class="fair-audience-signup-message" style="display: none;"></div>
		</div>

	<?php else : ?>
		<!-- Anonymous (or logged-in but unlinked): self-service form. -->
		<div class="fair-audience-signup-anonymous">
			<?php $render_occurrence_picker(); ?>
			<?php if ( ! $user_id ) : ?>
			<div class="fair-audience-signup-tabs">
				<button type="button" class="fair-audience-signup-tab active" data-tab="register">
					<?php echo esc_html__( "I'm new", 'fair-audience' ); ?>
				</button>
				<button type="button" class="fair-audience-signup-tab" data-tab="request-link">
					<?php echo esc_html__( 'I have an account', 'fair-audience' ); ?>
				</button>
			</div>
			<?php endif; ?>

			<!-- Registration form (new participant) -->
			<form class="fair-audience-signup-form fair-audience-signup-register" data-tab-content="register">
				<?php $render_ticket_types(); ?>
				<?php $render_instance_picker(); ?>
				<?php $render_ticket_options(); ?>
				<?php $render_sliding_scale_picker(); ?>
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
						value="<?php echo esc_attr( $session_prefill_name ); ?>"
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
						value="<?php echo esc_attr( $session_prefill_surname ); ?>"
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
						value="<?php echo esc_attr( $session_prefill_email ); ?>"
					/>
				</p>
				<p class="fair-audience-signup-checkbox">
					<label>
						<input type="checkbox" name="signup_keep_informed" value="1" />
						<?php echo esc_html__( 'Keep me informed about future events', 'fair-audience' ); ?>
					</label>
				</p>

				<?php if ( '' !== trim( $content ) ) : ?>
					<div class="fair-audience-signup-questions">
						<?php echo $content; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Inner blocks content is already escaped by WordPress. ?>
					</div>
				<?php endif; ?>

				<?php if ( $has_session_prefill ) : ?>
				<button type="button" class="fair-audience-not-you">
					<?php echo esc_html__( 'Not you? Start fresh', 'fair-audience' ); ?>
				</button>
				<?php endif; ?>

				<?php if ( $payment_unavailable ) : ?>
					<p class="fair-audience-payment-unavailable-notice">
						<?php echo esc_html__( 'Online payment is not available for this event at the moment. Please contact the organiser.', 'fair-audience' ); ?>
					</p>
				<?php endif; ?>

				<div class="wp-block-button">
					<button type="submit" class="wp-block-button__link wp-element-button fair-audience-signup-submit-button"<?php echo $payment_unavailable ? ' disabled' : ''; ?>>
						<?php echo esc_html( $register_button_text ); ?>
					</button>
				</div>

				<div class="fair-audience-signup-message" style="display: none;"></div>
			</form>

			<!-- Request link form (existing participant). Hidden for
				logged-in users — they're already authenticated, so the
				resume-by-email path is redundant. -->
			<?php if ( ! $user_id ) : ?>
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
			<?php endif; ?>
		</div>
	<?php endif; ?>
	<?php echo wp_kses_post( \FairAudience\Services\Branding::block_html() ); ?>
</div>
<?php endif; ?>
