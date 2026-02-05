<?php
/**
 * Server-side rendering for Event Signups List Block
 *
 * @package FairAudience
 */

defined( 'WPINC' ) || die;

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

	// Get all event participants.
	$event_participants = $event_participant_repo->get_by_event( $event_id );

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
		<?php elseif ( ! is_user_logged_in() ) : ?>
			<!-- Anonymous user view: count only -->
			<p class="audience-signups__count">
				<?php
				/* translators: %d: Number of participants */
				echo esc_html( sprintf( _n( '%d person signed up', '%d people signed up', $count, 'fair-audience' ), $count ) );
				?>
			</p>
		<?php else : ?>
			<!-- Logged-in user view: participant list -->
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
