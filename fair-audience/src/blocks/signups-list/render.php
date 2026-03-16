<?php
/**
 * Server-side rendering for Event Signups List Block
 *
 * @package FairAudience
 *
 * phpcs:disable WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedVariableFound
 * Variables in block render templates are scoped to the template and don't need prefixing.
 */

defined( 'WPINC' ) || die;

use FairAudience\Services\ParticipantToken;

/**
 * Check if the current viewer has group permission to view signups.
 *
 * Identifies the viewer via participant_token (URL) or logged-in WP user,
 * then checks if the viewer's participant belongs to a group that has
 * view_signups or manage_signups permission for this event's event_date.
 *
 * @param int                                          $event_id        Event post ID.
 * @param \FairAudience\Database\ParticipantRepository $participant_repo Participant repository.
 * @return bool True if viewer has permission.
 */
if ( ! function_exists( 'fair_audience_check_signup_permission' ) ) {
	function fair_audience_check_signup_permission( $event_id, $participant_repo ) {
		// Need fair-events for event_date lookup and group permission rules.
		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ||
		! class_exists( \FairEvents\Models\GroupPermissionRule::class ) ) {
			return false;
		}

		// Resolve event_date_id from event post.
		$event_date = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
		if ( ! $event_date ) {
			return false;
		}

		$event_date_id = (int) $event_date->id;

		// Get permission rules for this event date.
		$permission_rules = \FairEvents\Models\GroupPermissionRule::get_all_by_event_date_id( $event_date_id );
		if ( empty( $permission_rules ) ) {
			return false;
		}

		// Collect group IDs that have view_signups or manage_signups permission.
		$allowed_group_ids = array();
		foreach ( $permission_rules as $rule ) {
			if ( 'view_signups' === $rule->permission_type || 'manage_signups' === $rule->permission_type ) {
				$allowed_group_ids[] = $rule->group_id;
			}
		}

		if ( empty( $allowed_group_ids ) ) {
			return false;
		}

		// Identify the viewer's participant.
		$participant = null;

		// Try participant_token from URL first.
		$participant_token = get_query_var( 'participant_token', '' );
		if ( ! empty( $participant_token ) ) {
			$token_data = ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				$participant = $participant_repo->get_by_id( $token_data['participant_id'] );
			}
		}

		// Fall back to logged-in user.
		if ( ! $participant ) {
			$user_id = get_current_user_id();
			if ( $user_id ) {
				$participant = $participant_repo->get_by_user_id( $user_id );
			}
		}

		if ( ! $participant ) {
			return false;
		}

		// Check if participant belongs to any of the allowed groups.
		$group_participant_repo = new \FairAudience\Database\GroupParticipantRepository();
		$participant_groups     = $group_participant_repo->get_by_participant( $participant->id );

		foreach ( $participant_groups as $group_participant ) {
			if ( in_array( $group_participant->group_id, $allowed_group_ids, true ) ) {
				return true;
			}
		}

		return false;
	}
}

// Wrap in closure to avoid polluting global namespace.
( function () {
	// Get current post ID.
	$event_id = get_the_ID();

	// Check if we're on an event post type.
	if ( ! \FairEvents\Database\EventRepository::is_event( $event_id ) ) {
		return;
	}

	// Get repository instances.
	$event_participant_repo = new \FairAudience\Database\EventParticipantRepository();
	$participant_repo       = new \FairAudience\Database\ParticipantRepository();

	// Resolve event_date_id and get participants.
	$event_date_id = 0;
	if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
		$event_date_obj = \FairEvents\Models\EventDates::get_by_event_id( $event_id );
		if ( $event_date_obj ) {
			$event_date_id = (int) $event_date_obj->id;
		}
	}

	// Get all event participants (prefer event_date_id).
	$event_participants = $event_date_id
		? $event_participant_repo->get_by_event_date( $event_date_id )
		: $event_participant_repo->get_by_event( $event_id );

	// Filter to only signed_up participants and get their details.
	$signed_up_participants = array();
	foreach ( $event_participants as $event_participant ) {
		if ( 'signed_up' === $event_participant->label ) {
			$participant = $participant_repo->get_by_id( $event_participant->participant_id );
			if ( $participant ) {
				$signed_up_participants[] = $participant;
			}
		}
	}

	$count = count( $signed_up_participants );

	// Determine if viewer can see the full list.
	$can_view_list = is_user_logged_in();

	// Check group permissions if not already authorized.
	if ( ! $can_view_list ) {
		$can_view_list = fair_audience_check_signup_permission( $event_id, $participant_repo );
	}

	// Get wrapper attributes.
	$wrapper_attributes = get_block_wrapper_attributes(
		array(
			'class' => 'audience-signups',
		)
	);

	?>

	<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
		<?php if ( 0 === $count ) : ?>
			<p class="audience-signups__empty">
				<?php esc_html_e( 'No one has signed up yet.', 'fair-audience' ); ?>
			</p>
		<?php elseif ( ! $can_view_list ) : ?>
			<!-- Anonymous user view: count only -->
			<p class="audience-signups__count">
				<?php
				/* translators: %d: Number of participants */
				echo esc_html( sprintf( _n( '%d person signed up', '%d people signed up', $count, 'fair-audience' ), $count ) );
				?>
			</p>
		<?php else : ?>
			<!-- Authorized user view: participant list -->
			<div class="audience-signups__header">
				<h3 class="audience-signups__title">
					<?php
					/* translators: %d: Number of participants */
					echo esc_html( sprintf( _n( 'Signed up (%d)', 'Signed up (%d)', $count, 'fair-audience' ), $count ) );
					?>
				</h3>
			</div>
			<ul class="audience-signups__list">
				<?php foreach ( $signed_up_participants as $participant ) : ?>
					<?php
					$display_name = trim( $participant->name . ' ' . $participant->surname );
					if ( empty( $display_name ) ) {
						$display_name = $participant->email;
					}
					$avatar_url = get_avatar_url( $participant->email, array( 'size' => 96 ) );
					?>
					<li class="audience-signups__item">
						<img
							src="<?php echo esc_url( $avatar_url ); ?>"
							alt="<?php echo esc_attr( $display_name ); ?>"
							class="audience-signups__avatar"
							width="48"
							height="48"
						/>
						<span class="audience-signups__name">
							<?php echo esc_html( $display_name ); ?>
						</span>
					</li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
	</div>
	<?php
} )();
