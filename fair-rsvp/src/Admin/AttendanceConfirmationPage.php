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
			<div id="fair-rsvp-attendance-root" data-event-id="<?php echo esc_attr( $event_id ); ?>"></div>
		</div>
		<?php
	}
}
