<?php
/**
 * Attendance Confirmation page for Fair RSVP
 *
 * @package FairRsvp
 */

namespace FairRsvp\Admin;

defined( 'WPINC' ) || die;

/**
 * Attendance Confirmation Page class for confirming event attendance
 */
class AttendanceConfirmationPage {

	/**
	 * Render the attendance confirmation page
	 *
	 * @return void
	 */
	public function render() {
		// Get event_id from query string.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Reading URL parameter for display purposes only.
		$event_id = isset( $_GET['event_id'] ) ? (int) $_GET['event_id'] : 0;

		if ( ! $event_id ) {
			?>
			<div class="wrap">
				<h1><?php esc_html_e( 'Confirm Attendance', 'fair-rsvp' ); ?></h1>
				<div class="notice notice-error">
					<p><?php esc_html_e( 'No event ID specified.', 'fair-rsvp' ); ?></p>
				</div>
			</div>
			<?php
			return;
		}

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event ) {
			?>
			<div class="wrap">
				<h1><?php esc_html_e( 'Confirm Attendance', 'fair-rsvp' ); ?></h1>
				<div class="notice notice-error">
					<p><?php esc_html_e( 'Event not found.', 'fair-rsvp' ); ?></p>
				</div>
			</div>
			<?php
			return;
		}

		// Get invitation stats for this event.
		$invitation_repository = new \FairRsvp\Database\InvitationRepository();
		$is_admin              = current_user_can( 'manage_options' );
		$user_id               = get_current_user_id();

		// Get stats based on user role.
		if ( $is_admin ) {
			$stats = $invitation_repository->get_all_inviters_stats( $event_id );
		} else {
			$stats = $invitation_repository->get_inviter_stats( $user_id, $event_id );
		}

		?>
		<div class="wrap">
			<h1>
				<?php
				printf(
					/* translators: %s: event title */
					esc_html__( 'Confirm Attendance: %s', 'fair-rsvp' ),
					sprintf(
						'<a href="%s" target="_blank">%s</a>',
						esc_url( get_permalink( $event_id ) ),
						esc_html( $event->post_title )
					)
				);
				?>
			</h1>

			<?php if ( ! empty( $stats ) ) : ?>
				<div class="card" style="max-width: none; margin: 20px 0;">
					<h2 class="title" style="padding: 12px 16px; margin: 0;">
						<?php
						echo esc_html(
							$is_admin
								? __( 'Invitation Stats for this Event', 'fair-rsvp' )
								: __( 'Your Invitation Stats for this Event', 'fair-rsvp' )
						);
						?>
					</h2>
					<div style="padding: 0 16px 16px 16px;">
						<table class="wp-list-table widefat striped">
							<thead>
								<tr>
									<?php if ( $is_admin ) : ?>
										<th><?php esc_html_e( 'Inviter', 'fair-rsvp' ); ?></th>
										<th><?php esc_html_e( 'Email', 'fair-rsvp' ); ?></th>
									<?php endif; ?>
									<th><?php esc_html_e( 'Total Sent', 'fair-rsvp' ); ?></th>
									<th><?php esc_html_e( 'Accepted', 'fair-rsvp' ); ?></th>
									<th><?php esc_html_e( 'Pending', 'fair-rsvp' ); ?></th>
									<th><?php esc_html_e( 'Expired', 'fair-rsvp' ); ?></th>
								</tr>
							</thead>
							<tbody>
								<?php foreach ( $stats as $row ) : ?>
									<tr>
										<?php if ( $is_admin ) : ?>
											<td><?php echo esc_html( $row['inviter_name'] ?? '-' ); ?></td>
											<td><?php echo esc_html( $row['inviter_email'] ?? '-' ); ?></td>
										<?php endif; ?>
										<td>
											<span class="stats-badge" style="background: #ddd; padding: 4px 12px; border-radius: 4px; font-weight: 600;">
												<?php echo esc_html( $row['total_sent'] ); ?>
											</span>
										</td>
										<td>
											<span class="stats-badge" style="background: #d5f5e3; color: #1d8348; padding: 4px 12px; border-radius: 4px; font-weight: 600;">
												<?php echo esc_html( $row['accepted'] ); ?>
											</span>
										</td>
										<td>
											<span class="stats-badge" style="background: #fff4e6; color: #d68910; padding: 4px 12px; border-radius: 4px; font-weight: 600;">
												<?php echo esc_html( $row['pending'] ); ?>
											</span>
										</td>
										<td>
											<span class="stats-badge" style="background: #f9e4e4; color: #a93226; padding: 4px 12px; border-radius: 4px; font-weight: 600;">
												<?php echo esc_html( $row['expired'] ); ?>
											</span>
										</td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					</div>
				</div>
			<?php endif; ?>

			<div id="fair-rsvp-attendance-root" data-event-id="<?php echo esc_attr( $event_id ); ?>"></div>
		</div>
		<?php
	}
}
