<?php
/**
 * Frontend Attendance Check Page
 *
 * @package FairRsvp
 */

namespace FairRsvp\Frontend;

defined( 'WPINC' ) || die;

/**
 * Renders the frontend attendance check page
 */
class AttendanceCheckPage {

	/**
	 * Event post object
	 *
	 * @var \WP_Post
	 */
	private $event;

	/**
	 * Constructor
	 *
	 * @param \WP_Post $event Event post object.
	 */
	public function __construct( $event ) {
		$this->event = $event;
	}

	/**
	 * Check if current user can access attendance check
	 *
	 * @return bool True if user can access.
	 */
	public function can_access() {
		return current_user_can( 'edit_post', $this->event->ID );
	}

	/**
	 * Render the attendance check page
	 *
	 * @return void
	 */
	public function render() {
		// Permission check.
		if ( ! $this->can_access() ) {
			wp_die(
				esc_html__( 'You do not have permission to view this page.', 'fair-rsvp' ),
				esc_html__( 'Permission Denied', 'fair-rsvp' ),
				array( 'response' => 403 )
			);
		}

		// Get header.
		get_header();

		?>
		<div class="fair-rsvp-attendance-check-page">
			<div class="fair-rsvp-attendance-check-container">
				<div id="fair-rsvp-attendance-check-root" data-event-id="<?php echo esc_attr( $this->event->ID ); ?>">
					<?php esc_html_e( 'Loading attendance check...', 'fair-rsvp' ); ?>
				</div>
			</div>
		</div>
		<?php

		// Get footer.
		get_footer();
	}
}
