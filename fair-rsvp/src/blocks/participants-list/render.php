<?php
/**
 * Server-side rendering for RSVP Participants Block
 *
 * @package FairRsvp
 */

defined( 'WPINC' ) || die;

// Get block attributes.
$show_status = $attributes['showStatus'] ?? 'yes';

// Get current post ID.
$event_id = get_the_ID();

// Get participants from repository.
$repository   = new \FairRsvp\Database\RsvpRepository();
$participants = $repository->get_participants_with_user_data( $event_id, $show_status );
$count        = count( $participants );

// Get wrapper attributes.
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class' => 'rsvp-participants',
	)
);

?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php if ( $count === 0 ) : ?>
		<p class="rsvp-participants__empty">
			<?php esc_html_e( 'No one has signed up yet.', 'fair-rsvp' ); ?>
		</p>
	<?php elseif ( ! is_user_logged_in() ) : ?>
		<!-- Anonymous user view: count only -->
		<p class="rsvp-participants__count">
			<?php
			/* translators: %d: Number of participants */
			echo esc_html( sprintf( _n( '%d person signed up', '%d people signed up', $count, 'fair-rsvp' ), $count ) );
			?>
		</p>
	<?php else : ?>
		<!-- Logged-in user view: participant list -->
		<div class="rsvp-participants__header">
			<h3 class="rsvp-participants__title">
				<?php
				/* translators: %d: Number of participants */
				echo esc_html( sprintf( _n( 'Attendee (%d)', 'Attendees (%d)', $count, 'fair-rsvp' ), $count ) );
				?>
			</h3>
		</div>
		<ul class="rsvp-participants__list">
			<?php foreach ( $participants as $participant ) : ?>
				<li class="rsvp-participants__item">
					<img
						src="<?php echo esc_url( $participant['avatar_url'] ); ?>"
						alt="<?php echo esc_attr( $participant['display_name'] ); ?>"
						class="rsvp-participants__avatar"
						width="48"
						height="48"
					/>
					<span class="rsvp-participants__name">
						<?php echo esc_html( $participant['display_name'] ); ?>
					</span>
				</li>
			<?php endforeach; ?>
		</ul>
	<?php endif; ?>
</div>
